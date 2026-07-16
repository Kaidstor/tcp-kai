//! Подстановка `{{name}}` — то же поведение, что у `processEnvVars` на
//! фронтенде: неизвестное имя остаётся в тексте как есть, чтобы опечатка была
//! видна в запросе, а не превращалась молча в пустую строку.

use tcp_kai_lib::db::EnvVar;

/// Ищет значение так же, как фронтенд: там `new Map(vars)`, где последующий
/// одноимённый ключ затирает предыдущий. Отсюда же слоистость источников:
/// пак → sec → `--var`, каждый следующий просто дописывается в конец.
fn lookup<'a>(vars: &'a [EnvVar], name: &str) -> Option<&'a str> {
    vars.iter()
        .rev()
        .find(|v| v.key == name)
        .map(|v| v.value.as_str())
}

/// Заменяет `{{name}}` значениями из `vars`.
///
/// Повторяет регулярку фронтенда `/\{\{([^}]+)\}\}/g` с `name.trim()`: имя не
/// может содержать `}`, пустое `{{}}` — не плейсхолдер.
pub fn substitute(text: &str, vars: &[EnvVar]) -> String {
    if text.is_empty() || vars.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            // `[^}]+` — имя непустое и без '}', и закрыто именно '}}'
            Some(end) if end > 0 && after[end..].starts_with("}}") => {
                let raw = &after[..end];
                match lookup(vars, raw.trim()) {
                    Some(value) => out.push_str(value),
                    None => {
                        out.push_str("{{");
                        out.push_str(raw);
                        out.push_str("}}");
                    }
                }
                rest = &after[end + 2..];
            }
            // не плейсхолдер — «{{» едет в текст как обычные символы
            _ => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Имена, упомянутые в тексте как `{{name}}`, без повторов и в порядке
/// появления. По ним CLI понимает, что вообще нужно запросу — и, в частности,
/// какие ключи тянуть из sec (лишние секреты читать незачем).
pub fn placeholders(text: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut rest = text;

    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) if end > 0 && after[end..].starts_with("}}") => {
                let name = after[..end].trim().to_string();
                if !name.is_empty() && !found.contains(&name) {
                    found.push(name);
                }
                rest = &after[end + 2..];
            }
            _ => rest = after,
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> Vec<EnvVar> {
        pairs
            .iter()
            .map(|(k, v)| EnvVar {
                key: k.to_string(),
                value: v.to_string(),
            })
            .collect()
    }

    #[test]
    fn replaces_known_and_keeps_unknown() {
        let v = vars(&[("host", "10.0.0.1"), ("port", "18009")]);
        assert_eq!(substitute("{{host}}:{{port}}", &v), "10.0.0.1:18009");
        // опечатка должна остаться видимой, а не стать пустой строкой
        assert_eq!(substitute("{{hots}}:{{port}}", &v), "{{hots}}:18009");
    }

    #[test]
    fn trims_name_inside_braces() {
        let v = vars(&[("host", "x")]);
        assert_eq!(substitute("{{ host }}", &v), "x");
    }

    #[test]
    fn later_value_wins() {
        // порядок источников: пак → sec → --var, побеждает последний
        let v = vars(&[("host", "from-pack"), ("host", "from-flag")]);
        assert_eq!(substitute("{{host}}", &v), "from-flag");
    }

    #[test]
    fn empty_placeholder_is_not_one() {
        let v = vars(&[("host", "x")]);
        assert_eq!(substitute("{{}}", &v), "{{}}");
        assert_eq!(substitute("{{a}b}}", &v), "{{a}b}}");
    }

    #[test]
    fn placeholders_are_unique_and_ordered() {
        assert_eq!(
            placeholders("{{host}}:{{port}}/{{host}}"),
            vec!["host".to_string(), "port".to_string()]
        );
        assert!(placeholders("{{}}").is_empty());
    }
}
