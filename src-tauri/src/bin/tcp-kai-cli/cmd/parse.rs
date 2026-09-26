//! `tcp-kai parse <файл>` — что парсер контрактов найдёт в файле: контейнеры
//! и cmd-значения, без базы и без импорта. Удобно проверить контракт до
//! `tcp-kai import` (и этим же пользуются автотесты на реальных сервисах).

use clap::Args;
use tcp_kai_lib::contract;

use crate::output::{code, CliError, Done, Printer};

#[derive(Args)]
pub struct ParseArgs {
    /// Путь к контракту: *.contract.ts, cmd.enum.ts или контроллер
    #[arg(value_name = "ПУТЬ")]
    pub path: String,
}

pub async fn run(args: ParseArgs, p: &mut Printer) -> Result<Done, CliError> {
    let source = super::read_file(&args.path)?;
    let groups = contract::parse(&source);

    if groups.is_empty() {
        return Ok(Done::partial(
            groups,
            CliError::new(
                code::NOT_APPLIED,
                "empty",
                "ни enum, ни as-const объектов, ни @MessagePattern не нашлось",
            ),
        ));
    }
    if p.json {
        return Ok(Done::ok(groups));
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
    Ok(Done::ok(groups))
}
