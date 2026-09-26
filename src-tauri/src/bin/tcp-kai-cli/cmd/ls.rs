//! `tcp-kai ls` — коллекции (микросервисы); `tcp-kai ls <ms>` — её запросы.

use clap::Args;
use tcp_kai_lib::db;

use crate::output::{CliError, Done, Printer};

#[derive(Args)]
pub struct LsArgs {
    /// Коллекция — показать её запросы; без аргумента — список коллекций
    #[arg(value_name = "MS")]
    pub collection: Option<String>,
}

pub async fn run(args: LsArgs, p: &mut Printer) -> Result<Done, CliError> {
    let pool = super::open_db().await?;
    match args.collection.as_deref() {
        None => collections(&pool, p).await,
        Some(name) => requests(&pool, name, p).await,
    }
}

async fn collections(pool: &sqlx::SqlitePool, p: &mut Printer) -> Result<Done, CliError> {
    let rows = db::overview(pool).await?;

    if p.json {
        return Ok(Done::ok(rows));
    }
    if rows.is_empty() {
        eprintln!("tcp-kai: коллекций нет — заведи их в приложении");
        return Ok(Done::ok(rows));
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
    Ok(Done::ok(rows))
}

async fn requests(pool: &sqlx::SqlitePool, name: &str, p: &mut Printer) -> Result<Done, CliError> {
    let collection = super::collection(pool, name).await?;
    let rows = db::requests(pool, collection.id).await?;

    if p.json {
        return Ok(Done::ok(rows));
    }
    if rows.is_empty() {
        eprintln!("tcp-kai: в коллекции «{}» нет запросов", collection.name);
        return Ok(Done::ok(rows));
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
    Ok(Done::ok(rows))
}
