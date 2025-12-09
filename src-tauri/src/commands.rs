// New commands module for sending and cancelling TCP requests
use serde::{Deserialize, Serialize};
use serde_json::error::Error as SerdeError;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::time::timeout;

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
            let err_msg = format!(
                "Connection to {} timed out after {:?}",
                connection, timeout_duration
            );
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

        // Parse the json data or use null if empty
        let data: serde_json::Value = if !json.is_empty() {
            serde_json::from_str(&json).unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        // Build the payload using serde_json for proper UTF-8 handling
        let payload = serde_json::json!({
            "pattern": pattern,
            "data": data,
            "id": "unique_id_12345"
        });
        let json_str = serde_json::to_string(&payload).unwrap();
        println!("Raw TCP command payload: #{}", json_str);

        // NestJS uses string.length (character count), not byte length
        let length = json_str.chars().count();
        let serialized = format!("{}#{}", length, json_str);
        println!("send: {}", serialized);

        if let Err(e) = stream.write_all(serialized.as_bytes()).await {
            return Ok(serde_json::to_string(&ApiResponse::error(format!(
                "Failed to send data: {}",
                e
            )))
            .unwrap_or_else(|err: SerdeError| {
                format!(
                    r#"{{"ok": false, "message": "Failed to serialize error: {}"}}"#,
                    err
                )
            }));
        }
        if let Err(e) = stream.flush().await {
            return Ok(serde_json::to_string(&ApiResponse::error(format!(
                "Failed to flush stream: {}",
                e
            )))
            .unwrap_or_else(|err: SerdeError| {
                format!(
                    r#"{{"ok": false, "message": "Failed to serialize error: {}"}}"#,
                    err
                )
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
pub fn cancel_tcp_request(request_id: String, state: State<'_, Arc<Mutex<RequestState>>>) {
    let mut state_guard = state.lock().unwrap();
    if let Some(tx) = state_guard.active_requests.remove(&request_id) {
        let _ = tx.send(());
    }
}

// Wrap a raw message into ApiResponse JSON
fn to_api_response(message: String) -> Result<String, String> {
    Ok(
        serde_json::to_string(&ApiResponse::new(message)).unwrap_or_else(|err| {
            format!(
                r#"{{"ok": false, "message": "Failed to serialize error: {}"}}"#,
                err
            )
        }),
    )
}

// Read length prefix until '#' marker
async fn read_message_length(stream: &mut TcpStream) -> Result<usize, String> {
    let mut len_str = String::new();
    let mut buf = [0; 1];
    loop {
        stream
            .read_exact(&mut buf)
            .await
            .map_err(|e| e.to_string())?;
        if buf[0] == b'#' {
            break;
        }
        len_str.push(buf[0] as char);
    }
    len_str.parse::<usize>().map_err(|e| e.to_string())
}

// Read full TCP response - length is in characters, not bytes (NestJS compatibility)
async fn read_full_response(mut stream: TcpStream) -> Result<String, String> {
    let read_timeout = Duration::from_secs(30);
    
    let char_count = match timeout(read_timeout, read_message_length(&mut stream)).await {
        Ok(result) => result?,
        Err(_) => return Err("Timeout waiting for response length".to_string()),
    };
    
    // Read characters one by one since length is in chars, not bytes
    // UTF-8 characters can be 1-4 bytes each
    let mut result = String::new();
    let mut chars_read = 0;
    
    while chars_read < char_count {
        let mut byte = [0u8; 1];
        match timeout(read_timeout, stream.read_exact(&mut byte)).await {
            Ok(Ok(_)) => {},
            Ok(Err(e)) => return Err(e.to_string()),
            Err(_) => return Err("Timeout reading response body".to_string()),
        };
        
        // Determine how many bytes this UTF-8 character needs
        let first_byte = byte[0];
        let char_len = if first_byte & 0x80 == 0 {
            1 // ASCII
        } else if first_byte & 0xE0 == 0xC0 {
            2 // 2-byte UTF-8
        } else if first_byte & 0xF0 == 0xE0 {
            3 // 3-byte UTF-8
        } else if first_byte & 0xF8 == 0xF0 {
            4 // 4-byte UTF-8
        } else {
            return Err("Invalid UTF-8 start byte".to_string());
        };
        
        let mut char_bytes = vec![first_byte];
        if char_len > 1 {
            let mut remaining = vec![0u8; char_len - 1];
            match timeout(read_timeout, stream.read_exact(&mut remaining)).await {
                Ok(Ok(_)) => char_bytes.extend(remaining),
                Ok(Err(e)) => return Err(e.to_string()),
                Err(_) => return Err("Timeout reading UTF-8 continuation bytes".to_string()),
            };
        }
        
        match std::str::from_utf8(&char_bytes) {
            Ok(s) => result.push_str(s),
            Err(e) => return Err(format!("Invalid UTF-8 sequence: {}", e)),
        }
        chars_read += 1;
    }
    
    Ok(result)
}
