//! CLI-обвязка над общим keep-alive-демоном (`tcp_kai_lib::daemon`):
//! автоспавн демона отдельным процессом. Сам демон, пул и протокол живут
//! в библиотеке — общие с GUI, который поднимает демона потоком у себя.

use std::path::Path;
use std::time::{Duration, Instant};

use tokio::net::UnixStream;

use tcp_kai_lib::daemon::roundtrip;
pub use tcp_kai_lib::daemon::{
    call, default_timings, serve, socket_path, DaemonReply, DaemonRequest,
};

/// Обмен через демона — с автоспавном. `Err` — демон недоступен или сломался;
/// вызывающий уходит на прямое соединение.
pub async fn send(
    connection: &str,
    pattern: &str,
    body: &str,
    timeout_secs: u64,
    emit: bool,
) -> Result<DaemonReply, String> {
    let req = DaemonRequest::Send {
        connection: connection.to_string(),
        pattern: pattern.to_string(),
        body: body.to_string(),
        timeout_ms: timeout_secs * 1000,
        emit,
    };
    // ждём дольше таймаута обмена: демону нужно время на connect и хвосты
    let wait = (timeout_secs > 0).then(|| Duration::from_secs(timeout_secs + 15));
    let sock = socket_path();

    let stream = match UnixStream::connect(&sock).await {
        Ok(s) => s,
        Err(e) => {
            let mut child = spawn_daemon()?;
            connect_retry_spawned(&sock, Duration::from_secs(3), &mut child)
                .await
                .map_err(|retry| format!("{e}; после спавна: {retry}"))?
        }
    };
    roundtrip(stream, &req, wait).await
}

/// Как `daemon::connect_retry`, но следит за только что спавннутым демоном:
/// если тот умер (сокет не открылся, другой демон успел раньше и т.п.) — не
/// выжигать весь дедлайн ретраями в никуда, а сразу уйти на прямое соединение.
async fn connect_retry_spawned(
    sock: &Path,
    total: Duration,
    child: &mut std::process::Child,
) -> Result<UnixStream, String> {
    let deadline = Instant::now() + total;
    loop {
        match UnixStream::connect(sock).await {
            Ok(s) => return Ok(s),
            Err(e) => {
                if let Ok(Some(status)) = child.try_wait() {
                    // чужой живой демон на этом сокете ответил бы connect'ом
                    return Err(format!("демон завершился при старте ({status})"));
                }
                if Instant::now() >= deadline {
                    return Err(format!("демон не поднялся за {total:?}: {e}"));
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
}

fn spawn_daemon() -> Result<std::process::Child, String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let exe = std::env::current_exe().map_err(|e| format!("не найти свой бинарь: {e}"))?;
    let mut cmd = Command::new(exe);
    cmd.args(["daemon", "run"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // своя сессия: Ctrl+C по форграунд-группе шелла не должен убивать демона
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("не запустить демона: {e}"))?;
    eprintln!("tcp-kai: поднял keep-alive-демон (tcp-kai daemon status/stop; обойти: --no-daemon)");
    Ok(child)
}
