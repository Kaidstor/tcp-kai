//! `tcp-kai doctor [ms]` — база приложения, коллекции, TCP connect на адрес
//! из пака. Кадров сервису не шлёт: проверка безопасна и для prod.

use std::time::{Duration, Instant};

use clap::Args;
use serde::Serialize;
use tcp_kai_lib::db;
use tokio::net::TcpStream;

use crate::output::{CliError, Done, Printer};
use crate::vars;

#[derive(Args)]
pub struct DoctorArgs {
    /// Коллекция, чей адрес проверить; без неё проверка адреса пропускается
    #[arg(value_name = "MS")]
    pub collection: Option<String>,

    /// Пак переменных; по умолчанию — применённый в приложении
    #[arg(short = 'e', long = "env", value_name = "ПАК", requires = "collection")]
    pub env: Option<String>,

    /// Лимит на TCP connect, секунды
    #[arg(long = "timeout", value_name = "СЕК", default_value_t = 3)]
    pub timeout: u64,
}

#[derive(Serialize)]
struct Check {
    name: &'static str,
    ok: bool,
    details: String,
}

impl Check {
    fn ok(name: &'static str, details: impl Into<String>) -> Self {
        Check {
            name,
            ok: true,
            details: details.into(),
        }
    }
    fn fail(name: &'static str, details: impl Into<String>) -> Self {
        Check {
            name,
            ok: false,
            details: details.into(),
        }
    }
}

struct Verdict(Option<CliError>);

impl Verdict {
    fn fail(&mut self, e: CliError) {
        if self.0.is_none() {
            self.0 = Some(e);
        }
    }
}

pub async fn run(args: DoctorArgs, p: &mut Printer) -> Result<Done, CliError> {
    let mut checks = Vec::new();
    let mut verdict = Verdict(None);

    let path = db::db_path().map_err(CliError::config)?;
    let pool = match super::open_db().await {
        Ok(pool) => {
            checks.push(Check::ok("database", path.display().to_string()));
            Some(pool)
        }
        Err(e) => {
            checks.push(Check::fail("database", e.message.clone()));
            verdict.fail(e);
            None
        }
    };

    if let Some(pool) = &pool {
        match db::collections(pool).await {
            Ok(all) if all.is_empty() => {
                checks.push(Check::ok(
                    "collections",
                    "0 — заведи: tcp-kai new <ms> --url HOST:PORT",
                ));
                p.warn("в базе нет коллекций");
            }
            Ok(all) => checks.push(Check::ok("collections", all.len().to_string())),
            Err(e) => {
                checks.push(Check::fail("collections", e.clone()));
                verdict.fail(CliError::from(e));
            }
        }
    }

    match (&pool, args.collection.as_deref()) {
        (Some(pool), Some(name)) => {
            let check = address(pool, name, args.env.as_deref(), args.timeout).await;
            match check {
                Ok(c) => checks.push(c),
                Err((c, e)) => {
                    checks.push(c);
                    verdict.fail(e);
                }
            }
        }
        (None, Some(_)) => checks.push(Check::fail("address", "не проверить: нет базы")),
        (_, None) => checks.push(Check::ok(
            "address",
            "не проверялся — укажи коллекцию: tcp-kai doctor <ms> [-e ПАК]",
        )),
    }

    if !p.json {
        for c in &checks {
            let mark = if c.ok { "ok  " } else { "fail" };
            println!("{mark}  {:<12} {}", c.name, c.details);
        }
    }

    let data = serde_json::json!({ "checks": checks });
    Ok(match verdict.0 {
        Some(e) => Done {
            code: e.code,
            data,
            error: Some(e),
        },
        None => Done::ok(data),
    })
}

/// Адрес так же, как его соберёт `send`: строка подключения первого запроса
/// коллекции (у новых — `{{host}}:{{port}}`) с подстановкой пака.
async fn address(
    pool: &sqlx::SqlitePool,
    name: &str,
    env: Option<&str>,
    timeout_secs: u64,
) -> Result<Check, (Check, CliError)> {
    let fail = |e: CliError| (Check::fail("address", e.message.clone()), e);

    let collection = super::collection(pool, name).await.map_err(fail)?;
    let requests = db::requests(pool, collection.id)
        .await
        .map_err(|e| fail(CliError::from(e)))?;
    let packs = db::packs(pool, collection.id)
        .await
        .map_err(|e| fail(CliError::from(e)))?;
    let pack = super::pack(&packs, &collection, env).map_err(fail)?;

    let template = requests
        .iter()
        .find_map(|r| r.url.clone().filter(|u| !u.is_empty()))
        .unwrap_or_else(|| super::DEFAULT_URL.to_string());
    let env_vars = pack.map(|p| p.vars.clone()).unwrap_or_default();
    let target = vars::substitute(&template, &env_vars);
    let pack_name = pack.map(|p| p.name.as_str()).unwrap_or("без пака");

    let unresolved = vars::placeholders(&target);
    if !unresolved.is_empty() {
        return Err(fail(CliError::config(format!(
            "{target} ({}, пак {pack_name}): не хватает {}",
            collection.name,
            unresolved.join(", ")
        ))));
    }

    let started = Instant::now();
    let limit = Duration::from_secs(timeout_secs.max(1));
    let label = format!("{target} ({}, пак {pack_name})", collection.name);
    match tokio::time::timeout(limit, TcpStream::connect(&target)).await {
        Ok(Ok(_)) => Ok(Check::ok(
            "address",
            format!("{label}: connect {} мс", started.elapsed().as_millis()),
        )),
        Ok(Err(e)) => Err(fail(CliError::network(format!("{label}: {e}")))),
        Err(_) => Err(fail(CliError::timeout(format!(
            "{label}: connect не ответил за {} с",
            limit.as_secs()
        )))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::code;

    #[test]
    fn verdict_keeps_first_failure() {
        let mut v = Verdict(None);
        v.fail(CliError::config("нет базы"));
        v.fail(CliError::timeout("connect"));
        assert_eq!(v.0.unwrap().code, code::TOOL);
    }
}
