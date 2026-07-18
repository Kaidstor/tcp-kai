//! Разрешение имён, которые пользователь пишет в командной строке, в строки
//! базы приложения. Везде: точное совпадение → без учёта регистра → внятная
//! ошибка со списком подходящего.

pub mod daemon;
pub mod envs;
pub mod history;
pub mod import;
pub mod ls;
pub mod parse;
pub mod send;

use sqlx::SqlitePool;
use tcp_kai_lib::db::{self, Collection, EnvPack, Request};

/// Длина общего начала — ловит опечатку в хвосте («coordinatr» → «coordinator»),
/// которую поиск по подстроке пропускает.
fn common_prefix(a: &str, b: &str) -> usize {
    a.chars()
        .zip(b.chars())
        .take_while(|(x, y)| x.eq_ignore_ascii_case(y))
        .count()
}

/// «Не нашёл» со списком кандидатов: сначала похожие (по подстроке или общему
/// началу), а если таких нет — всё, что есть. Опечатка в имени сервиса не
/// должна заканчиваться походом в GUI за правильным написанием.
fn unknown<'a>(what: &str, name: &str, candidates: impl Iterator<Item = &'a str>) -> String {
    let all: Vec<&str> = candidates.collect();
    let needle = name.to_lowercase();
    let near: Vec<&str> = all
        .iter()
        .copied()
        .filter(|c| c.to_lowercase().contains(&needle) || common_prefix(c, name) >= 3)
        .collect();

    let list = if near.is_empty() { &all } else { &near };
    if list.is_empty() {
        return format!("{what} «{name}» не найден(а), и других нет");
    }
    format!(
        "{what} «{name}» не найден(а). Есть: {}",
        list.join(", ")
    )
}

/// Коллекция (микросервис) по имени.
pub async fn collection(pool: &SqlitePool, name: &str) -> Result<Collection, String> {
    let all = db::collections(pool).await?;
    all.iter()
        .find(|c| c.name == name)
        .or_else(|| all.iter().find(|c| c.name.eq_ignore_ascii_case(name)))
        .cloned()
        .ok_or_else(|| unknown("коллекция", name, all.iter().map(|c| c.name.as_str())))
}

/// Запрос по имени или по `cmd` — в палитре приложения ищется и то, и другое.
pub fn request<'a>(requests: &'a [Request], name: &str) -> Result<&'a Request, String> {
    requests
        .iter()
        .find(|r| r.name == name)
        .or_else(|| requests.iter().find(|r| r.cmd.as_deref() == Some(name)))
        .or_else(|| requests.iter().find(|r| r.name.eq_ignore_ascii_case(name)))
        .or_else(|| {
            requests
                .iter()
                .find(|r| r.cmd.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(name)))
        })
        .ok_or_else(|| unknown("запрос", name, requests.iter().map(|r| r.name.as_str())))
}

/// Пак переменных: явный `-e`, иначе применённый в приложении (может не быть
/// вовсе — тогда подставлять нечем).
pub fn pack<'a>(
    packs: &'a [EnvPack],
    collection: &Collection,
    wanted: Option<&str>,
) -> Result<Option<&'a EnvPack>, String> {
    let Some(name) = wanted else {
        return Ok(collection
            .pack_id
            .and_then(|id| packs.iter().find(|p| p.id == id)));
    };

    let mut found: Vec<&EnvPack> = packs
        .iter()
        .filter(|p| p.name.eq_ignore_ascii_case(name))
        .collect();
    // одноимённые пак коллекции и глобальный: свой конкретнее — он и выигрывает
    found.sort_by_key(|p| p.collection_id.is_none());

    match found.first() {
        Some(p) => Ok(Some(p)),
        None => Err(unknown("пак", name, packs.iter().map(|p| p.name.as_str()))),
    }
}
