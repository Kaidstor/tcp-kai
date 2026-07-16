//! `tcp-kai import <ms> <контракт.ts>` — завести в коллекции запросы по
//! cmd-паттернам из NestJS-контракта (as-const объект, enum, @MessagePattern).

use std::process::ExitCode;

use clap::Args;
use tcp_kai_lib::{contract, db};

/// URL новых запросов — тот же, что подставляет GUI при создании руками.
const DEFAULT_URL: &str = "{{host}}:{{port}}";

#[derive(Args)]
pub struct ImportArgs {
    /// Коллекция — микросервис (список: tcp-kai ls)
    #[arg(value_name = "MS")]
    pub collection: String,

    /// Путь к контракту: *.contract.ts, cmd.enum.ts или контроллер
    #[arg(value_name = "ПУТЬ")]
    pub path: String,

    /// Показать, что нашлось и что создалось бы, ничего не меняя
    #[arg(long = "dry-run")]
    pub dry_run: bool,

    /// Брать все контейнеры файла, а не только похожие на *Cmd*/*Pattern*
    #[arg(long = "all")]
    pub all: bool,

    /// Импортировать и паттерны с JSDoc @deprecated (по умолчанию — пропуск)
    #[arg(long = "with-deprecated")]
    pub with_deprecated: bool,
}

pub async fn run(args: ImportArgs) -> Result<ExitCode, String> {
    let source = std::fs::read_to_string(&args.path)
        .map_err(|e| format!("не прочитать {}: {e}", args.path))?;
    let groups = contract::parse(&source);

    if groups.is_empty() {
        return Err(format!(
            "в {} не нашлось ни enum, ни as-const объектов, ни @MessagePattern",
            args.path
        ));
    }

    // --all снимает фильтр по имени контейнера; без него берём только
    // cmd-реестры, чтобы не притащить имена сервисов и прочие константы
    let mut seen = std::collections::HashSet::new();
    let cmds: Vec<&contract::ContractCmd> = groups
        .iter()
        .filter(|g| args.all || g.is_cmd)
        .flat_map(|g| g.cmds.iter())
        .filter(|c| seen.insert(c.value.clone()))
        .collect();

    let skipped_groups: Vec<&str> = groups
        .iter()
        .filter(|g| !args.all && !g.is_cmd)
        .map(|g| g.container.as_str())
        .collect();

    if cmds.is_empty() {
        let hint = if skipped_groups.is_empty() {
            String::new()
        } else {
            format!(
                "\nНайдены контейнеры без cmd-имени: {} — возьми их через --all",
                skipped_groups.join(", ")
            )
        };
        return Err(format!("cmd-паттернов в {} не нашлось{hint}", args.path));
    }

    let pool = db::open().await?;
    let collection = super::collection(&pool, &args.collection).await?;
    let existing = db::requests(&pool, collection.id).await?;

    let known = |value: &str| {
        existing
            .iter()
            .any(|r| r.cmd.as_deref() == Some(value) || r.name == value)
    };

    let (found, fresh): (Vec<&contract::ContractCmd>, Vec<&contract::ContractCmd>) =
        cmds.iter().copied().partition(|c| known(&c.value));
    let fresh: Vec<&contract::ContractCmd> = fresh
        .into_iter()
        .filter(|c| args.with_deprecated || !c.deprecated)
        .collect();
    let deprecated_skipped: Vec<&str> = cmds
        .iter()
        .filter(|c| c.deprecated && !args.with_deprecated && !known(&c.value))
        .map(|c| c.value.as_str())
        .collect();

    // запросы, чей cmd из контракта ушёл: не удаляем, но показываем — обычно
    // это переименованный или выпиленный паттерн
    let contract_values: std::collections::HashSet<&str> =
        cmds.iter().map(|c| c.value.as_str()).collect();
    let gone: Vec<&str> = existing
        .iter()
        .filter(|r| {
            r.cmd
                .as_deref()
                .is_some_and(|c| !c.is_empty() && !contract_values.contains(c))
        })
        .map(|r| r.name.as_str())
        .collect();

    println!(
        "{} → {}: в контракте {} cmd, уже заведено {}, новых {}",
        args.path,
        collection.name,
        cmds.len(),
        found.len(),
        fresh.len()
    );

    for c in &fresh {
        let mark = if c.deprecated { "  (@deprecated)" } else { "" };
        println!("  + {}{mark}", c.value);
    }
    if !deprecated_skipped.is_empty() {
        println!(
            "  пропущены как @deprecated: {} (взять — --with-deprecated)",
            deprecated_skipped.join(", ")
        );
    }
    if !gone.is_empty() {
        println!("  в контракте нет (не трогаю): {}", gone.join(", "));
    }
    if !skipped_groups.is_empty() {
        println!(
            "  контейнеры без cmd-имени (пропущены, --all возьмёт): {}",
            skipped_groups.join(", ")
        );
    }

    // значения-ссылки, не разрешившиеся внутри файла: их литералы живут в
    // импортируемых *.constants.ts — подсказываем, что импортировать следом
    let ref_sources: std::collections::BTreeSet<&str> = groups
        .iter()
        .filter(|g| args.all || g.is_cmd)
        .flat_map(|g| g.refs.iter())
        .map(|r| r.target.split('.').next().unwrap_or(r.target.as_str()))
        .collect();
    if !ref_sources.is_empty() {
        let n: usize = groups
            .iter()
            .filter(|g| args.all || g.is_cmd)
            .map(|g| g.refs.len())
            .sum();
        println!(
            "  {n} значений — ссылки на другие константы ({}): импортни их файлы отдельно",
            ref_sources.into_iter().collect::<Vec<_>>().join(", ")
        );
    }

    if args.dry_run {
        return Ok(ExitCode::SUCCESS);
    }

    for c in &fresh {
        db::insert_request(&pool, collection.id, &c.value, DEFAULT_URL, &c.value, "{}").await?;
    }
    if fresh.is_empty() {
        println!("создавать нечего");
    } else {
        println!("создано запросов: {}", fresh.len());
    }
    Ok(ExitCode::SUCCESS)
}
