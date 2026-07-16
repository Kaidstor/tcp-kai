//! Tauri-обвязка над протоколом (`tcp.rs`): реестр запросов «в полёте», чтобы
//! их можно было отменить с фронтенда, и сериализация ответа для invoke.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::sync::oneshot;

use crate::tcp;

/// Отправители отмены для запросов «в полёте», по request_id с фронтенда.
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

impl Default for RequestState {
    fn default() -> Self {
        Self::new()
    }
}

/// Отправляет запрос; параллельный `cancel_tcp_request` с тем же id прерывает
/// ожидание (соединение при этом роняется вместе с задачей).
///
/// `timeout_ms` — лимит ожидания ответа (0 = без лимита, отсутствие =
/// дефолт из tcp.rs); `emit` — event-паттерн, ответ не ждём.
#[tauri::command]
pub async fn send_tcp_request(
    connection: String,
    pattern: String,
    json: String,
    request_id: String,
    timeout_ms: Option<u64>,
    emit: Option<bool>,
    state: State<'_, Arc<Mutex<RequestState>>>,
) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    {
        let mut guard = state.lock().unwrap();
        guard.active_requests.insert(request_id.clone(), tx);
    }

    let opts = tcp::ExchangeOpts {
        timeout: match timeout_ms {
            Some(0) => None,
            Some(ms) => Some(std::time::Duration::from_millis(ms)),
            None => Some(tcp::DEFAULT_READ_TIMEOUT),
        },
        emit: emit.unwrap_or(false),
        // трассировка кадра — только в dev-сборке: в теле бывают секреты
        trace: cfg!(debug_assertions),
    };

    let exchange = async {
        let response = tcp::exchange(&connection, &pattern, &json, &opts).await?;
        serde_json::to_string(&response).map_err(|e| e.to_string())
    };

    tokio::select! {
        _ = rx => {
            state.lock().unwrap().active_requests.remove(&request_id);
            Err("Request was cancelled".to_string())
        }
        result = exchange => {
            state.lock().unwrap().active_requests.remove(&request_id);
            result
        }
    }
}

/// Отменяет запрос «в полёте» по его id.
#[tauri::command]
pub fn cancel_tcp_request(request_id: String, state: State<'_, Arc<Mutex<RequestState>>>) {
    let mut guard = state.lock().unwrap();
    if let Some(tx) = guard.active_requests.remove(&request_id) {
        let _ = tx.send(());
    }
}

/// Разбирает контракт (`*.contract.ts` и т.п.): по пути на диске или по
/// вставленному содержимому. Путь с ведущим `~` разворачивается в $HOME.
#[tauri::command]
pub fn parse_contract(
    path: Option<String>,
    text: Option<String>,
) -> Result<Vec<crate::contract::ContractGroup>, String> {
    let source = match (path, text) {
        (Some(p), _) if !p.trim().is_empty() => {
            let p = p.trim();
            let expanded = if let Some(rest) = p.strip_prefix("~/") {
                match std::env::var("HOME") {
                    Ok(home) => format!("{home}/{rest}"),
                    Err(_) => p.to_string(),
                }
            } else {
                p.to_string()
            };
            std::fs::read_to_string(&expanded)
                .map_err(|e| format!("не прочитать {expanded}: {e}"))?
        }
        (_, Some(t)) if !t.trim().is_empty() => t,
        _ => return Err("нужен путь к файлу контракта или его содержимое".to_string()),
    };
    Ok(crate::contract::parse(&source))
}
