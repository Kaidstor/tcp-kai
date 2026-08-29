//! Протокол NestJS-транспорта: кадр `<число_символов>#{json}`.
//!
//! Модуль намеренно ничего не знает про Tauri — поверх него работают и
//! GUI-команды (`commands.rs`), и CLI (`bin/tcp-kai-cli`), чтобы у приложения
//! и у `tcp-kai` не разъезжались проволока и разбор ответа.
//!
//! `Connection` переживает несколько обменов подряд — на нём стоит пул
//! keep-alive-демона (`daemon.rs`), общего для GUI и CLI. Одноразовый
//! `exchange` — прямой путь: фолбэк при недоступном демоне и `-v`-трасса.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
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

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Уникальный id кадра. Пока соединение жило один запрос, хватало константы;
/// с пулом id — единственный способ убедиться, что читаем ответ именно на
/// свой кадр, а не хвост предыдущего обмена.
fn next_id() -> String {
    format!(
        "kai-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
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

/// Длина кадра в единицах NestJS. `json-socket.js` пишет и читает
/// `string.length` JS-строки — это UTF-16 code units, а не байты и не символы:
/// кириллица считается за один, а всё вне BMP (эмодзи, часть CJK) — за два.
/// Байты разъедутся на любой кириллице, символы — на первом же эмодзи.
fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Обрамляет полезную нагрузку длиной.
fn frame(payload: &serde_json::Value) -> String {
    // json!-объект из строк и Value сериализуется всегда
    let body = serde_json::to_string(payload).expect("serialize payload");
    format!("{}#{}", utf16_len(&body), body)
}

/// Кадр message-паттерна (`@MessagePattern`): сервис ответит на тот же `id`.
pub fn build_frame(pattern: &str, json: &str, id: &str) -> String {
    frame(&serde_json::json!({
        "pattern": pattern,
        "data": parse_body(json),
        "id": id,
    }))
}

/// Кадр event-паттерна (`@EventPattern`): без `id`, ответа не бывает.
pub fn build_event_frame(pattern: &str, json: &str) -> String {
    frame(&serde_json::json!({
        "pattern": pattern,
        "data": parse_body(json),
    }))
}

/// TCP-соединение с сервисом, переживающее несколько обменов подряд.
///
/// Дисциплина — один кадр в полёте: `exchange` отправляет кадр и дочитывает
/// ответ до конца, мультиплексирования нет. После таймаута или ошибки
/// соединение отравлено (`reusable() == false`): недочитанные байты в нём
/// смешались бы со следующим ответом.
pub struct Connection {
    reader: BufReader<TcpStream>,
    poisoned: bool,
    /// в последнем обмене успели прочитать хотя бы байт ответа
    response_started: bool,
    /// последний обмен упал по таймауту ожидания ответа
    timed_out: bool,
}

impl Connection {
    /// Подключение с таймаутом. `Err` здесь — это «ожидаемый» отказ, который
    /// приезжает пользователю как `ApiResponse`, а не как сбой команды.
    pub async fn open(connection: &str, trace: bool) -> Result<Self, ApiResponse> {
        match timeout(CONNECT_TIMEOUT, TcpStream::connect(connection)).await {
            Ok(Ok(stream)) => {
                if trace {
                    eprintln!("connected to {}", connection);
                }
                Ok(Connection {
                    reader: BufReader::with_capacity(64 * 1024, stream),
                    poisoned: false,
                    response_started: false,
                    timed_out: false,
                })
            }
            Ok(Err(e)) => Err(ApiResponse::error(format!("TCP connection error: {}", e))),
            Err(_) => Err(ApiResponse::error(format!(
                "Connection to {} timed out after {:?}",
                connection, CONNECT_TIMEOUT
            ))),
        }
    }

    /// Можно ли вернуть соединение в пул: последний обмен завершился чисто.
    pub fn reusable(&self) -> bool {
        !self.poisoned
    }

    /// Можно ли после неудачного обмена молча повторить кадр на свежем
    /// соединении: отказ случился до первого байта ответа и не по таймауту —
    /// то есть переиспользованное соединение оказалось уже закрытым сервером.
    /// Иначе сервис мог принять запрос в работу, и повтор — двойное выполнение.
    pub fn retry_safe(&self) -> bool {
        !self.response_started && !self.timed_out
    }

    /// Один обмен: отправить кадр, прочитать ответ (для emit — только
    /// отправить).
    ///
    /// `Ok(ApiResponse { ok: false, .. })` — не смогли отправить или ответ не
    /// пришёл за таймаут; `Err` — ответ не прочитался. Это разделение
    /// сохранено с доCLI-времён: фронтенд показывает их по-разному
    /// («Error in …» против «Failed in …»).
    pub async fn exchange(
        &mut self,
        pattern: &str,
        json: &str,
        opts: &ExchangeOpts,
    ) -> Result<ApiResponse, String> {
        self.response_started = false;
        self.timed_out = false;

        let id = next_id();
        let frame = if opts.emit {
            build_event_frame(pattern, json)
        } else {
            build_frame(pattern, json, &id)
        };
        if opts.trace {
            eprintln!("send: {}", frame);
        }

        let stream = self.reader.get_mut();
        if let Err(e) = stream.write_all(frame.as_bytes()).await {
            self.poisoned = true;
            return Ok(ApiResponse::error(format!("Failed to send data: {}", e)));
        }
        if let Err(e) = stream.flush().await {
            self.poisoned = true;
            return Ok(ApiResponse::error(format!("Failed to flush stream: {}", e)));
        }

        if opts.emit {
            // событие ушло; ответа у @EventPattern не бывает
            return Ok(ApiResponse::new(String::new()));
        }

        let message = match opts.timeout {
            Some(limit) => match timeout(limit, self.read_response(&id)).await {
                Ok(res) => res?,
                Err(_) => {
                    // недочитанный ответ может приехать позже и попасть в
                    // следующий обмен — после таймаута соединение только
                    // закрывать
                    self.timed_out = true;
                    self.poisoned = true;
                    return Ok(ApiResponse::error(format!(
                        "No response within {:?}",
                        limit
                    )));
                }
            },
            None => self.read_response(&id).await?,
        };
        Ok(ApiResponse::new(message))
    }

    /// Чтение ответа; любая ошибка отравляет соединение.
    async fn read_response(&mut self, id: &str) -> Result<String, String> {
        match self.read_response_inner(id).await {
            Ok(message) => Ok(message),
            Err(e) => {
                self.poisoned = true;
                Err(e)
            }
        }
    }

    async fn read_response_inner(&mut self, id: &str) -> Result<String, String> {
        let code_units = self.read_message_length().await?;
        let body = self.read_body(code_units).await?;

        // Конверт проверяется ради пула: ответ должен быть на наш кадр и быть
        // последним (isDisposed). Непонятный конверт отдаётся как есть — так
        // приложение вело себя всегда — но такое соединение не переиспользуем.
        match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(envelope) => {
                match envelope.get("id").and_then(|v| v.as_str()) {
                    Some(got) if got == id => {}
                    Some(got) => {
                        return Err(format!(
                            "ответ на чужой кадр: ждали id {id}, пришёл {got} — соединение рассинхронизировано"
                        ));
                    }
                    None => self.poisoned = true,
                }
                // Observable шлёт несколько кадров: недочитанный остаток при
                // переиспользовании попал бы в чужой ответ
                if !envelope
                    .get("isDisposed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    self.poisoned = true;
                }
            }
            Err(_) => self.poisoned = true,
        }
        Ok(body)
    }

    /// Префикс длины: цифры до маркера `#`.
    async fn read_message_length(&mut self) -> Result<usize, String> {
        let mut len_str = String::new();
        let mut buf = [0; 1];
        loop {
            self.reader
                .read_exact(&mut buf)
                .await
                .map_err(|e| e.to_string())?;
            self.response_started = true;
            if buf[0] == b'#' {
                break;
            }
            len_str.push(buf[0] as char);
        }
        len_str.parse::<usize>().map_err(|e| e.to_string())
    }

    /// Тело ответа целиком. Длина снова в UTF-16 code units, а не в байтах и не
    /// в символах, поэтому читаем посимвольно (продолжение UTF-8 добираем по
    /// стартовому байту) и списываем со счётчика `len_utf16` символа: эмодзи в
    /// ответе стоит два code unit. Считать его за один — значит просить у
    /// сервера символы, которых в кадре нет, и повиснуть до таймаута.
    /// Побайтовые чтения идут через BufReader — иначе на мегабайтном ответе
    /// это был бы syscall на каждый байт.
    async fn read_body(&mut self, code_units: usize) -> Result<String, String> {
        let mut result = String::with_capacity(code_units);
        let mut left = code_units;

        while left > 0 {
            let mut first = [0u8; 1];
            self.reader
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
                self.reader
                    .read_exact(&mut bytes[1..char_len])
                    .await
                    .map_err(|e| e.to_string())?;
            }

            match std::str::from_utf8(&bytes[..char_len]) {
                // saturating: длина, обрывающая суррогатную пару пополам,
                // — испорченный кадр, но дочитывать символ всё равно надо
                Ok(s) => {
                    left = left.saturating_sub(utf16_len(s));
                    result.push_str(s);
                }
                Err(e) => return Err(format!("Invalid UTF-8 sequence: {}", e)),
            }
        }

        Ok(result)
    }
}

