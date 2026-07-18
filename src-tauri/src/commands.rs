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

/// Устанавливает CLI `tcp-kai` в PATH «как большие» (Zed / VS Code):
/// симлинкает sidecar `tcp-kai-cli`, лежащий рядом с запущенным приложением,
/// в `/usr/local/bin/tcp-kai` — тот всегда в PATH через `/etc/paths`. Симлинк
/// указывает внутрь .app, так что обновления приложения обновляют и CLI.
/// Сначала пробуем прямой симлинк (писабельный /usr/local/bin, напр.
/// Homebrew), иначе — нативный диалог администратора (пароль / Touch ID).
/// Возвращает созданный путь; сентинел-ошибка "cancelled" — пользователь
/// закрыл диалог авторизации.
#[tauri::command]
pub fn install_cli() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::symlink;
        use std::path::Path;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let src = exe
            .parent()
            .map(|p| p.join("tcp-kai-cli"))
            .ok_or_else(|| "не удалось определить путь к бандлу".to_string())?;
        if !src.exists() {
            return Err(format!(
                "CLI-бинарь не найден рядом с приложением: {}\n\
                 Нужна сборка tcp-kai со встроенным tcp-kai-cli (sidecar).",
                src.display()
            ));
        }
        let target = Path::new("/usr/local/bin/tcp-kai");

        // Быстрый путь: каталог писабелен — пересоздаём симлинк без пароля.
        let _ = std::fs::remove_file(target); // "not found"/"denied" не важны
        if symlink(&src, target).is_ok() {
            return Ok(target.display().to_string());
        }

        // Медленный путь: каталог root-owned. Эскалация через нативный
        // диалог; `ln -sf` переживает уже существующий root-симлинк.
        let script = format!(
            "do shell script \"mkdir -p /usr/local/bin && ln -sf '{}' '{}'\" \
             with administrator privileges",
            src.display(),
            target.display()
        );
        let out = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(target.display().to_string());
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        // -128 == пользователь закрыл диалог авторизации.
        if stderr.contains("-128") || stderr.contains("User canceled") {
            return Err("cancelled".to_string());
        }
        Err(format!("не удалось создать симлинк: {}", stderr.trim()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Install CLI поддерживается только на macOS".to_string())
    }
}

/// Перезапуск для применения обновления. Штатный relaunch() из plugin-process
/// спаунит бинарник в обход LaunchServices — на современных macOS такому
/// процессу отказывают в активации, и новое окно стартует под чужими.
/// `open -n` запускает бандл как пользовательский, окно поднимается наверх.
#[tauri::command]
pub fn relaunch_app(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        // …/tcp-kai.app/Contents/MacOS/tcp-kai → …/tcp-kai.app
        let bundle = std::env::current_exe().ok().and_then(|exe| {
            let b = exe.ancestors().nth(3)?;
            b.extension()
                .is_some_and(|e| e == "app")
                .then(|| b.to_path_buf())
        });
        if let Some(bundle) = bundle {
            let spawned = std::process::Command::new("open")
                .arg("-n")
                .arg(&bundle)
                .spawn()
                .is_ok();
            if spawned {
                app.exit(0);
                return;
            }
        }
    }
    // Вне бандла (dev-запуск) или не-macOS — обычный рестарт.
    app.restart();
}
