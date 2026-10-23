//! Тонкая обёртка над CLI `sec` (менеджер секретов) для `--from-sec`.
//!
//! Раскладка: коллекция (микросервис) → проект sec, пак (стенд) → профиль
//! `@<пак>`, переменная → ключ. То есть `{{token}}` коллекции `coordinator` на
//! стенде `prod` живёт в `tcp-kai-coordinator@prod/TOKEN`.
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

/// Адрес набора значений в sec: `<proj>@<пак>`, без пака — `<proj>@`.
///
/// Флага `-e` у sec больше нет (с 1.x профиль — часть адреса), а '@' нужен
/// и без пака: голый `<proj>` у проекта с профилями `sec ls --json` отдаёт
/// картой профилей вместо ключей, а `get` подставляет default из `.sec`
/// текущей папки.
pub fn address(project: &str, env: Option<&str>) -> String {
    format!("{project}@{}", env.unwrap_or(""))
}

#[derive(Deserialize)]
struct KeyRow {
    key: String,
}

/// Ключи набора (без значений) — `sec ls <proj>@<пак> --json`.
fn keys(addr: &str) -> Result<Vec<String>, String> {
    let out = base()
        .args(["ls", addr, "--json"])
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            format!("sec не найден в PATH ({e}); установи sec или задай TCP_KAI_SEC_BIN")
        })?;

    if !out.status.success() {
        let err = envelope_error(&out.stdout)
            .unwrap_or_else(|| String::from_utf8_lossy(&out.stderr).trim().to_string());
        return Err(format!(
            "sec ls {addr}: {}",
            if err.is_empty() {
                "проект не найден"
            } else {
                &err
            }
        ));
    }
    parse_keys(&out.stdout).map_err(|e| format!("sec ls {addr}: {e}"))
}

/// Разбирает ответ `sec ls --json`: голый массив строк до sec с конвертом и
/// конверт `{v, data, error}` после — обе формы, пока на машинах стоят разные
/// версии sec.
fn parse_keys(stdout: &[u8]) -> Result<Vec<String>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(stdout).map_err(|e| format!("не разобрать JSON ({e})"))?;
    let rows = match value {
        serde_json::Value::Object(mut map) if map.contains_key("v") => {
            map.remove("data").unwrap_or(serde_json::Value::Null)
        }
        other => other,
    };
    let rows: Vec<KeyRow> =
        serde_json::from_value(rows).map_err(|e| format!("неожиданный формат ответа ({e})"))?;
    Ok(rows.into_iter().map(|r| r.key).collect())
}

/// Текст отказа из конверта: sec с `--json` пишет его в stdout, а не в stderr.
fn envelope_error(stdout: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(stdout).ok()?;
    value
        .get("error")?
        .get("message")?
        .as_str()
        .map(str::to_string)
}

