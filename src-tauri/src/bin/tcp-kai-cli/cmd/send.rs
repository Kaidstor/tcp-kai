//! `tcp-kai <ms> <cmd>` — отправка сохранённого в приложении запроса.

use std::io::{IsTerminal, Read};
use std::time::Instant;

use clap::Args;
use sqlx::SqlitePool;
use tcp_kai_lib::db::{self, Collection, EnvPack, EnvVar, Request};
use tcp_kai_lib::tcp;

use crate::output::{code, CliError, Done, Printer};
use crate::{daemon, sec, vars};

#[derive(Args)]
pub struct SendArgs {
    /// Коллекция — микросервис (список: tcp-kai ls)
    #[arg(value_name = "MS")]
    pub collection: String,

    /// Запрос: имя или cmd (список: tcp-kai ls <ms>)
    #[arg(value_name = "CMD")]
    pub request: String,

    /// Пак переменных; по умолчанию — применённый в приложении
    #[arg(short = 'e', long = "env", value_name = "ПАК")]
    pub env: Option<String>,

    /// Тело запроса (JSON) вместо сохранённого
    #[arg(short = 'd', long = "data", value_name = "JSON")]
    pub data: Option<String>,

    /// Тело из файла («-» — stdin)
    #[arg(
        short = 'f',
        long = "file",
        value_name = "ПУТЬ",
        conflicts_with = "data"
    )]
    pub file: Option<String>,

    /// Разовое значение переменной: --var port=18099 (можно несколько)
    #[arg(long = "var", value_name = "K=V")]
    pub var: Vec<String>,

    /// Дотянуть переменные из sec: проект tcp-kai-<ms>, инстанс — пак
    #[arg(long = "from-sec")]
    pub from_sec: bool,

    /// Строка подключения целиком, мимо пака
    #[arg(long = "url", value_name = "HOST:PORT")]
    pub url: Option<String>,

    /// Не писать в историю приложения
    #[arg(long = "no-history")]
    pub no_history: bool,

    /// Не заводить запрос, которого нет в коллекции (env: TCP_KAI_NO_CREATE=1)
    #[arg(long = "no-create")]
    pub no_create: bool,

    /// Слать напрямую, мимо keep-alive-демона (env: TCP_KAI_NO_DAEMON=1)
    #[arg(long = "no-daemon")]
    pub no_daemon: bool,

    /// Лимит ожидания ответа в секундах (0 — ждать вечно)
    #[arg(long = "timeout", value_name = "СЕК", default_value_t = 60)]
    pub timeout: u64,

    /// Отправить как событие (@EventPattern): кадр без id, ответ не ждать
    #[arg(long = "emit")]
    pub emit: bool,

    /// Трассировка кадра в stderr (осторожно: в теле бывают секреты;
    /// шлёт напрямую, мимо демона — иначе трассу не увидеть)
    #[arg(short = 'v', long = "verbose")]
    pub verbose: bool,
}

/// Красивый JSON — как в приложении; не-JSON остаётся собой.
fn format_json(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .and_then(|v| serde_json::to_string_pretty(&v))
        .unwrap_or_else(|_| text.to_string())
}

fn read_stdin() -> Result<String, CliError> {
    let mut buf = String::new();
    std::io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| CliError::usage(format!("не прочитать stdin: {e}")))?;
    Ok(buf)
}

/// Тело: `-d` → `-f` → stdin, если его подали → сохранённое в приложении.
fn body(args: &SendArgs, saved: Option<&str>) -> Result<String, CliError> {
    if let Some(data) = &args.data {
        return Ok(data.clone());
    }
    if let Some(file) = &args.file {
        return if file == "-" {
            read_stdin()
        } else {
            super::read_file(file)
        };
    }
    // `echo '{...}' | tcp-kai ms cmd` — тело из трубы; пустой stdin
    // (например /dev/null) не должен затирать сохранённое
    if !std::io::stdin().is_terminal() {
        let piped = read_stdin()?;
        if !piped.trim().is_empty() {
            return Ok(piped);
        }
    }
    Ok(saved.unwrap_or_default().to_string())
}

/// Заводит запрос, которого нет в коллекции: `cmd` = имя, которым его позвали,
/// тело = пришедшее в этот вызов. Дальше вызов идёт обычным путём, поэтому
/// попадает в историю и поднимает запрос в сайдбаре GUI.
///
/// Адрес берём у соседей по коллекции — у них уже принято, живёт он в паке
/// (`{{host}}:{{port}}`) или прибит гвоздями; `--url` уходит в базу, только
/// если брать больше неоткуда, иначе стенд одного вызова стал бы постоянным.
async fn create_request(
    p: &mut Printer,
    pool: &SqlitePool,
    collection: &Collection,
    siblings: &[Request],
    pack: Option<&EnvPack>,
    args: &SendArgs,
    body_tpl: &str,
) -> Result<Request, CliError> {
    let name = args.request.trim();
    let has_host = pack.is_some_and(|p| p.vars.iter().any(|v| v.key.eq_ignore_ascii_case("host")));
    let url = siblings
        .iter()
        .find_map(|r| r.url.clone().filter(|u| !u.is_empty()))
        .or_else(|| has_host.then(|| super::DEFAULT_URL.to_string()))
        .or_else(|| args.url.clone())
        .unwrap_or_else(|| super::DEFAULT_URL.to_string());
    let body = if body_tpl.trim().is_empty() {
        "{}"
    } else {
        body_tpl
    };

    let id = db::insert_request(
        pool,
        &db::NewRequest {
            collection_id: collection.id,
            name,
            url: &url,
            cmd: name,
            body,
            emit: args.emit,
        },
    )
    .await?;
    p.warn(format!(
        "+ запрос «{name}» заведён в коллекции «{}» ({url})",
        collection.name
    ));

    Ok(Request {
        id,
        name: name.to_string(),
        url: Some(url),
        cmd: Some(name.to_string()),
        body: Some(body.to_string()),
        weight: None,
        emit: args.emit,
    })
}

