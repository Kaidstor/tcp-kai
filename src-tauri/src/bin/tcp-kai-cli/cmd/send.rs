//! `tcp-kai <ms> <cmd>` — отправка сохранённого в приложении запроса.

use std::io::{IsTerminal, Read};
use std::process::ExitCode;
use std::time::Instant;

use clap::Args;
use tcp_kai_lib::db::{self, EnvVar};
use tcp_kai_lib::tcp;

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
    #[arg(short = 'f', long = "file", value_name = "ПУТЬ", conflicts_with = "data")]
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

    /// В stdout — только ответ сервиса, как есть (для jq)
    #[arg(long = "json")]
    pub json: bool,

    /// Не писать в историю приложения
    #[arg(long = "no-history")]
    pub no_history: bool,

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

fn read_stdin() -> Result<String, String> {
    let mut buf = String::new();
    std::io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| format!("не прочитать stdin: {e}"))?;
    Ok(buf)
}

/// Тело: `-d` → `-f` → stdin, если его подали → сохранённое в приложении.
fn body(args: &SendArgs, saved: Option<&str>) -> Result<String, String> {
    if let Some(data) = &args.data {
        return Ok(data.clone());
    }
    if let Some(file) = &args.file {
        return if file == "-" {
            read_stdin()
        } else {
            std::fs::read_to_string(file).map_err(|e| format!("не прочитать {file}: {e}"))
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

pub async fn run(args: SendArgs) -> Result<ExitCode, String> {
    let pool = db::open().await?;
    let collection = super::collection(&pool, &args.collection).await?;
    let requests = db::requests(&pool, collection.id).await?;
    let request = super::request(&requests, &args.request)?;
    let packs = db::packs(&pool, collection.id).await?;
    let pack = super::pack(&packs, &collection, args.env.as_deref())?;

    let pattern = request
        .cmd
        .clone()
        .filter(|c| !c.is_empty())
        .ok_or_else(|| format!("у запроса «{}» не задан cmd", request.name))?;
    let url_tpl = args
        .url
        .clone()
        .or_else(|| request.url.clone())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| format!("у запроса «{}» не задана строка подключения", request.name))?;
    let body_tpl = body(&args, request.body.as_deref())?;

    // источники переменных, по возрастанию приоритета: пак → sec → --var
    let mut env: Vec<EnvVar> = pack.map(|p| p.vars.clone()).unwrap_or_default();
    if args.from_sec {
        let project = sec::project(&collection.name);
        let needed = needed_vars(&url_tpl, &body_tpl);
        env.extend(sec::resolve(&project, pack.map(|p| p.name.as_str()), &needed)?);
    }
    for kv in &args.var {
        let (key, value) = kv
            .split_once('=')
            .ok_or_else(|| format!("--var ждёт K=V, получено «{kv}»"))?;
        env.push(EnvVar {
            key: key.trim().to_string(),
            value: value.to_string(),
        });
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
        return Err(format!(
            "строка подключения осталась с {}: {where_from}.\nЗадай их в приложении, через --var или --from-sec",
            unresolved
                .iter()
                .map(|n| format!("{{{{{n}}}}}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    for name in vars::placeholders(&body_sent) {
        eprintln!("tcp-kai: {{{{{name}}}}} в теле осталась без значения");
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
        && std::env::var_os("TCP_KAI_NO_DAEMON").map_or(true, |v| v.is_empty());

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
                eprintln!("tcp-kai: keep-alive-демон недоступен ({e}) — запрос напрямую");
                let resp = tcp::exchange(&connection, &pattern, &body_sent, &opts).await?;
                (resp, false, started.elapsed().as_secs_f64() * 1000.0)
            }
        }
    } else {
        let resp = tcp::exchange(&connection, &pattern, &body_sent, &opts).await?;
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
            received: if response.ok { &received } else { &response.message },
            execution_time_ms: elapsed_ms,
            ok: response.ok,
            cmd: &pattern,
            url: &connection,
            pack: pack.map(|p| p.name.as_str()),
        };
        if let Err(e) = db::record_send(&pool, &rec).await {
            eprintln!("tcp-kai: в историю не записал: {e}");
        }
    }

    if !response.ok {
        eprintln!(
            "tcp-kai: {} ({:.2}s)",
            response.message,
            elapsed_ms / 1000.0
        );
        return Ok(ExitCode::FAILURE);
    }

    if emit {
        eprintln!(
            "✓ событие ушло · {} · {} · {:.2}s{reuse_mark}",
            collection.name,
            pack.map(|p| p.name.as_str()).unwrap_or("без пака"),
            elapsed_ms / 1000.0
        );
        return Ok(ExitCode::SUCCESS);
    }

    if args.json {
        // stdout — только ответ сервиса, чтобы его можно было отдать в jq
        println!("{}", response.message);
    } else {
        println!("{received}");
        eprintln!(
            "✓ {} · {} · {:.2}s{reuse_mark}",
            collection.name,
            pack.map(|p| p.name.as_str()).unwrap_or("без пака"),
            elapsed_ms / 1000.0
        );
    }

    Ok(ExitCode::SUCCESS)
}
