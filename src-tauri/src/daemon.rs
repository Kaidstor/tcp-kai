//! Keep-alive-демон: пул TCP-соединений, общий для GUI и CLI.
//!
//! Соединение живёт не дольше процесса, а процесс CLI умирает после каждого
//! запроса — переиспользование между вызовами возможно только через фоновый
//! процесс (аналог ssh ControlMaster). Клиенты ходят к демону по unix-сокету
//! (NDJSON: строка запроса → строка ответа). CLI поднимает демона отдельным
//! процессом (`tcp-kai daemon run`, спавн — в `bin/tcp-kai-cli/daemon.rs`),
//! GUI — потоком внутри себя (`ensure_daemon_thread`): кто первый занял сокет,
//! тем пулом и пользуются оба. Демон недоступен — клиенты молча уходят на
//! прямое соединение, базовый сценарий сломать нельзя.
//!
//! Гонка «соединение истекает ровно в момент нового запроса» снята
//! конструктивно, без эвристик с продлением: демон однопоточный, взятие из
//! пула и жнец простаивающих соединений сериализованы в одном событийном
//! цикле, а занятое соединение в пуле не лежит — жнецу его не достать.
//! Закрытие со стороны сервера (о котором никакой наш таймер не узнает)
//! закрывает правило retry-on-stale — см. `handle_send`.
//!
//! Отмена запроса — разрыв клиентского сокета: демон бросает обмен, а
//! соединение с сервисом закрывается, не возвращаясь в пул (ответ на
//! отменённый кадр иначе прилетел бы следующему запросу). Так GUI-шная
//! отмена (дроп future с клиентской стороной сокета) работает без отдельного
//! cancel-протокола, и CLI при желании может отменять тем же способом.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Notify;

use crate::tcp::{self, ApiResponse, Connection, ExchangeOpts};

/// Сколько секунд простаивающее соединение лежит в пуле.
pub const DEFAULT_TTL_SECS: u64 = 60;

/// Через сколько секунд без запросов демон выходит сам.
pub const DEFAULT_IDLE_EXIT_SECS: u64 = 900;

/// Пул на один адрес: параллельные запросы получают каждый по соединению,
/// но копить больше нескольких смысла нет.
const MAX_IDLE_PER_ADDR: usize = 4;

/// Сокет демона. Версия в имени решает проблему «демон остался от старого
/// бинарника»: обновлённый клиент старого демона не найдёт и поднимет свой,
/// а старый выйдет сам по idle-exit. `TCP_KAI_DAEMON_SOCK` — для тестов.
pub fn socket_path() -> PathBuf {
    if let Some(p) = std::env::var_os("TCP_KAI_DAEMON_SOCK") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let base = dirs::runtime_dir().unwrap_or_else(std::env::temp_dir);
    base.join(format!("tcp-kai-{}", unsafe { libc::getuid() }))
        .join(format!("daemon-v{}.sock", env!("CARGO_PKG_VERSION")))
}

/// Секунды из env — для автоспавна и демона-потока, где флаги не передать.
fn env_secs(name: &str) -> Option<u64> {
    std::env::var(name).ok()?.parse().ok()
}

/// (ttl соединения, idle-exit демона) с учётом env-переопределений.
pub fn default_timings() -> (Duration, Duration) {
    (
        Duration::from_secs(env_secs("TCP_KAI_DAEMON_TTL").unwrap_or(DEFAULT_TTL_SECS)),
        Duration::from_secs(env_secs("TCP_KAI_DAEMON_IDLE_EXIT").unwrap_or(DEFAULT_IDLE_EXIT_SECS)),
    )
}

