//! `tcp-kai ls` — коллекции (микросервисы); `tcp-kai ls <ms>` — её запросы.

use std::process::ExitCode;

use clap::Args;
use tcp_kai_lib::db;

#[derive(Args)]
pub struct LsArgs {
    /// Коллекция — показать её запросы; без аргумента — список коллекций
    #[arg(value_name = "MS")]
    pub collection: Option<String>,

    /// Машинночитаемый вывод
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: LsArgs) -> Result<ExitCode, String> {
    let pool = db::open().await?;
    match args.collection.as_deref() {
        None => collections(&pool, args.json).await,
        Some(name) => requests(&pool, name, args.json).await,
    }
}

async fn collections(pool: &sqlx::SqlitePool, json: bool) -> Result<ExitCode, String> {
    let rows = db::overview(pool).await?;

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::SUCCESS);
    }
    if rows.is_empty() {
        eprintln!("tcp-kai: коллекций нет — заведи их в приложении");
        return Ok(ExitCode::SUCCESS);
    }

    let width = rows
        .iter()
        .map(|r| r.name.chars().count())
        .max()
        .unwrap_or(0);
    for r in &rows {
        println!(
            "{:width$}  {:>3}  {}",
            r.name,
            r.requests,
            r.pack.as_deref().unwrap_or("—"),
        );
    }
    Ok(ExitCode::SUCCESS)
}

async fn requests(pool: &sqlx::SqlitePool, name: &str, json: bool) -> Result<ExitCode, String> {
    let collection = super::collection(pool, name).await?;
    let rows = db::requests(pool, collection.id).await?;

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::SUCCESS);
    }
    if rows.is_empty() {
        eprintln!("tcp-kai: в коллекции «{}» нет запросов", collection.name);
        return Ok(ExitCode::SUCCESS);
    }

    let width = rows
        .iter()
        .map(|r| r.name.chars().count())
        .max()
        .unwrap_or(0);
    for r in &rows {
        // cmd показываем, только когда он отличается от имени: в норме они
        // совпадают, и вторая колонка была бы шумом
        let cmd = match r.cmd.as_deref() {
            Some(c) if c != r.name => c,
            _ => "",
        };
        println!("{:width$}  {}", r.name, cmd);
    }
    Ok(ExitCode::SUCCESS)
}