/// Значение ключа — `sec get <proj>@<пак>/<KEY>`.
fn get(addr: &str, key: &str) -> Result<String, String> {
    let out = base()
        .arg("get")
        .arg(format!("{addr}/{key}"))
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("sec get: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "sec get {addr}/{key}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let value = String::from_utf8_lossy(&out.stdout);
    Ok(value.trim_end_matches('\n').to_string())
}

/// Значения для переменных `needed` из набора `addr` (см. [`address`]).
///
/// Тянем только то, что упомянуто в запросе как `{{name}}`: секрет-менеджеру
/// незачем отдавать ключи, которые запросу не нужны. Имя сопоставляется без
/// учёта регистра — в паке переменная зовётся `host`, а в sec ключи принято
/// писать `HOST`. Ключи, которых в проекте нет, молча пропускаются: значение
/// возьмётся из пака, а если и там нет — `{{name}}` останется в запросе видимой
/// дырой.
pub fn resolve(addr: &str, needed: &[String]) -> Result<Vec<EnvVar>, String> {
    if needed.is_empty() {
        return Ok(Vec::new());
    }
    let available = keys(addr)?;
    let mut out = Vec::new();

    for name in needed {
        let Some(key) = available.iter().find(|k| k.eq_ignore_ascii_case(name)) else {
            continue;
        };
        out.push(EnvVar {
            // ключ — под тем именем, под которым он упомянут в запросе,
            // иначе {{host}} не найдёт значение, приехавшее из HOST
            key: name.clone(),
            value: get(addr, key)?,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_keys_reads_bare_array_and_envelope() {
        let bare = br#"[{"key":"TOKEN"},{"key":"URL"}]"#;
        let env = br#"{"v":1,"command":"ls","exit":0,"data":[{"key":"TOKEN"}],"error":null}"#;
        assert_eq!(parse_keys(bare).unwrap(), vec!["TOKEN", "URL"]);
        assert_eq!(parse_keys(env).unwrap(), vec!["TOKEN"]);
        assert!(parse_keys(br#"{"v":1,"data":{"prod":[]}}"#).is_err());
    }

    #[test]
    fn envelope_error_takes_message_from_stdout() {
        let out = br#"{"v":1,"command":"ls","exit":3,"data":null,"error":{"kind":"not_found","message":"no project"}}"#;
        assert_eq!(envelope_error(out).as_deref(), Some("no project"));
        assert_eq!(envelope_error(b"plain text"), None);
    }

    /// Граница с настоящим sec: адресация пака и базового набора должна
    /// совпадать с его текущим CLI-контрактом, а не с нашей моделью.
    #[cfg(unix)]
    #[test]
    fn resolve_reads_pack_profile_from_real_sec() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        if Command::new("sec").arg("version").output().is_err() {
            eprintln!("sec не найден в PATH — тест границы с sec пропущен");
            return;
        }
        // свой стор, HOME и выдуманный мастер-ключ: настоящий стор, keychain и
        // журнал обращений тест не трогает
        let dir = std::env::temp_dir().join(format!("tcp-kai-sec-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wrapper = dir.join("sec");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nHOME='{d}' SEC_STORE='{d}/store.enc' SEC_KEY={key} SEC_NO_USAGE=1 exec sec \"$@\"\n",
                d = dir.display(),
                key = "ab".repeat(32),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();

        let set = |addr: &str, value: &str| {
            let mut child = Command::new(&wrapper)
                .args(["set", addr])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(value.as_bytes())
                .unwrap();
            assert!(child.wait().unwrap().success(), "sec set {addr}");
        };
        set("tcp-kai-svc@prod/HOST", "prod-host");
        set("tcp-kai-svc@prod/PORT", "8001");
        set("tcp-kai-svc/HOST", "base-host");
        std::env::set_var("TCP_KAI_SEC_BIN", &wrapper);

        let needed = vec!["host".to_string(), "port".to_string()];
        let prod = resolve(&address("tcp-kai-svc", Some("prod")), &needed);
        let base = resolve(&address("tcp-kai-svc", None), &needed);
        std::fs::remove_dir_all(&dir).ok();

        let pairs = |vars: Vec<EnvVar>| -> Vec<(String, String)> {
            vars.into_iter().map(|v| (v.key, v.value)).collect()
        };
        assert_eq!(
            pairs(prod.unwrap()),
            vec![
                ("host".to_string(), "prod-host".to_string()),
                ("port".to_string(), "8001".to_string()),
            ]
        );
        // у проекта есть профили, но без пака нужен базовый набор, а не карта профилей
        assert_eq!(
            pairs(base.unwrap()),
            vec![("host".to_string(), "base-host".to_string())]
        );
    }

    #[test]
    fn project_name_is_sec_safe() {
        assert_eq!(project("coordinator"), "tcp-kai-coordinator");
        assert_eq!(project("cloud-reader"), "tcp-kai-cloud-reader");
        // '/' — разделитель proj/KEY, пробелы и скобки вне алфавита проектов
        assert_eq!(project("a/b"), "tcp-kai-a-b");
        assert_eq!(project("test (2)"), "tcp-kai-test--2-");
    }
}