/// Обход демона целиком: `TCP_KAI_NO_DAEMON=1` (и `--no-daemon` в CLI).
pub fn disabled_by_env() -> bool {
    std::env::var_os("TCP_KAI_NO_DAEMON").is_some_and(|v| !v.is_empty())
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DaemonRequest {
    Send {
        connection: String,
        pattern: String,
        body: String,
        /// 0 — ждать ответа без лимита
        timeout_ms: u64,
        emit: bool,
    },
    Status,
    Stop,
}

#[derive(Serialize, Deserialize, Default)]
pub struct DaemonReply {
    pub ok: bool,
    pub message: String,
    /// запрос ушёл по соединению из пула
    #[serde(default)]
    pub reused: bool,
    /// длительность самого обмена в демоне — без спавна и unix-сокета
    #[serde(default)]
    pub elapsed_ms: f64,
}

struct Idle {
    conn: Connection,
    since: Instant,
}

struct State {
    /// Свободные соединения по адресу. Занятое из пула изъято, поэтому жнец
    /// физически не может закрыть соединение под активным запросом.
    idle: RefCell<HashMap<String, Vec<Idle>>>,
    last_activity: Cell<Instant>,
    in_flight: Cell<u32>,
    started: Instant,
    stop: Notify,
    stopping: Cell<bool>,
}

impl State {
    fn new() -> Self {
        State {
            idle: RefCell::new(HashMap::new()),
            last_activity: Cell::new(Instant::now()),
            in_flight: Cell::new(0),
            started: Instant::now(),
            stop: Notify::new(),
            stopping: Cell::new(false),
        }
    }

    fn touch(&self) {
        self.last_activity.set(Instant::now());
    }

    /// Свежайшее свободное соединение к адресу (LIFO — у него больше шансов
    /// быть ещё живым).
    fn checkout(&self, addr: &str) -> Option<Connection> {
        self.idle
            .borrow_mut()
            .get_mut(addr)
            .and_then(|v| v.pop())
            .map(|i| i.conn)
    }

    fn checkin(&self, addr: &str, conn: Connection) {
        let mut idle = self.idle.borrow_mut();
        let pool = idle.entry(addr.to_string()).or_default();
        if pool.len() < MAX_IDLE_PER_ADDR {
            pool.push(Idle {
                conn,
                since: Instant::now(),
            });
        }
    }

    fn reap(&self, ttl: Duration) {
        let mut idle = self.idle.borrow_mut();
        for pool in idle.values_mut() {
            pool.retain(|i| i.since.elapsed() <= ttl);
        }
        idle.retain(|_, pool| !pool.is_empty());
    }
}

/// Форграунд-цикл демона: слушать сокет, обслуживать клиентов, прибирать
/// пул, выйти по простою или по `Stop`.
pub async fn serve(sock: PathBuf, ttl: Duration, idle_exit: Duration) -> Result<(), String> {
    if let Some(dir) = sock.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("не создать {}: {e}", dir.display()))?;
        // сокет только владельцу: через него можно слать запросы с его
        // подключениями и переменными
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    // занятый сокет — живой демон; мёртвый файл остаётся от убитого
    if UnixStream::connect(&sock).await.is_ok() {
        return Err(format!("демон уже слушает {}", sock.display()));
    }
    let _ = std::fs::remove_file(&sock);
    let listener =
        UnixListener::bind(&sock).map_err(|e| format!("не открыть {}: {e}", sock.display()))?;
    eprintln!(
        "tcp-kai daemon: слушаю {} (ttl соединений {}s, выход после {}s простоя)",
        sock.display(),
        ttl.as_secs(),
        idle_exit.as_secs()
    );

    let state = Rc::new(State::new());
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let mut reap = tokio::time::interval(Duration::from_secs(5));
            loop {
                tokio::select! {
                    accepted = listener.accept() => match accepted {
                        Ok((stream, _)) => {
                            state.touch();
                            tokio::task::spawn_local(handle_client(stream, state.clone()));
                        }
                        Err(e) => eprintln!("tcp-kai daemon: accept: {e}"),
                    },
                    _ = reap.tick() => {
                        state.reap(ttl);
                        if state.in_flight.get() == 0
                            && state.last_activity.get().elapsed() > idle_exit
                        {
                            break;
                        }
                    }
                    _ = state.stop.notified() => break,
                }
            }
        })
        .await;
    let _ = std::fs::remove_file(&sock);
    Ok(())
}

