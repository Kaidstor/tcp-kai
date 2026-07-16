//! `tcp-kai envs <ms>` — паки переменных, доступные коллекции: какой применён
//! в приложении и что в каждом лежит. Отсюда берутся имена для `-e`.

use std::process::ExitCode;

use clap::Args;
use tcp_kai_lib::db;

use crate::sec;

#[derive(Args)]
pub struct EnvsArgs {
    /// Коллекция — микросервис
    #[arg(value_name = "MS")]
    pub collection: String,

    /// Машинночитаемый вывод
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: EnvsArgs) -> Result<ExitCode, String> {
    let pool = db::open().await?;
    let collection = super::collection(&pool, &args.collection).await?;
    let packs = db::packs(&pool, collection.id).await?;

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "collection": collection.name,
                "applied": collection.pack_id,
                "secProject": sec::project(&collection.name),
                "packs": packs,
            }))
            .map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::SUCCESS);
    }

    if packs.is_empty() {
        eprintln!(
            "tcp-kai: у коллекции «{}» нет паков переменных",
            collection.name
        );
        return Ok(ExitCode::SUCCESS);
    }

    for pack in &packs {
        let applied = if Some(pack.id) == collection.pack_id {
            "  ACTIVE"
        } else {
            ""
        };
        let scope = if pack.collection_id.is_none() {
            "глобальный"
        } else {
            "коллекции"
        };
        println!("{} ({scope}){applied}", pack.name);
        for var in &pack.vars {
            println!("  {} = {}", var.key, var.value);
        }
    }
    eprintln!(
        "\nsec-проект для --from-sec: {}",
        sec::project(&collection.name)
    );
    Ok(ExitCode::SUCCESS)
}
