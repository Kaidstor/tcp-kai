//! Вывод команд: текст по умолчанию, `--json` — конверт семьи CLI, отказ
//! тоже конвертом в stdout.

use std::fmt;
use std::process::ExitCode;

use serde::Serialize;
use serde_json::Value;

/// Версия конверта; растёт, когда меняется форма полей.
pub const SCHEMA_VERSION: u32 = 1;

/// Таблица кодов продублирована в `after_help` (main.rs) — меняется вместе.
pub mod code {
    pub const OK: u8 = 0;
    pub const NOT_APPLIED: u8 = 1;
    pub const TOOL: u8 = 2;
    pub const NOT_FOUND: u8 = 3;
    pub const TIMEOUT: u8 = 4;
}

#[derive(Debug, Clone)]
pub struct CliError {
    pub code: u8,
    pub kind: &'static str,
    pub message: String,
}

impl CliError {
    pub fn new(code: u8, kind: &'static str, message: impl Into<String>) -> Self {
        CliError {
            code,
            kind,
            message: message.into(),
        }
    }
    pub fn usage(message: impl Into<String>) -> Self {
        Self::new(code::TOOL, "usage", message)
    }
    pub fn config(message: impl Into<String>) -> Self {
        Self::new(code::TOOL, "config", message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(code::NOT_FOUND, "not_found", message)
    }
    pub fn network(message: impl Into<String>) -> Self {
        Self::new(code::TOOL, "network", message)
    }
    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(code::TIMEOUT, "timeout", message)
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// Нетипизированные ошибки ядра — это запросы к базе приложения: всё, что
/// классифицируется иначе, размечается на месте вызова.
impl From<String> for CliError {
    fn from(message: String) -> Self {
        Self::new(code::TOOL, "db", message)
    }
}

pub struct Done {
    pub code: u8,
    pub data: Value,
    pub error: Option<CliError>,
}

impl Done {
    pub fn ok(data: impl Serialize) -> Self {
        Done {
            code: code::OK,
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            error: None,
        }
    }

    pub fn partial(data: impl Serialize, error: CliError) -> Self {
        Done {
            code: error.code,
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            error: Some(error),
        }
    }
}

#[derive(Serialize)]
struct Failure<'a> {
    kind: &'a str,
    message: &'a str,
}

#[derive(Serialize)]
struct Envelope<'a> {
    v: u32,
    command: &'a str,
    exit: u8,
    data: &'a Value,
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    warning: &'a [String],
    error: Option<Failure<'a>>,
}

pub struct Printer {
    pub json: bool,
    warnings: Vec<String>,
}

impl Printer {
    pub fn new(json: bool) -> Self {
        Printer {
            json,
            warnings: Vec::new(),
        }
    }

    pub fn warn(&mut self, message: impl Into<String>) {
        let message = message.into();
        if self.json {
            self.warnings.push(message);
        } else {
            eprintln!("tcp-kai: {message}");
        }
    }

    /// Текст результата человеку команды печатают сами: здесь в текстовом
    /// режиме печатается только отказ.
    pub fn finish(&self, command: &str, result: Result<Done, CliError>) -> ExitCode {
        let (code, data, error) = match result {
            Ok(done) => (done.code, done.data, done.error),
            Err(e) => (e.code, Value::Null, Some(e)),
        };
        if self.json {
            println!("{}", self.render(command, code, &data, error.as_ref()));
        } else if let Some(e) = &error {
            eprintln!("tcp-kai: {}", e.message);
        }
        ExitCode::from(code)
    }

    fn render(&self, command: &str, code: u8, data: &Value, error: Option<&CliError>) -> String {
        let envelope = Envelope {
            v: SCHEMA_VERSION,
            command,
            exit: code,
            data,
            warning: &self.warnings,
            error: error.map(|e| Failure {
                kind: e.kind,
                message: &e.message,
            }),
        };
        serde_json::to_string_pretty(&envelope).unwrap_or_else(|e| {
            format!(r#"{{"v":{SCHEMA_VERSION},"command":"{command}","exit":{code},"data":null,"error":{{"kind":"internal","message":"конверт не сериализовался: {e}"}}}}"#)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(p: &Printer, command: &str, result: Result<Done, CliError>) -> Value {
        let (code, data, error) = match result {
            Ok(d) => (d.code, d.data, d.error),
            Err(e) => (e.code, Value::Null, Some(e)),
        };
        serde_json::from_str(&p.render(command, code, &data, error.as_ref())).unwrap()
    }

    #[test]
    fn success_envelope_has_null_error_and_no_warning() {
        let p = Printer::new(true);
        let v = parse(&p, "ls", Ok(Done::ok(vec!["a"])));
        assert_eq!(v["v"], 1);
        assert_eq!(v["command"], "ls");
        assert_eq!(v["exit"], 0);
        assert_eq!(v["data"][0], "a");
        assert!(v["error"].is_null());
        assert!(v.get("warning").is_none());
    }

    #[test]
    fn failure_envelope_carries_kind_and_exit() {
        let mut p = Printer::new(true);
        p.warn("осторожно");
        let v = parse(
            &p,
            "send",
            Err(CliError::not_found("коллекция «x» не найдена")),
        );
        assert_eq!(v["exit"], 3);
        assert!(v["data"].is_null());
        assert_eq!(v["error"]["kind"], "not_found");
        assert_eq!(v["warning"][0], "осторожно");
    }

    #[test]
    fn partial_keeps_data_next_to_error() {
        let p = Printer::new(true);
        let err = CliError::new(code::NOT_APPLIED, "api", "Не авторизован");
        let v = parse(
            &p,
            "send",
            Ok(Done::partial(serde_json::json!({"err": 1}), err)),
        );
        assert_eq!(v["exit"], 1);
        assert_eq!(v["data"]["err"], 1);
        assert_eq!(v["error"]["kind"], "api");
    }

    #[test]
    fn ampersand_is_not_escaped() {
        let p = Printer::new(true);
        let v = p.render("x", 0, &Value::String("a&b<c>".into()), None);
        assert!(v.contains("a&b<c>"));
    }
}