async fn handle_client(stream: UnixStream, state: Rc<State>) {
    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(l)) => l,
            _ => return, // клиент ушёл
        };
        if line.trim().is_empty() {
            continue;
        }
        state.touch();
        let reply = match serde_json::from_str::<DaemonRequest>(&line) {
            Err(e) => DaemonReply {
                ok: false,
                message: format!("непонятный запрос: {e}"),
                ..Default::default()
            },
            Ok(DaemonRequest::Status) => status(&state),
            Ok(DaemonRequest::Stop) => {
                state.stopping.set(true);
                DaemonReply {
                    ok: true,
                    message: "демон остановлен".into(),
                    ..Default::default()
                }
            }
            Ok(DaemonRequest::Send {
                connection,
                pattern,
                body,
                timeout_ms,
                emit,
            }) => {
                // Разрыв клиентского сокета во время обмена — это отмена:
                // select дропает handle_send вместе с соединением к сервису
                // (в пул оно не возвращается — недочитанный ответ смешался бы
                // со следующим). Протокол строго «запрос → ответ», поэтому
                // строка от клиента во время обмена — мусор, а не сигнал.
                let disconnect = async {
                    loop {
                        match lines.next_line().await {
                            Ok(Some(_)) => {
                                eprintln!(
                                    "tcp-kai daemon: запрос поверх незавершённого — игнорирую"
                                )
                            }
                            _ => break,
                        }
                    }
                };
                state.in_flight.set(state.in_flight.get() + 1);
                let result = tokio::select! {
                    r = handle_send(&state, &connection, &pattern, &body, timeout_ms, emit) => Some(r),
                    _ = disconnect => None,
                };
                state.in_flight.set(state.in_flight.get() - 1);
                state.touch();
                match result {
                    Some(r) => r,
                    None => return, // отменено: клиенту отвечать некому
                }
            }
        };
        let mut out = serde_json::to_string(&reply).unwrap_or_else(|_| {
            r#"{"ok":false,"message":"ответ демона не сериализовался"}"#.into()
        });
        out.push('\n');
        if write_half.write_all(out.as_bytes()).await.is_err() {
            return;
        }
        if state.stopping.get() {
            // после ответа — чтобы `daemon stop` успел его прочитать
            state.stop.notify_waiters();
            return;
        }
    }
}

fn succeeded(r: &Result<ApiResponse, String>) -> bool {
    matches!(r, Ok(resp) if resp.ok)
}

fn fail(resp: ApiResponse) -> DaemonReply {
    DaemonReply {
        ok: resp.ok,
        message: resp.message,
        ..Default::default()
    }
}

/// Один обмен: соединение из пула или новое. Мёртвый реюз — сервер закрыл
/// соединение, пока оно простаивало, и отказ случился до первого байта ответа
/// и не по таймауту (`retry_safe`) — прозрачно повторяется один раз на свежем
/// соединении. После таймаута или на начатом ответе повтора нет: сервис мог
/// принять запрос в работу.
async fn handle_send(
    state: &State,
    addr: &str,
    pattern: &str,
    body: &str,
    timeout_ms: u64,
    emit: bool,
) -> DaemonReply {
    let opts = ExchangeOpts {
        timeout: (timeout_ms > 0).then(|| Duration::from_millis(timeout_ms)),
        emit,
        trace: false,
    };

    let (mut conn, mut reused) = match state.checkout(addr) {
        Some(c) => (c, true),
        None => match Connection::open(addr, false).await {
            Ok(c) => (c, false),
            Err(resp) => return fail(resp),
        },
    };

    let started = Instant::now();
    let mut result = conn.exchange(pattern, body, &opts).await;

    if reused && !succeeded(&result) && conn.retry_safe() {
        match Connection::open(addr, false).await {
            Ok(fresh) => {
                conn = fresh;
                reused = false;
                result = conn.exchange(pattern, body, &opts).await;
            }
            Err(resp) => return fail(resp),
        }
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    if conn.reusable() {
        state.checkin(addr, conn);
    }

    let (ok, message) = match result {
        Ok(resp) => (resp.ok, resp.message),
        Err(e) => (false, e),
    };
    DaemonReply {
        ok,
        message,
        reused,
        elapsed_ms,
    }
}

fn status(state: &State) -> DaemonReply {
    let idle = state.idle.borrow();
    let pools: Vec<String> = idle
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(addr, v)| {
            let oldest = v
                .iter()
                .map(|i| i.since.elapsed().as_secs())
                .max()
                .unwrap_or(0);
            format!("{addr}: свободных {} (старшему {}s)", v.len(), oldest)
        })
        .collect();
    let message = format!(
        "tcp-kai daemon v{}\nаптайм {}s, запросов в работе: {}\nпул: {}",
        env!("CARGO_PKG_VERSION"),
        state.started.elapsed().as_secs(),
        state.in_flight.get(),
        if pools.is_empty() {
            "пусто".to_string()
        } else {
            format!("\n  {}", pools.join("\n  "))
        }
    );
    DaemonReply {
        ok: true,
        message,
        ..Default::default()
    }
}