/// Имена `{{...}}` из строки подключения и тела — что нужно достать из sec.
fn needed_vars(url: &str, body: &str) -> Vec<String> {
    let mut names = vars::placeholders(url);
    for name in vars::placeholders(body) {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// Отказ транспорта: таймауты — код 4, остальное — сеть. Тексты приходят из
/// `tcp.rs` и от демона одинаковыми, другого признака у `ApiResponse` нет —
/// поменял текст там, поправь и здесь.
fn transport_error(message: &str) -> CliError {
    let timed_out = message.starts_with("No response within")
        || (message.starts_with("Connection to ") && message.contains("timed out"));
    if timed_out {
        CliError::timeout(message)
    } else {
        CliError::network(message)
    }
}

fn reply_value(message: &str) -> serde_json::Value {
    serde_json::from_str(message).unwrap_or_else(|_| serde_json::Value::String(message.into()))
}

/// NestJS кладёт исключение обработчика в поле `err` конверта ответа.
fn service_error(reply: &serde_json::Value) -> Option<CliError> {
    let err = reply.get("err").filter(|e| !e.is_null())?;
    let message = err
        .get("message")
        .and_then(|m| m.as_str())
        .map(str::to_string)
        .or_else(|| err.as_str().map(str::to_string))
        .unwrap_or_else(|| err.to_string());
    Some(CliError::new(
        code::NOT_APPLIED,
        "api",
        format!("сервис ответил ошибкой: {message}"),
    ))
}

pub async fn run(args: SendArgs, p: &mut Printer) -> Result<Done, CliError> {
    let pool = super::open_db().await?;
    let collection = super::collection(&pool, &args.collection).await?;
    let requests = db::requests(&pool, collection.id).await?;
    let packs = db::packs(&pool, collection.id).await?;
    let pack = super::pack(&packs, &collection, args.env.as_deref())?;

    // запроса нет — заводим его этим же вызовом: агенту не нужно идти в GUI,
    // чтобы дёрнуть новый cmd. Ценой того, что опечатка в имени тоже создаст
    // запрос (а не покажет похожие) — вернуть строгость можно --no-create
    let strict =
        args.no_create || std::env::var_os("TCP_KAI_NO_CREATE").is_some_and(|v| !v.is_empty());
    let existing = match super::request(&requests, &args.request) {
        Ok(r) => Some(r.clone()),
        Err(e) if strict => return Err(e),
        Err(_) => None,
    };
    let body_tpl = body(&args, existing.as_ref().and_then(|r| r.body.as_deref()))?;
    let request = match existing {
        Some(r) => r,
        None => create_request(p, &pool, &collection, &requests, pack, &args, &body_tpl).await?,
    };

    let pattern = request
        .cmd
        .clone()
        .filter(|c| !c.is_empty())
        .ok_or_else(|| CliError::config(format!("у запроса «{}» не задан cmd", request.name)))?;
    let url_tpl = args
        .url
        .clone()
        .or_else(|| request.url.clone())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| {
            CliError::config(format!(
                "у запроса «{}» не задана строка подключения",
                request.name
            ))
        })?;

    // источники переменных, по возрастанию приоритета: пак → sec → --var
    let mut env: Vec<EnvVar> = pack.map(|p| p.vars.clone()).unwrap_or_default();
    if args.from_sec {
        let project = sec::project(&collection.name);
        let needed = needed_vars(&url_tpl, &body_tpl);
        env.extend(
            sec::resolve(&project, pack.map(|p| p.name.as_str()), &needed)
                .map_err(CliError::config)?,
        );
    }
    for kv in &args.var {
        let (key, value) = super::split_var(kv)?;
        env.push(EnvVar { key, value });
    }

    let connection = vars::substitute(&url_tpl, &env);
    let body_sent = vars::substitute(&body_tpl, &env);

    // до подключения: иначе вместо «нет переменной» будет «не резолвится хост»
    let unresolved = vars::placeholders(&connection);
    if !unresolved.is_empty() {
        let where_from = match pack {
            Some(p) => format!("в паке «{}» их нет", p.name),
            None => "у коллекции не выбран пак".to_string(),
        };
        return Err(CliError::config(format!(
            "строка подключения осталась с {}: {where_from}.\nЗадай их в приложении, через --url HOST:PORT, --var или --from-sec",
            unresolved
                .iter()
                .map(|n| format!("{{{{{n}}}}}"))
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    for name in vars::placeholders(&body_sent) {
        p.warn(format!("{{{{{name}}}}} в теле осталась без значения"));
    }

    // event-паттерн: явный --emit или сохранённый флаг запроса из GUI
    let emit = args.emit || request.emit;

    let opts = tcp::ExchangeOpts {
        timeout: (args.timeout > 0).then(|| std::time::Duration::from_secs(args.timeout)),
        emit,
        trace: args.verbose,
    };

    // keep-alive-демон держит соединения между вызовами CLI; -v идёт напрямую,
    // чтобы трасса кадра печаталась в этот терминал, а не в никуда у демона
    let use_daemon = !args.no_daemon
        && !args.verbose
        && std::env::var_os("TCP_KAI_NO_DAEMON").is_none_or(|v| v.is_empty());

    let started = Instant::now();
    let (response, reused, elapsed_ms) = if use_daemon {
        match daemon::send(&connection, &pattern, &body_sent, args.timeout, emit).await {
            Ok(reply) => {
                let resp = tcp::ApiResponse {
                    ok: reply.ok,
                    message: reply.message,
                };
                (resp, reply.reused, reply.elapsed_ms)
            }
            Err(e) => {
                p.warn(format!(
                    "keep-alive-демон недоступен ({e}) — запрос напрямую"
                ));
                let resp = tcp::exchange(&connection, &pattern, &body_sent, &opts)
                    .await
                    .map_err(CliError::network)?;
                (resp, false, started.elapsed().as_secs_f64() * 1000.0)
            }
        }
    } else {
        let resp = tcp::exchange(&connection, &pattern, &body_sent, &opts)
            .await
            .map_err(CliError::network)?;
        (resp, false, started.elapsed().as_secs_f64() * 1000.0)
    };
    // ⟳ в сводке — ответ пришёл по переиспользованному соединению из пула
    let reuse_mark = if reused { " ⟳" } else { "" };

    let received = format_json(&response.message);

    // в историю едет тело с {{vars}}, как это делает приложение: у
    // подставленного тела внутри может лежать секрет из sec, а история —
    // обычная незашифрованная таблица. Ошибки тоже пишутся (ok = 0) —
    // «что я послал, когда упало» иначе не восстановить.
    if !args.no_history {
        let rec = db::SendRecord {
            request_id: request.id,
            sent: &body_tpl,
            received: if response.ok {
                &received
            } else {
                &response.message
            },
            execution_time_ms: elapsed_ms,
            ok: response.ok,
            cmd: &pattern,
            url: &connection,
            pack: pack.map(|p| p.name.as_str()),
        };
        if let Err(e) = db::record_send(&pool, &rec).await {
            p.warn(format!("в историю не записал: {e}"));
        }
    }

    if !response.ok {
        let mut e = transport_error(&response.message);
        e.message = format!("{} ({:.2}s)", e.message, elapsed_ms / 1000.0);
        return Err(e);
    }

    let pack_name = pack.map(|p| p.name.as_str()).unwrap_or("без пака");
    if emit {
        if !p.json {
            eprintln!(
                "✓ событие ушло · {} · {pack_name} · {:.2}s{reuse_mark}",
                collection.name,
                elapsed_ms / 1000.0
            );
        }
        return Ok(Done::ok(()));
    }

    let reply = reply_value(&response.message);
    if !p.json {
        println!("{received}");
        eprintln!(
            "{} {} · {pack_name} · {:.2}s{reuse_mark}",
            if service_error(&reply).is_some() {
                "✗"
            } else {
                "✓"
            },
            collection.name,
            elapsed_ms / 1000.0
        );
    }
    Ok(match service_error(&reply) {
        Some(e) => Done::partial(reply, e),
        None => Done::ok(reply),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeouts_get_code_4() {
        assert_eq!(
            transport_error("No response within 60s").code,
            code::TIMEOUT
        );
        assert_eq!(
            transport_error("Connection to 10.0.0.1:1 timed out after 5s").code,
            code::TIMEOUT
        );
    }

    #[test]
    fn refused_connection_is_network() {
        let e = transport_error("TCP connection error: Connection refused (os error 61)");
        assert_eq!((e.code, e.kind), (code::TOOL, "network"));
    }

    #[test]
    fn nest_err_becomes_api_error() {
        let reply =
            reply_value(r#"{"err":{"message":"Не авторизован","status":401},"isDisposed":true}"#);
        let e = service_error(&reply).expect("err в ответе");
        assert_eq!((e.code, e.kind), (code::NOT_APPLIED, "api"));
        assert!(e.message.contains("Не авторизован"));
    }

    #[test]
    fn plain_response_is_not_an_error() {
        let reply = reply_value(r#"{"response":{"ok":1},"isDisposed":true,"err":null}"#);
        assert!(service_error(&reply).is_none());
        assert_eq!(reply_value("не json"), serde_json::json!("не json"));
    }
}
