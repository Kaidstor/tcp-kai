//! `tcp-kai history <ms> <cmd>` — последние обмены запроса из общей с GUI
//! истории, не открывая приложение.

use std::process::ExitCode;

use clap::Args;
use tcp_kai_lib::db;

#[derive(Args)]
pub struct HistoryArgs {
    /// Коллекция — микросервис
    #[arg(value_name = "MS")]
    pub collection: String,

    /// Запрос: имя или cmd
    #[arg(value_name = "CMD")]
    pub request: String,

    /// Сколько записей показать
    #[arg(short = 'n', long = "limit", value_name = "N", default_value_t = 10)]
    pub limit: i64,

    /// Печатать и тела (sent/received), а не только сводку
    #[arg(long = "full")]
    pub full: bool,

    /// Машинночитаемый вывод
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: HistoryArgs) -> Result<ExitCode, String> {
    let pool = db::open().await?;
    let collection = super::collection(&pool, &args.collection).await?;
    let requests = db::requests(&pool, collection.id).await?;
    let request = super::request(&requests, &args.request)?;

    let entries = db::history(&pool, request.id, args.limit.max(1)).await?;

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::SUCCESS);
    }

    if entries.is_empty() {
        eprintln!("tcp-kai: у запроса «{}» пустая история", request.name);
        return Ok(ExitCode::SUCCESS);
    }

    for e in &entries {
        let status = if e.ok { "✓" } else { "✗" };
        let time = e
            .execution_time
            .map(|ms| format!("{:.2}s", ms / 1000.0))
            .unwrap_or_else(|| "—".to_string());
        let pack = e.pack.as_deref().unwrap_or("");
        let url = e.url.as_deref().unwrap_or("");
        println!("{status} {}  {time}  {pack}  {url}", e.timestamp);
        if args.full {
            if let Some(sent) = e.sent.as_deref().filter(|s| !s.is_empty()) {
                println!("  → {}", sent.replace('\n', "\n    "));
            }
            if let Some(received) = e.received.as_deref().filter(|s| !s.is_empty()) {
                println!("  ← {}", received.replace('\n', "\n    "));
            }
        }
    }
    Ok(ExitCode::SUCCESS)
}