/// Запрос демону без попыток его поднять (stop/status; поднимающие обёртки —
/// у CLI спавн процесса, у GUI поток — живут поверх).
pub async fn call(
    sock: &Path,
    req: &DaemonRequest,
    wait: Option<Duration>,
) -> Result<DaemonReply, String> {
    let stream = UnixStream::connect(sock)
        .await
        .map_err(|e| format!("демон не отвечает на {}: {e}", sock.display()))?;
    roundtrip(stream, req, wait).await
}

/// Строка запроса → строка ответа по уже открытому сокету.
pub async fn roundtrip(
    stream: UnixStream,
    req: &DaemonRequest,
    wait: Option<Duration>,
) -> Result<DaemonReply, String> {
    let (read_half, mut write_half) = stream.into_split();
    let mut line = serde_json::to_string(req).map_err(|e| e.to_string())?;
    line.push('\n');
    write_half
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("демону не отправить: {e}"))?;

    let mut reply = String::new();
    let mut reader = BufReader::new(read_half);
    let read = reader.read_line(&mut reply);
    let n = match wait {
        Some(limit) => tokio::time::timeout(limit, read)
            .await
            .map_err(|_| "демон не ответил вовремя".to_string())?,
        None => read.await,
    }
    .map_err(|e| format!("ответ демона не прочитан: {e}"))?;
    if n == 0 {
        return Err("демон закрыл соединение без ответа".into());
    }
    serde_json::from_str(&reply).map_err(|e| format!("ответ демона не разобрался: {e}"))
}

