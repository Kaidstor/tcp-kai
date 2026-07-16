//! Протокол NestJS-транспорта: кадр `<число_символов>#{json}`.
//!
//! Модуль намеренно ничего не знает про Tauri — поверх него работают и
//! GUI-команды (`commands.rs`), и CLI (`bin/tcp-kai-cli`), чтобы у приложения
//! и у `tcp-kai` не разъезжались проволока и разбор ответа.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// Сколько ждём установления соединения.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Сколько ждём ответа после отправки, если вызывающий не задал своё.
/// Раньше лимита не было вовсе: молчащий сервис подвешивал запрос навсегда.
pub const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Настройки обмена. `Default` повторяет поведение GUI: ждать ответ
/// с дефолтным таймаутом, без трассировки.
pub struct ExchangeOpts {
    /// Лимит ожидания ответа после отправки кадра; `None` — без лимита.
    pub timeout: Option<Duration>,
    /// Event-паттерн (`@EventPattern`): кадр без `id`, ответ не ждём.
    pub emit: bool,
    /// Печатать кадр в stderr. По умолчанию выключен: в теле может лежать
    /// подставленный секрет (`--from-sec`), которому нечего делать в логах.
    pub trace: bool,
}

impl Default for ExchangeOpts {
    fn default() -> Self {
        ExchangeOpts {
            timeout: Some(DEFAULT_READ_TIMEOUT),
            emit: false,
            trace: false,
        }
    }
}

/// Ответ в том виде, в каком его ждёт фронтенд: `ok` + текст/JSON в `message`.
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

/// Тело запроса как JSON-значение. Тело, которое не разбирается как JSON,
/// уезжает как `null` — так вело себя приложение до появления CLI, и на это
/// опираются запросы без тела (GUI с недавних пор предупреждает об этом
/// до отправки).
fn parse_body(json: &str) -> serde_json::Value {
    if json.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(json).unwrap_or(serde_json::Value::Null)
    }
}

/// Обрамляет полезную нагрузку длиной. NestJS меряет длину в символах
/// (`string.length`), а не в байтах, поэтому `chars().count()` — с кириллицей
/// в теле `len()` разъедется.
fn frame(payload: &serde_json::Value) -> String {
    // json!-объект из строк и Value сериализуется всегда
    let body = serde_json::to_string(payload).expect("serialize payload");
    format!("{}#{}", body.chars().count(), body)
}

/// Кадр message-паттерна (`@MessagePattern`): сервис ответит на тот же `id`.
pub fn build_frame(pattern: &str, json: &str) -> String {
    frame(&serde_json::json!({
        "pattern": pattern,
        "data": parse_body(json),
        "id": "unique_id_12345",
    }))
}

/// Кадр event-паттерна (`@EventPattern`): без `id`, ответа не бывает.
pub fn build_event_frame(pattern: &str, json: &str) -> String {
    frame(&serde_json::json!({
        "pattern": pattern,
        "data": parse_body(json),
    }))
}

/// Полный обмен: подключиться, отправить кадр, прочитать ответ (для emit —
/// только отправить).
///
/// `Ok(ApiResponse { ok: false, .. })` — до сервиса не достучались, не смогли
/// отправить или ответ не пришёл за таймаут; `Err` — ответ не прочитался. Это
/// разделение сохранено с доCLI-времён: фронтенд показывает их по-разному
/// («Error in …» против «Failed in …»).
pub async fn exchange(
    connection: &str,
    pattern: &str,
    json: &str,
    opts: &ExchangeOpts,
) -> Result<ApiResponse, String> {
    let mut stream = match connect(connection, opts.trace).await {
        Ok(s) => s,
        Err(resp) => return Ok(resp),
    };

    let frame = if opts.emit {
        build_event_frame(pattern, json)
    } else {
        build_frame(pattern, json)
    };
    if opts.trace {
        eprintln!("send: {}", frame);
    }

    if let Err(e) = stream.write_all(frame.as_bytes()).await {
        return Ok(ApiResponse::error(format!("Failed to send data: {}", e)));
    }
    if let Err(e) = stream.flush().await {
        return Ok(ApiResponse::error(format!("Failed to flush stream: {}", e)));
    }

    if opts.emit {
        // событие ушло; ответа у @EventPattern не бывает
        return Ok(ApiResponse::new(String::new()));
    }

    let read = read_full_response(stream);
    let message = match opts.timeout {
        Some(limit) => match timeout(limit, read).await {
            Ok(res) => res?,
            Err(_) => {
                return Ok(ApiResponse::error(format!(
                    "No response within {:?}",
                    limit
                )))
            }
        },
        None => read.await?,
    };
    Ok(ApiResponse::new(message))
}

