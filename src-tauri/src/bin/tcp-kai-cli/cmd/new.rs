//! `tcp-kai new <ms>` — завести коллекцию (микросервис) из терминала: раньше
//! это было только в GUI, и агент, у которого сервиса ещё нет в базе, упирался
//! в «коллекция не найдена».
//!
//! `--url host:port` заодно заводит пак переменных и применяет его — иначе
//! коллекция получается пустой, и первый же запрос упрётся в `{{host}}`.

use std::process::ExitCode;

use clap::Args;
use tcp_kai_lib::db::{self, EnvVar};

#[derive(Args)]
pub struct NewArgs {
    /// Имя коллекции — микросервис
    #[arg(value_name = "MS")]
    pub collection: String,

    /// Адрес сервиса: заводит пак с host/port и применяет его к коллекции
    #[arg(long = "url", value_name = "HOST:PORT")]
    pub url: Option<String>,

    /// Имя пака переменных для --url/--var
    #[arg(short = 'e', long = "env", value_name = "ПАК", default_value = "local")]
    pub env: String,

    /// Переменная пака: --var token=… (можно несколько)
    #[arg(long = "var", value_name = "K=V")]
    pub var: Vec<String>,
}

/// `host:port` → переменные пака. Схему (`tcp://`) отрезаем: её легко принести
/// копипастой из конфига, а в кадр она не едет.
fn url_vars(url: &str) -> Result<Vec<EnvVar>, String> {
    let bare = url
        .split_once("://")
        .map_or(url, |(_, rest)| rest)
        .trim_end_matches('/');
    let (host, port) = bare
        .rsplit_once(':')
        .ok_or_else(|| format!("--url ждёт HOST:PORT, получено «{url}»"))?;
    if host.is_empty() || port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("--url ждёт HOST:PORT, получено «{url}»"));
    }
    Ok(vec![
        EnvVar {
            key: "host".to_string(),
            value: host.to_string(),
        },
        EnvVar {
            key: "port".to_string(),
            value: port.to_string(),
        },
    ])
}

pub async fn run(args: NewArgs) -> Result<ExitCode, String> {
    let name = args.collection.trim();
    if name.is_empty() {
        return Err("имя коллекции пустое".to_string());
    }

    let pool = db::open().await?;
    let existing = db::collections(&pool).await?;
    if let Some(c) = existing.iter().find(|c| c.name.eq_ignore_ascii_case(name)) {
        return Err(format!(
            "коллекция «{}» уже есть — запросы в ней: tcp-kai ls {}",
            c.name, c.name
        ));
    }

    let mut vars = match &args.url {
        Some(url) => url_vars(url)?,
        None => Vec::new(),
    };
    for kv in &args.var {
        let (key, value) = kv
            .split_once('=')
            .ok_or_else(|| format!("--var ждёт K=V, получено «{kv}»"))?;
        let key = key.trim().to_string();
        // --var host=… поверх --url: последнее значение выигрывает, а не
        // ложится второй строкой с тем же именем
        vars.retain(|v| !v.key.eq_ignore_ascii_case(&key));
        vars.push(EnvVar {
            key,
            value: value.to_string(),
        });
    }

    let collection_id = db::insert_collection(&pool, name).await?;
    println!("коллекция «{name}» заведена");

    if !vars.is_empty() {
        let pack_name = args.env.trim();
        let pack_id = db::insert_pack(&pool, pack_name, &vars, Some(collection_id)).await?;
        db::set_collection_pack(&pool, collection_id, Some(pack_id)).await?;
        println!(
            "пак «{pack_name}» применён: {}",
            vars.iter()
                .map(|v| format!("{} = {}", v.key, v.value))
                .collect::<Vec<_>>()
                .join(", ")
        );
    } else {
        eprintln!("tcp-kai: пака нет — задай адрес через --url HOST:PORT или в приложении");
    }

    eprintln!(
        "\nДальше:\n  \
         tcp-kai {name} <cmd> -d '{{}}'  — запрос заведётся сам\n  \
         tcp-kai import {name} <контракт.ts>  — или все cmd из контракта"
    );
    Ok(ExitCode::SUCCESS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_splits_host_and_port() {
        let vars = url_vars("127.0.0.1:18009").unwrap();
        assert_eq!(vars[0].value, "127.0.0.1");
        assert_eq!(vars[1].value, "18009");
    }

    #[test]
    fn url_drops_scheme_and_trailing_slash() {
        let vars = url_vars("tcp://svc.internal:4000/").unwrap();
        assert_eq!(vars[0].value, "svc.internal");
        assert_eq!(vars[1].value, "4000");
    }

    #[test]
    fn url_without_port_is_rejected() {
        assert!(url_vars("localhost").is_err());
        assert!(url_vars("localhost:").is_err());
        assert!(url_vars("localhost:abc").is_err());
    }
}