/// Полный обмен на одноразовом соединении: подключиться, отправить кадр,
/// прочитать ответ. Так работают GUI и прямой (бездемонный) путь CLI; пул
/// keep-alive-демона держит `Connection` сам.
pub async fn exchange(
    connection: &str,
    pattern: &str,
    json: &str,
    opts: &ExchangeOpts,
) -> Result<ApiResponse, String> {
    let mut conn = match Connection::open(connection, opts.trace).await {
        Ok(c) => c,
        Err(resp) => return Ok(resp),
    };
    conn.exchange(pattern, json, opts).await
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
        let frame = build_frame("ping", r#"{"msg":"привет"}"#, "test-id");
        let (len, body) = frame.split_once('#').expect("маркер длины");
        assert_eq!(len.parse::<usize>().unwrap(), body.chars().count());
        assert_ne!(body.chars().count(), body.len());
    }

    #[test]
    fn frame_length_counts_utf16_code_units() {
        // флаг 🇷🇺 — два символа вне BMP, у JS это четыре code unit:
        // по `chars().count()` кадр оказался бы на два короче, чем ждёт NestJS
        let frame = build_frame("ping", r#"{"msg":"🇷🇺"}"#, "test-id");
        let (len, body) = frame.split_once('#').expect("маркер длины");
        assert_eq!(len.parse::<usize>().unwrap(), body.encode_utf16().count());
        assert_eq!(body.encode_utf16().count(), body.chars().count() + 2);
    }

    #[test]
    fn empty_body_becomes_null() {
        assert!(build_frame("ping", "", "test-id").contains(r#""data":null"#));
    }

    #[test]
    fn invalid_body_becomes_null() {
        assert!(build_frame("ping", "{не json", "test-id").contains(r#""data":null"#));
    }

    #[test]
    fn event_frame_has_no_id() {
        let frame = build_event_frame("ping", r#"{"a":1}"#);
        assert!(!frame.contains(r#""id""#));
        assert!(frame.contains(r#""pattern":"ping""#));
    }

    /// Однократный сервер с сырым ответом: принимает соединение, читает первый
    /// кусок, отвечает `response` как есть и закрывается. Возвращает адрес и
    /// ручку задачи, из которой можно достать принятый кадр.
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

    /// Кадр из envelope-строки — ровно как его собрал бы NestJS: длина в
    /// UTF-16 code units (`json-socket.js` берёт `string.length` JS-строки).
    fn server_frame(body: &str) -> String {
        format!("{}#{}", body.encode_utf16().count(), body)
    }

    async fn envelope_server(frames: usize) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        envelope_server_with(frames, "привет, мир").await
    }

    /// «Сервис» на одно соединение: отвечает на `frames` кадров NestJS-конвертом
    /// с id из принятого кадра и закрывается. Возвращает адрес и принятые кадры.
    async fn envelope_server_with(
        frames: usize,
        msg: &str,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr").to_string();
        let msg = msg.to_string();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut received = Vec::new();
            let mut buf = vec![0u8; 64 * 1024];
            for _ in 0..frames {
                let n = socket.read(&mut buf).await.expect("read");
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let body = text
                    .split_once('#')
                    .map(|(_, b)| b.to_string())
                    .unwrap_or_default();
                let id = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|v| v.get("id").and_then(|i| i.as_str()).map(str::to_string))
                    .unwrap_or_default();
                let envelope = format!(
                    r#"{{"err":null,"response":{{"msg":"{msg}"}},"isDisposed":true,"id":"{id}"}}"#
                );
                socket
                    .write_all(server_frame(&envelope).as_bytes())
                    .await
                    .expect("write");
                socket.flush().await.expect("flush");
                received.push(text);
            }
            received
        });
        (addr, handle)
    }

    /// Id из уехавшего на сервер кадра.
    fn sent_id(frame: &str) -> String {
        let body = frame.split_once('#').expect("маркер длины").1;
        serde_json::from_str::<serde_json::Value>(body).expect("json")["id"]
            .as_str()
            .expect("id")
            .to_string()
    }

    #[tokio::test]
    async fn exchange_round_trip_with_cyrillic() {
        let (addr, server) = envelope_server(1).await;

        let resp = exchange(&addr, "ping", r#"{"кто":"я"}"#, &ExchangeOpts::default())
            .await
            .expect("exchange");
        assert!(resp.ok);
        let envelope: serde_json::Value = serde_json::from_str(&resp.message).expect("json");
        assert_eq!(envelope["response"]["msg"], "привет, мир");

        // серверу уехал корректный кадр: длина в символах и уникальный id
        let received = server.await.expect("server").remove(0);
        let (len, body) = received.split_once('#').expect("маркер длины");
        assert_eq!(len.parse::<usize>().unwrap(), body.chars().count());
        assert!(body.contains(r#""id":"kai-"#), "{body}");
    }

    #[tokio::test]
    async fn exchange_reads_response_with_astral_chars() {
        // ipwhois отдаёт флаг страны эмодзи: 🇷🇺 — два символа вне BMP, четыре
        // code unit. Пока длину читали как число символов, клиент ждал ещё
        // четыре символа сверх кадра и висел до таймаута (при закрытии — early
        // eof). Кириллица рядом ловит обратную ошибку — счёт в байтах.
        let (addr, server) = envelope_server_with(1, "🇷🇺 Россия").await;

        let resp = exchange(&addr, "ping", "{}", &ExchangeOpts::default())
            .await
            .expect("exchange");
        assert!(resp.ok, "{}", resp.message);
        let envelope: serde_json::Value = serde_json::from_str(&resp.message).expect("json");
        assert_eq!(envelope["response"]["msg"], "🇷🇺 Россия");
        server.await.expect("server");
    }

    #[tokio::test]
    async fn connection_survives_sequential_exchanges() {
        let (addr, server) = envelope_server(2).await;
        let mut conn = Connection::open(&addr, false).await.expect("open");

        for _ in 0..2 {
            let resp = conn
                .exchange("ping", "{}", &ExchangeOpts::default())
                .await
                .expect("exchange");
            assert!(resp.ok);
            assert!(
                conn.reusable(),
                "чистый обмен не должен отравлять соединение"
            );
        }

        // оба кадра ушли по одному сокету, id разные
        let received = server.await.expect("server");
        assert_eq!(received.len(), 2);
        assert_ne!(sent_id(&received[0]), sent_id(&received[1]));
    }

    #[tokio::test]
    async fn server_close_before_response_is_retry_safe() {
        // сервер закрыл соединение, пока оно простаивало: следующий обмен
        // упирается в EOF/RST до первого байта ответа — единственный случай,
        // когда пул может молча повторить кадр на свежем соединении
        let (addr, server) = envelope_server(1).await;
        let mut conn = Connection::open(&addr, false).await.expect("open");
        let resp = conn
            .exchange("ping", "{}", &ExchangeOpts::default())
            .await
            .expect("exchange");
        assert!(resp.ok && conn.reusable());
        server.await.expect("server"); // сервер отработал и закрыл сокет
        tokio::time::sleep(Duration::from_millis(50)).await; // FIN долетает

        let second = conn.exchange("ping", "{}", &ExchangeOpts::default()).await;
        let failed = !matches!(&second, Ok(r) if r.ok);
        assert!(failed, "обмен по закрытому сокету не может пройти");
        assert!(!conn.reusable());
        assert!(conn.retry_safe());
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
        let mut conn = Connection::open(&addr, false).await.expect("open");
        let resp = conn.exchange("ping", "{}", &opts).await.expect("exchange");
        assert!(!resp.ok);
        assert!(
            resp.message.contains("No response within"),
            "{}",
            resp.message
        );
        // сервис мог принять запрос в работу: ни в пул, ни на повтор
        assert!(!conn.reusable());
        assert!(!conn.retry_safe());
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
        // id в data — это данные события; кадру event-паттерна не положен свой
        let frame: serde_json::Value =
            serde_json::from_str(received.split_once('#').expect("маркер длины").1).expect("json");
        assert!(frame.get("id").is_none(), "{received}");
        assert_eq!(frame["pattern"], "user.created");
    }
}