/// Подключение с таймаутом. `Err` здесь — это «ожидаемый» отказ, который
/// приезжает пользователю как `ApiResponse`, а не как сбой команды.
async fn connect(connection: &str, trace: bool) -> Result<TcpStream, ApiResponse> {
    match timeout(CONNECT_TIMEOUT, TcpStream::connect(connection)).await {
        Ok(Ok(stream)) => {
            if trace {
                eprintln!("connected to {}", connection);
            }
            Ok(stream)
        }
        Ok(Err(e)) => Err(ApiResponse::error(format!("TCP connection error: {}", e))),
        Err(_) => Err(ApiResponse::error(format!(
            "Connection to {} timed out after {:?}",
            connection, CONNECT_TIMEOUT
        ))),
    }
}

/// Префикс длины: цифры до маркера `#`.
async fn read_message_length(reader: &mut BufReader<TcpStream>) -> Result<usize, String> {
    let mut len_str = String::new();
    let mut buf = [0; 1];
    loop {
        reader.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
        if buf[0] == b'#' {
            break;
        }
        len_str.push(buf[0] as char);
    }
    len_str.parse::<usize>().map_err(|e| e.to_string())
}

/// Ответ целиком. Длина снова в символах, а не в байтах, поэтому читаем
/// посимвольно, добирая продолжение UTF-8 по стартовому байту. Побайтовые
/// чтения идут через BufReader — иначе на мегабайтном ответе это был бы
/// syscall на каждый байт.
async fn read_full_response(stream: TcpStream) -> Result<String, String> {
    let mut reader = BufReader::with_capacity(64 * 1024, stream);
    let char_count = read_message_length(&mut reader).await?;
    let mut result = String::with_capacity(char_count);

    for _ in 0..char_count {
        let mut first = [0u8; 1];
        reader
            .read_exact(&mut first)
            .await
            .map_err(|e| e.to_string())?;

        let char_len = match first[0] {
            b if b & 0x80 == 0 => 1,
            b if b & 0xE0 == 0xC0 => 2,
            b if b & 0xF0 == 0xE0 => 3,
            b if b & 0xF8 == 0xF0 => 4,
            _ => return Err("Invalid UTF-8 start byte".to_string()),
        };

        let mut bytes = [0u8; 4];
        bytes[0] = first[0];
        if char_len > 1 {
            reader
                .read_exact(&mut bytes[1..char_len])
                .await
                .map_err(|e| e.to_string())?;
        }

        match std::str::from_utf8(&bytes[..char_len]) {
            Ok(s) => result.push_str(s),
            Err(e) => return Err(format!("Invalid UTF-8 sequence: {}", e)),
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn frame_length_counts_characters_not_bytes() {
        // «привет» — 6 символов, 12 байт: длина кадра должна быть по символам,
        // иначе NestJS ждёт продолжения и запрос виснет
        let frame = build_frame("ping", r#"{"msg":"привет"}"#);
        let (len, body) = frame.split_once('#').expect("маркер длины");
        assert_eq!(len.parse::<usize>().unwrap(), body.chars().count());
        assert_ne!(body.chars().count(), body.len());
    }

    #[test]
    fn empty_body_becomes_null() {
        assert!(build_frame("ping", "").contains(r#""data":null"#));
    }

    #[test]
    fn invalid_body_becomes_null() {
        assert!(build_frame("ping", "{не json").contains(r#""data":null"#));
    }

    #[test]
    fn event_frame_has_no_id() {
        let frame = build_event_frame("ping", r#"{"a":1}"#);
        assert!(!frame.contains(r#""id""#));
        assert!(frame.contains(r#""pattern":"ping""#));
    }

    /// Однократный сервер: принимает соединение, читает всё до EOF-паузы,
    /// отвечает `response` и закрывается. Возвращает адрес и ручку задачи,
    /// из которой можно достать принятый кадр.
    async fn one_shot_server(
        response: Option<String>,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr").to_string();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            // читаем первый кусок — для тестов кадр всегда влезает в один write
            let mut buf = vec![0u8; 64 * 1024];
            let n = socket.read(&mut buf).await.expect("read");
            let received = String::from_utf8_lossy(&buf[..n]).to_string();
            if let Some(resp) = response {
                socket.write_all(resp.as_bytes()).await.expect("write");
                socket.flush().await.expect("flush");
            }
            received
        });
        (addr, handle)
    }

    /// Кадр из envelope-строки — как его собрал бы NestJS (длина в символах).
    fn server_frame(body: &str) -> String {
        format!("{}#{}", body.chars().count(), body)
    }

    #[tokio::test]
    async fn exchange_round_trip_with_cyrillic() {
        let envelope = r#"{"err":null,"response":{"msg":"привет, мир"},"isDisposed":true,"id":"unique_id_12345"}"#;
        let (addr, server) = one_shot_server(Some(server_frame(envelope))).await;

        let resp = exchange(&addr, "ping", r#"{"кто":"я"}"#, &ExchangeOpts::default())
            .await
            .expect("exchange");
        assert!(resp.ok);
        assert_eq!(resp.message, envelope);

        // серверу уехал корректный кадр: длина в символах и наш id
        let received = server.await.expect("server");
        let (len, body) = received.split_once('#').expect("маркер длины");
        assert_eq!(len.parse::<usize>().unwrap(), body.chars().count());
        assert!(body.contains(r#""id":"unique_id_12345""#));
    }

    #[tokio::test]
    async fn exchange_times_out_on_silent_server() {
        // сервер принимает кадр и молчит, не закрывая соединение — иначе
        // клиент получил бы EOF раньше таймаута
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr").to_string();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut buf = vec![0u8; 64 * 1024];
            let _ = socket.read(&mut buf).await;
            tokio::time::sleep(Duration::from_secs(30)).await;
            drop(socket);
        });

        let opts = ExchangeOpts {
            timeout: Some(Duration::from_millis(200)),
            ..ExchangeOpts::default()
        };
        let resp = exchange(&addr, "ping", "{}", &opts).await.expect("exchange");
        assert!(!resp.ok);
        assert!(resp.message.contains("No response within"), "{}", resp.message);
    }

    #[tokio::test]
    async fn exchange_fails_on_truncated_response() {
        // сервер обещает 100 символов, а присылает десяток и закрывается
        let (addr, _server) = one_shot_server(Some("100#{\"err\":null".to_string())).await;

        let err = exchange(&addr, "ping", "{}", &ExchangeOpts::default())
            .await
            .expect_err("обрыв посреди ответа — это Err");
        assert!(err.contains("early eof") || err.contains("eof"), "{err}");
    }

    #[tokio::test]
    async fn emit_sends_event_frame_and_returns_immediately() {
        // сервер ничего не отвечает — emit и не должен ждать
        let (addr, server) = one_shot_server(None).await;

        let opts = ExchangeOpts {
            emit: true,
            timeout: Some(Duration::from_secs(5)),
            ..ExchangeOpts::default()
        };
        let resp = exchange(&addr, "user.created", r#"{"id":7}"#, &opts)
            .await
            .expect("exchange");
        assert!(resp.ok);
        assert_eq!(resp.message, "");

        let received = server.await.expect("server");
        assert!(!received.contains(r#""id":"unique_id"#), "{received}");
        assert!(received.contains(r#""pattern":"user.created""#));
    }
}
