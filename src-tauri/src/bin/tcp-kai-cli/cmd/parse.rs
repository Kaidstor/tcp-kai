//! `tcp-kai parse <файл>` — что парсер контрактов найдёт в файле: контейнеры
//! и cmd-значения, без базы и без импорта. Удобно проверить контракт до
//! `tcp-kai import` (и этим же пользуются автотесты на реальных сервисах).

use std::process::ExitCode;

use clap::Args;
use tcp_kai_lib::contract;

#[derive(Args)]
pub struct ParseArgs {
    /// Путь к контракту: *.contract.ts, cmd.enum.ts или контроллер
    #[arg(value_name = "ПУТЬ")]
    pub path: String,

    /// Машинночитаемый вывод (группы как их видит импорт)
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: ParseArgs) -> Result<ExitCode, String> {
    let source = std::fs::read_to_string(&args.path)
        .map_err(|e| format!("не прочитать {}: {e}", args.path))?;
    let groups = contract::parse(&source);

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&groups).map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::SUCCESS);
    }

    if groups.is_empty() {
        eprintln!("tcp-kai: ни enum, ни as-const объектов, ни @MessagePattern не нашлось");
        return Ok(ExitCode::FAILURE);
    }

    for g in &groups {
        let mark = if g.is_cmd {
            ""
        } else {
            "  (не похож на cmd-реестр — импорт пропустит)"
        };
        println!("{}{mark}", g.container);
        for c in &g.cmds {
            let dep = if c.deprecated { "  @deprecated" } else { "" };
            if c.key.is_empty() || c.key == c.value {
                println!("  {}{dep}", c.value);
            } else {
                println!("  {}  ← {}{dep}", c.value, c.key);
            }
        }
        for r in &g.refs {
            println!("  {} = {}  (ссылка — импортни её файл)", r.key, r.target);
        }
    }
    Ok(ExitCode::SUCCESS)
}
