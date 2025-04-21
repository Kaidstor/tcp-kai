// New commands module for sending and cancelling TCP requests
use serde::{Deserialize, Serialize};
use serde_json::error::Error as SerdeError;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::time::timeout;
use tauri::State;

// Holds active request cancellation senders
pub struct RequestState {
    pub active_requests: HashMap<String, oneshot::Sender<()>>,
}

impl RequestState {
    pub fn new() -> Self {
        RequestState {
            active_requests: HashMap::new(),
        }
    }
}

// Standard API response format
#[derive(Serialize, Deserialize, Debug)]
pub struct ApiResponse {
    pub ok: bool,
    pub message: String,
}

impl ApiResponse {
    pub fn new(message: String) -> Self {
        ApiResponse { ok: true, message }
    }
    pub fn error(message: String) -> Self {
        ApiResponse { ok: false, message }
    }
}

impl From<std::io::Error> for ApiResponse {
    fn from(err: std::io::Error) -> Self {
        ApiResponse::error(err.to_string())
    }
}

impl From<serde_json::Error> for ApiResponse {
    fn from(err: serde_json::Error) -> Self {
        ApiResponse::error(err.to_string())
    }
}

// Helper for connection result or error
enum ConnectionResult {
    Stream(TcpStream),
    Error(ApiResponse),
}

// Attempt TCP connection with timeout
async fn establish_connection(connection: String) -> ConnectionResult {
    let timeout_duration = Duration::from_secs(5);
    match timeout(timeout_duration, TcpStream::connect(&connection)).await {
        Ok(Ok(stream)) => {
            println!("Successfully connected to {}", connection);
            ConnectionResult::Stream(stream)
        }
        Ok(Err(e)) => {
            println!("Connection I/O error to {}: {}", connection, e);
            ConnectionResult::Error(ApiResponse::error(format!("TCP connection error: {}", e)))
        }
        Err(_) => {
            let err_msg = format!("Connection to {} timed out after {:?}", connection, timeout_duration);
            println!("{}", err_msg);
            ConnectionResult::Error(ApiResponse::error(err_msg))
        }
    }
}

// Send a TCP request, allowing cancellation via the shared state
#[tauri::command]
pub async fn send_tcp_request(
    connection: String,
    pattern: String,
    json: String,
    request_id: String,
    state: State<'_, Arc<Mutex<RequestState>>>,
) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    {
        let mut state_guard = state.lock().unwrap();
        state_guard.active_requests.insert(request_id.clone(), tx);
    }

    println!("Connecting to: {}", connection);

    let result = async {
        // Establish the connection
        let mut stream = match establish_connection(connection.clone()).await {
            ConnectionResult::Stream(s) => s,
            ConnectionResult::Error(err_response) => {
                // Log the ApiResponse error for debugging
                println!("Failed to establish connection: {:?}", err_response);
                return Ok(serde_json::to_string(&err_response).unwrap());
            }
        };

        let command = format!(
            "#{{\"pattern\":\"{}\",\"data\":{},\"id\":\"unique_id_12345\"}}",
            pattern,
            if !json.is_empty() { json.clone() } else { "null".to_string() }
        );
        println!("Raw TCP command payload: {}", command);

        let length = command.len() - 1;
        let serialized = format!("{}{}", length, command);
        println!("send: {}", serialized);

        if let Err(e) = stream.write_all(serialized.as_bytes()).await {
            return Ok(serde_json::to_string(&ApiResponse::error(format!(
                "Failed to send data: {}",
                e
            )))
            .unwrap_or_else(|err: SerdeError| {
                format!(r#"{{"ok": false, "message": "Failed to serialize error: {}"}}"#, err)
            }));
        }
        if let Err(e) = stream.flush().await {
            return Ok(serde_json::to_string(&ApiResponse::error(format!(
                "Failed to flush stream: {}",
                e
            )))
            .unwrap_or_else(|err: SerdeError| {
                format!(r#"{{"ok": false, "message": "Failed to serialize error: {}"}}"#, err)
            }));
        }

        let resp = read_full_response(stream).await?;
        Ok(to_api_response(resp)?)
    };

    tokio::select! {
        _ = rx => {
            let mut state_guard = state.lock().unwrap();
            state_guard.active_requests.remove(&request_id);
            Err("Request was cancelled".to_string())
        }
        res = result => {
            let mut state_guard = state.lock().unwrap();
            state_guard.active_requests.remove(&request_id);
            res
        }
    }
}

// Cancel an in-flight TCP request by its ID
#[tauri::command]
pub fn cancel_tcp_request(
    request_id: String,
    state: State<'_, Arc<Mutex<RequestState>>>,
) {
    let mut state_guard = state.lock().unwrap();
    if let Some(tx) = state_guard.active_requests.remove(&request_id) {
        let _ = tx.send(());
    }
}

// Wrap a raw message into ApiResponse JSON
fn to_api_response(message: String) -> Result<String, String> {
    Ok(serde_json::to_string(&ApiResponse::new(message)).unwrap_or_else(|err| {
        format!(r#"{{"ok": false, "message": "Failed to serialize error: {}"}}"#, err)
    }))
}

// Read length prefix until '#' marker
async fn read_message_length(stream: &mut TcpStream) -> Result<usize, String> {
    let mut len_str = String::new();
    let mut buf = [0; 1];
    loop {
        stream.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
        if buf[0] == b'#' { break; }
        len_str.push(buf[0] as char);
    }
    len_str.parse::<usize>().map_err(|e| e.to_string())
}

// Read full TCP response until the unique ID marker
async fn read_full_response(mut stream: TcpStream) -> Result<String, String> {
    let _ = read_message_length(&mut stream).await?;
    let mut buffer = Vec::new();
    let marker = b"unique_id_12345\"}";
    loop {
        let mut byte = [0; 1];
        stream.read_exact(&mut byte).await.map_err(|e| e.to_string())?;
        buffer.push(byte[0]);
        if buffer.ends_with(marker) { break; }
    }
    String::from_utf8(buffer).map_err(|e| format!("Error converting bytes to string: {}", e))
} 