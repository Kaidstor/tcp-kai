//! Тонкая обёртка над CLI `sec` (менеджер секретов) для `--from-sec`.
//!
//! Раскладка: коллекция (микросервис) → проект sec, пак (стенд) → инстанс
//! `-e`, переменная → ключ. То есть `{{token}}` коллекции `coordinator` на
//! стенде `prod` живёт в `tcp-kai-coordinator/TOKEN -e prod`.
//!
//! Значения приезжают через stdout дочернего процесса и никогда не идут через
//! argv — иначе секрет светился бы в `ps` и в истории шелла.
//!
//! Бинарь: `TCP_KAI_SEC_BIN`, иначе `sec` из PATH.

use std::process::{Command, Stdio};

use serde::Deserialize;
use tcp_kai_lib::db::EnvVar;

fn sec_bin() -> String {
    std::env::var("TCP_KAI_SEC_BIN")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "sec".into())
}

fn base() -> Command {
    Command::new(sec_bin())
}

/// Имя проекта sec для коллекции: `tcp-kai-<ms>`.
///
/// Слэш в имя проекта не положить: у sec это разделитель `proj/KEY`, а само
/// имя валидируется как `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Поэтому набросок
/// `tcp-kai/<ms>` живёт как `tcp-kai-<ms>`, а всё, что вне алфавита (например
/// пробелы из коллекций, переименованных миграцией в «name (id)»), схлопывается
/// в '-'.
pub fn project(collection: &str) -> String {
    let slug: String = collection
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("tcp-kai-{slug}")
}

#[derive(Deserialize)]
struct KeyRow {
    key: String,
}

/// Ключи проекта (без значений) — `sec ls <proj> --json`.
fn keys(project: &str, env: Option<&str>) -> Result<Vec<String>, String> {
    let mut cmd = base();
    cmd.arg("ls").arg(project).arg("--json");
    if let Some(e) = env {
        cmd.args(["-e", e]);
    }
    let out = cmd
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("sec не найден в PATH ({e}); установи sec или задай TCP_KAI_SEC_BIN"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        return Err(format!(
            "sec ls {project}: {}",
            if err.is_empty() { "проект не найден" } else { err }
        ));
    }
    let rows: Vec<KeyRow> = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("sec ls {project}: не разобрать JSON ({e})"))?;
    Ok(rows.into_iter().map(|r| r.key).collect())
}

/// Значение ключа — `sec get <proj>/<KEY>`.
fn get(project: &str, key: &str, env: Option<&str>) -> Result<String, String> {
    let mut cmd = base();
    cmd.arg("get").arg(format!("{project}/{key}"));
    if let Some(e) = env {
        cmd.args(["-e", e]);
    }
    let out = cmd
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("sec get: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "sec get {project}/{key}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let value = String::from_utf8_lossy(&out.stdout);
    Ok(value.trim_end_matches('\n').to_string())
}

/// Значения для переменных `needed` из проекта `project` (инстанс `env`).
///
/// Тянем только то, что упомянуто в запросе как `{{name}}`: секрет-менеджеру
/// незачем отдавать ключи, которые запросу не нужны. Имя сопоставляется без
/// учёта регистра — в паке переменная зовётся `host`, а в sec ключи принято
/// писать `HOST`. Ключи, которых в проекте нет, молча пропускаются: значение
/// возьмётся из пака, а если и там нет — `{{name}}` останется в запросе видимой
/// дырой.
pub fn resolve(project: &str, env: Option<&str>, needed: &[String]) -> Result<Vec<EnvVar>, String> {
    if needed.is_empty() {
        return Ok(Vec::new());
    }
    let available = keys(project, env)?;
    let mut out = Vec::new();

    for name in needed {
        let Some(key) = available.iter().find(|k| k.eq_ignore_ascii_case(name)) else {
            continue;
        };
        out.push(EnvVar {
            // ключ — под тем именем, под которым он упомянут в запросе,
            // иначе {{host}} не найдёт значение, приехавшее из HOST
            key: name.clone(),
            value: get(project, key, env)?,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_name_is_sec_safe() {
        assert_eq!(project("coordinator"), "tcp-kai-coordinator");
        assert_eq!(project("cloud-reader"), "tcp-kai-cloud-reader");
        // '/' — разделитель proj/KEY, пробелы и скобки вне алфавита проектов
        assert_eq!(project("a/b"), "tcp-kai-a-b");
        assert_eq!(project("test (2)"), "tcp-kai-test--2-");
    }
}