/// Ожидание, пока демон займёт сокет (после спавна процесса или потока).
pub async fn connect_retry(sock: &Path, total: Duration) -> Result<UnixStream, String> {
    let deadline = Instant::now() + total;
    loop {
        match UnixStream::connect(sock).await {
            Ok(s) => return Ok(s),
            Err(e) => {
                if Instant::now() >= deadline {
                    return Err(format!("демон не поднялся за {total:?}: {e}"));
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
}

/// Демон-поток запущен этим процессом (для долгоживущих процессов — GUI).
static THREAD_RUNNING: AtomicBool = AtomicBool::new(false);

/// Поднимает демона потоком внутри текущего процесса, если сокет молчит.
/// Умерший по idle-exit поток перезапускается следующим вызовом; если сокет
/// успел занять чужой демон (CLI) — поток тихо выйдет, а клиент подключится
/// к чужому.
fn ensure_daemon_thread(sock: &Path) {
    if THREAD_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let sock = sock.to_path_buf();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build();
        if let Ok(rt) = rt {
            let (ttl, idle_exit) = default_timings();
            if let Err(e) = rt.block_on(serve(sock, ttl, idle_exit)) {
                eprintln!("tcp-kai daemon (поток): {e}");
            }
        }
        THREAD_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Обмен для долгоживущего процесса (GUI): через общий демон, поднимая его
/// потоком при необходимости; демон недоступен или обход (`-v`-трасса,
/// `TCP_KAI_NO_DAEMON`) — напрямую. Дроп future отменяет запрос: клиентский
/// сокет закрывается, демон бросает обмен.
pub async fn exchange_keepalive(
    connection: &str,
    pattern: &str,
    json: &str,
    opts: &ExchangeOpts,
) -> Result<ApiResponse, String> {
    if opts.trace || disabled_by_env() {
        return tcp::exchange(connection, pattern, json, opts).await;
    }
    match exchange_keepalive_at(&socket_path(), connection, pattern, json, opts).await {
        Ok(resp) => Ok(resp),
        Err(_) => tcp::exchange(connection, pattern, json, opts).await,
    }
}

async fn exchange_keepalive_at(
    sock: &Path,
    connection: &str,
    pattern: &str,
    json: &str,
    opts: &ExchangeOpts,
) -> Result<ApiResponse, String> {
    let stream = match UnixStream::connect(sock).await {
        Ok(s) => s,
        Err(_) => {
            ensure_daemon_thread(sock);
            connect_retry(sock, Duration::from_secs(3)).await?
        }
    };
    let req = DaemonRequest::Send {
        connection: connection.to_string(),
        pattern: pattern.to_string(),
        body: json.to_string(),
        timeout_ms: opts.timeout.map_or(0, |d| d.as_millis() as u64),
        emit: opts.emit,
    };
    // ждём дольше таймаута обмена: демону нужно время на connect и хвосты
    let wait = opts.timeout.map(|d| d + Duration::from_secs(15));
    let reply = roundtrip(stream, &req, wait).await?;
    Ok(ApiResponse {
        ok: reply.ok,
        message: reply.message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;
    use tokio::task::LocalSet;

    /// TCP-«сервис»: на каждый кадр отвечает NestJS-конвертом с id из кадра.
    /// `close_after_first` — закрыть соединение после первого ответа
    /// (серверный idle-close, из-за которого и нужен retry-on-stale).
    async fn tcp_service(close_after_first: bool) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr").to_string();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = match listener.accept().await {
                    Ok(x) => x,
                    Err(_) => return,
                };
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 64 * 1024];
                    loop {
                        let n = match socket.read(&mut buf).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => n,
                        };
                        let text = String::from_utf8_lossy(&buf[..n]);
                        let body = text.split_once('#').map(|(_, b)| b).unwrap_or("");
                        let id = serde_json::from_str::<serde_json::Value>(body)
                            .ok()
                            .and_then(|v| v.get("id").and_then(|i| i.as_str()).map(str::to_string))
                            .unwrap_or_default();
                        let envelope = format!(
                            r#"{{"err":null,"response":{{"pong":true}},"isDisposed":true,"id":"{id}"}}"#
                        );
                        let frame = format!("{}#{}", envelope.chars().count(), envelope);
                        if socket.write_all(frame.as_bytes()).await.is_err() {
                            return;
                        }
                        let _ = socket.flush().await;
                        if close_after_first {
                            return; // drop закрывает сокет
                        }
                    }
                });
            }
        });
        addr
    }

    /// Молчащий TCP-«сервис»: принимает кадры и никогда не отвечает — на нём
    /// проверяется отмена, пока обмен висит в ожидании.
    async fn silent_tcp_service() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr").to_string();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = match listener.accept().await {
                    Ok(x) => x,
                    Err(_) => return,
                };
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 64 * 1024];
                    while matches!(socket.read(&mut buf).await, Ok(n) if n > 0) {}
                });
            }
        });
        addr
    }

    fn test_sock(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("tcp-kai-test-{}-{name}.sock", std::process::id()))
    }

    fn send_req(addr: &str) -> DaemonRequest {
        DaemonRequest::Send {
            connection: addr.to_string(),
            pattern: "ping".into(),
            body: "{}".into(),
            timeout_ms: 5_000,
            emit: false,
        }
    }

    async fn call_send(sock: &Path, addr: &str) -> DaemonReply {
        call(sock, &send_req(addr), Some(Duration::from_secs(10)))
            .await
            .expect("call")
    }

    async fn daemon_status(sock: &Path) -> String {
        call(sock, &DaemonRequest::Status, Some(Duration::from_secs(5)))
            .await
            .expect("status")
            .message
    }

    async fn stop_daemon(sock: &Path) {
        let _ = call(sock, &DaemonRequest::Stop, Some(Duration::from_secs(5))).await;
    }

    /// serve + тело теста в одном LocalSet, с остановкой демона в конце.
    async fn with_daemon<F, Fut>(sock: PathBuf, body: F)
    where
        F: FnOnce(PathBuf) -> Fut + 'static,
        Fut: std::future::Future<Output = ()>,
    {
        let _ = std::fs::remove_file(&sock);
        let local = LocalSet::new();
        local
            .run_until(async {
                let server = tokio::task::spawn_local(serve(
                    sock.clone(),
                    Duration::from_secs(30),
                    Duration::from_secs(30),
                ));
                connect_retry(&sock, Duration::from_secs(3))
                    .await
                    .expect("daemon up");
                body(sock.clone()).await;
                stop_daemon(&sock).await;
                let _ = server.await;
            })
            .await;
    }

    #[tokio::test]
    async fn daemon_reuses_pooled_connection() {
        let addr = tcp_service(false).await;
        with_daemon(test_sock("reuse"), move |sock| async move {
            let first = call_send(&sock, &addr).await;
            assert!(first.ok, "{}", first.message);
            assert!(!first.reused, "первый запрос всегда на свежем соединении");

            let second = call_send(&sock, &addr).await;
            assert!(second.ok, "{}", second.message);
            assert!(second.reused, "второй запрос должен уйти по пулу");
        })
        .await;
    }

    #[tokio::test]
    async fn daemon_retries_stale_pooled_connection() {
        // сервис закрывает соединение после каждого ответа — ко второму
        // запросу пул держит мёртвое; демон должен молча передоткнуться
        let addr = tcp_service(true).await;
        with_daemon(test_sock("stale"), move |sock| async move {
            let first = call_send(&sock, &addr).await;
            assert!(first.ok, "{}", first.message);

            tokio::time::sleep(Duration::from_millis(50)).await; // FIN долетает до пула
            let second = call_send(&sock, &addr).await;
            assert!(
                second.ok,
                "мёртвый реюз должен повториться на свежем: {}",
                second.message
            );
            assert!(
                !second.reused,
                "после мёртвого реюза ответ приходит со свежего соединения"
            );
        })
        .await;
    }

    #[tokio::test]
    async fn client_disconnect_cancels_in_flight_exchange() {
        // клиент рвёт сокет, пока сервис молчит: демон должен бросить обмен,
        // выкинуть соединение (не в пул) и жить дальше
        let addr = silent_tcp_service().await;
        with_daemon(test_sock("cancel"), move |sock| async move {
            let stream = UnixStream::connect(&sock).await.expect("connect");
            let (_, mut write_half) = stream.into_split();
            let mut line = serde_json::to_string(&send_req(&addr)).expect("json");
            line.push('\n');
            write_half.write_all(line.as_bytes()).await.expect("write");
            tokio::time::sleep(Duration::from_millis(100)).await; // обмен повис в ожидании
            drop(write_half); // отмена: клиент ушёл

            // демон замечает разрыв и снимает запрос с полёта
            let mut cancelled = false;
            for _ in 0..20 {
                tokio::time::sleep(Duration::from_millis(50)).await;
                if daemon_status(&sock).await.contains("в работе: 0") {
                    cancelled = true;
                    break;
                }
            }
            assert!(cancelled, "запрос не снялся с полёта после разрыва");
            assert!(
                daemon_status(&sock).await.contains("пул: пусто"),
                "брошенное соединение не должно попасть в пул"
            );
        })
        .await;
    }

    #[tokio::test]
    async fn exchange_keepalive_spawns_daemon_thread_and_reuses() {
        // путь GUI: демона нет — поднимается потоком, обмены идут через пул
        let sock = test_sock("thread");
        let _ = std::fs::remove_file(&sock);
        let addr = tcp_service(false).await;
        let opts = ExchangeOpts::default();

        let first = exchange_keepalive_at(&sock, &addr, "ping", "{}", &opts)
            .await
            .expect("first");
        assert!(first.ok, "{}", first.message);
        let second = exchange_keepalive_at(&sock, &addr, "ping", "{}", &opts)
            .await
            .expect("second");
        assert!(second.ok, "{}", second.message);

        assert!(
            daemon_status(&sock).await.contains(&addr),
            "в пуле демона-потока должно лежать соединение"
        );
        stop_daemon(&sock).await;
    }
}
