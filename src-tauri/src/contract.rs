//! Разбор NestJS-контрактов (`*.contract.ts`, `*-cmd.ts`, `cmd.enum.ts`):
//! вытаскивает cmd-паттерны, чтобы импортировать их в коллекцию.
//!
//! Понимает три формы, встречающиеся в реальных сервисах:
//!
//! ```ts
//! export const WhoisCmd = { LOOKUP: 'lookup', ... } as const;   // as-const объект
//! export enum ScreenerCmd { begin = 'begin', ... }              // enum
//! @MessagePattern({ cmd: 'get-domains' })                       // прямо в контроллере
//! ```
//!
//! Не всякая строка в файле — cmd: zod-схемы, имена сервисов (`MSNames`) и
//! прочие константы отсеиваются тем, что контейнер должен называться
//! `*Cmd*`/`*Pattern*` (`is_cmd`); остальные группы возвращаются с
//! `is_cmd: false`, и вызывающий сам решает, показывать ли их.

use regex::Regex;
use serde::Serialize;

/// Группа cmd-значений: один enum/объект/набор `@MessagePattern` из файла.
#[derive(Debug, Clone, Serialize)]
pub struct ContractGroup {
    /// Имя контейнера (`WhoisCmd`) или `@MessagePattern`.
    pub container: String,
    /// Контейнер похож на реестр cmd (имя содержит cmd/pattern).
    pub is_cmd: bool,
    pub cmds: Vec<ContractCmd>,
    /// Записи-ссылки (`GET_LIST: IncidentsCmd.GET_LIST`), которые не удалось
    /// разрешить внутри файла — их значения живут в импортируемых файлах.
    pub refs: Vec<ContractRef>,
}

/// Значение задано ссылкой на другую константу, а не литералом.
#[derive(Debug, Clone, Serialize)]
pub struct ContractRef {
    pub key: String,
    /// `IncidentsCmd.GET_LIST` как написано в исходнике.
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContractCmd {
    /// Ключ константы (`GET_ALL`); пуст для `@MessagePattern`.
    pub key: String,
    /// Само значение паттерна (`get-all`).
    pub value: String,
    /// Перед записью стоял JSDoc с `@deprecated`.
    pub deprecated: bool,
}

/// Метка, которой `strip_comments` заменяет JSDoc с `@deprecated`: она
/// непечатаемая, в исходнике встретиться не может, а поиск по ней дешёв.
const DEPRECATED_MARK: char = '\u{1}';

/// Убирает комментарии, не трогая строки. `/** @deprecated */` оставляет
/// после себя метку, по которой помечается следующая запись.
fn strip_comments(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();

        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            let start = i;
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
            let comment: String = chars[start..i.min(chars.len())].iter().collect();
            if comment.contains("@deprecated") {
                out.push(DEPRECATED_MARK);
            }
            out.push(' ');
        } else if c == '\'' || c == '"' || c == '`' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                out.push(ch);
                i += 1;
                if ch == '\\' {
                    if let Some(&escaped) = chars.get(i) {
                        out.push(escaped);
                        i += 1;
                    }
                    continue;
                }
                if ch == c {
                    break;
                }
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Текст тела `{...}` начиная с позиции открывающей скобки; только записи
/// верхнего уровня — вложенные объекты выпадают (их строки не cmd).
fn brace_body(text: &str, open: usize) -> Option<String> {
    let chars: Vec<char> = text[open..].chars().collect();
    if chars.first() != Some(&'{') {
        return None;
    }
    let mut depth = 0usize;
    let mut body = String::new();
    for &c in &chars {
        match c {
            '{' => {
                depth += 1;
                if depth == 1 {
                    continue;
                }
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(body);
                }
            }
            _ => {}
        }
        // на глубине 1 — записи контейнера; глубже — вложенный объект
        if depth == 1 {
            body.push(c);
        } else {
            // сохранить разделитель, чтобы записи не склеились через вложенность
            body.push(' ');
        }
    }
    None
}

/// Значение паттерна выглядит как cmd, а не как случайная строка контракта.
fn plausible_cmd(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.contains('\n') && !value.contains("${")
}

/// `KEY: 'value'` / `key = 'value'` записи из плоского тела контейнера.
fn entries(body: &str) -> Vec<ContractCmd> {
    let entry_re = Regex::new(
        r#"(?s)([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*[:=]\s*('([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")"#,
    )
    .expect("entry regex");

    let mut cmds = Vec::new();
    let mut prev_end = 0usize;
    for caps in entry_re.captures_iter(body) {
        let whole = caps.get(0).expect("match");
        let key = caps
            .get(1)
            .map(|m| m.as_str().trim_matches(['\'', '"']).to_string())
            .unwrap_or_default();
        let value = caps
            .get(3)
            .or_else(|| caps.get(4))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // @deprecated из JSDoc относится к ближайшей следующей записи
        let deprecated = body[prev_end..whole.start()].contains(DEPRECATED_MARK);
        prev_end = whole.end();

        if plausible_cmd(&value) {
            cmds.push(ContractCmd {
                key,
                value,
                deprecated,
            });
        }
    }
    cmds
}

/// `KEY: OtherCmd.KEY` — записи-ссылки из плоского тела контейнера.
/// Вызовы (`id: z.number()`) отсеиваются по скобке за матчем.
fn ref_entries(body: &str) -> Vec<ContractRef> {
    let re = Regex::new(r"([A-Za-z_$][\w$]*)\s*[:=]\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)")
        .expect("ref regex");

    let mut refs = Vec::new();
    for caps in re.captures_iter(body) {
        let whole = caps.get(0).expect("match");
        let after = body[whole.end()..].trim_start();
        if after.starts_with('(') {
            continue; // вызов метода, не ссылка на константу
        }
        refs.push(ContractRef {
            key: caps.get(1).expect("key").as_str().to_string(),
            target: caps.get(2).expect("target").as_str().to_string(),
        });
    }
    refs
}

/// Имя контейнера похоже на реестр cmd-паттернов.
fn looks_like_cmd(container: &str) -> bool {
    let lower = container.to_lowercase();
    lower.contains("cmd") || lower.contains("pattern") || lower.contains("command")
}

/// Все строковые литералы внутри скобок `@MessagePattern(...)` /
/// `@EventPattern(...)` — покрывает `'x'`, `{ cmd: 'x' }` и массивы.
fn message_patterns(clean: &str) -> Vec<ContractCmd> {
    let deco_re = Regex::new(r"@(?:Message|Event)Pattern\s*\(").expect("deco regex");
    let str_re = Regex::new(r#"'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)""#)
        .expect("string regex");

    let mut cmds: Vec<ContractCmd> = Vec::new();
    for m in deco_re.find_iter(clean) {
        // балансируем скобки от конца матча
        let rest = &clean[m.end()..];
        let mut depth = 1usize;
        let mut end = rest.len();
        for (idx, c) in rest.char_indices() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = idx;
                        break;
                    }
                }
                _ => {}
            }
        }
        for caps in str_re.captures_iter(&rest[..end]) {
            let value = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|v| v.as_str().to_string())
                .unwrap_or_default();
            // { cmd: 'x' } даёт и ключ 'cmd'? нет: ключ без кавычек — литералов
            // кроме значений тут не бывает
            if plausible_cmd(&value) && !cmds.iter().any(|c| c.value == value) {
                cmds.push(ContractCmd {
                    key: String::new(),
                    value,
                    deprecated: false,
                });
            }
        }
    }
    cmds
}

/// Разбирает исходник контракта. Порядок групп — как в файле; группы без
/// единой записи не возвращаются.
pub fn parse(source: &str) -> Vec<ContractGroup> {
    let clean = strip_comments(source);
    let mut groups = Vec::new();

    // enum Name { ... } — вложенных скобок в enum не бывает
    let enum_re = Regex::new(r"enum\s+([A-Za-z_$][\w$]*)\s*\{").expect("enum regex");
    for caps in enum_re.captures_iter(&clean) {
        let name = caps.get(1).expect("name").as_str().to_string();
        let open = caps.get(0).expect("match").end() - 1;
        if let Some(body) = brace_body(&clean, open) {
            let cmds = entries(&body);
            if !cmds.is_empty() {
                groups.push(ContractGroup {
                    is_cmd: looks_like_cmd(&name),
                    container: name,
                    cmds,
                    refs: Vec::new(),
                });
            }
        }
    }

    // const Name = { ... } (as const необязателен — встречается и без него)
    let obj_re =
        Regex::new(r"const\s+([A-Za-z_$][\w$]*)\s*(?::[^={]+)?=\s*\{").expect("object regex");
    for caps in obj_re.captures_iter(&clean) {
        let name = caps.get(1).expect("name").as_str().to_string();
        let open = caps.get(0).expect("match").end() - 1;
        if let Some(body) = brace_body(&clean, open) {
            let cmds = entries(&body);
            // ссылки интересны только у cmd-реестров: агрегаторы вроде
            // NotifierCmd реэкспортируют константы соседних файлов
            let refs = if looks_like_cmd(&name) {
                ref_entries(&body)
            } else {
                Vec::new()
            };
            if !cmds.is_empty() || !refs.is_empty() {
                groups.push(ContractGroup {
                    is_cmd: looks_like_cmd(&name),
                    container: name,
                    cmds,
                    refs,
                });
            }
        }
    }

    let patterns = message_patterns(&clean);
    if !patterns.is_empty() {
        groups.push(ContractGroup {
            container: "@MessagePattern".to_string(),
            is_cmd: true,
            cmds: patterns,
            refs: Vec::new(),
        });
    }

    // Ссылки резолвим по контейнерам этого же файла (агрегатор и его
    // источники нередко лежат рядом); остальное остаётся в refs — вызывающий
    // подскажет, что файлы-источники надо импортировать отдельно.
    let lookup: std::collections::HashMap<(String, String), String> = groups
        .iter()
        .flat_map(|g| {
            let container = g.container.clone();
            g.cmds
                .iter()
                .map(move |c| ((container.clone(), c.key.clone()), c.value.clone()))
        })
        .collect();
    for g in &mut groups {
        let mut unresolved = Vec::new();
        for r in std::mem::take(&mut g.refs) {
            let resolved = r
                .target
                .rsplit_once('.')
                .and_then(|(container, key)| lookup.get(&(container.to_string(), key.to_string())))
                .cloned();
            match resolved {
                Some(value) => {
                    if !g.cmds.iter().any(|c| c.value == value) {
                        g.cmds.push(ContractCmd {
                            key: r.key,
                            value,
                            deprecated: false,
                        });
                    }
                }
                None => unresolved.push(r),
            }
        }
        g.refs = unresolved;
    }

    groups
}

/// Только cmd-значения (для импорта): записи cmd-контейнеров, без дублей,
/// в порядке появления.
pub fn cmd_values(groups: &[ContractGroup]) -> Vec<ContractCmd> {
    let mut seen = std::collections::HashSet::new();
    groups
        .iter()
        .filter(|g| g.is_cmd)
        .flat_map(|g| g.cmds.iter())
        .filter(|c| seen.insert(c.value.clone()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_as_const_object() {
        let src = r#"
/* eslint-disable */
export const WHOIS_MS_NAME = 'WHOIS';

export const WhoisCmd = {
  /** WHOIS+RDAP lookup домена */
  LOOKUP: 'lookup',
  GET_REVERSE_WHOIS_FOR_DOMAINS: 'get-reverse-whois-for-domains',
} as const;
"#;
        let groups = parse(src);
        let cmd_group = groups.iter().find(|g| g.container == "WhoisCmd").unwrap();
        assert!(cmd_group.is_cmd);
        assert_eq!(
            cmd_group
                .cmds
                .iter()
                .map(|c| c.value.as_str())
                .collect::<Vec<_>>(),
            vec!["lookup", "get-reverse-whois-for-domains"]
        );
        assert_eq!(cmd_group.cmds[0].key, "LOOKUP");
    }

    #[test]
    fn parses_enum_and_skips_service_names() {
        let src = r#"
export enum ScreenerCmd {
  // Начало сбора
  begin = 'begin',
  createScreenshotByUrl = 'create-screenshot-by-url',
}

export const MSNames = {
  proxies: 'proxies',
  coordinator: 'coordinator',
};
"#;
        let groups = parse(src);
        let screener = groups
            .iter()
            .find(|g| g.container == "ScreenerCmd")
            .unwrap();
        assert!(screener.is_cmd);
        assert_eq!(screener.cmds.len(), 2);
        assert_eq!(screener.cmds[1].value, "create-screenshot-by-url");

        // имена сервисов найдены, но не помечены как cmd — импорт их не возьмёт
        let msnames = groups.iter().find(|g| g.container == "MSNames").unwrap();
        assert!(!msnames.is_cmd);
        assert!(cmd_values(&groups).iter().all(|c| c.value != "coordinator"));
    }

    #[test]
    fn marks_deprecated_entries() {
        let src = r#"
export const DomainatorCmd = {
  /**
   * @deprecated Use ADD_TO_FAVORITES instead
   */
  DOMAINS_LK_FAVORITE_ADD: 'domains-lk-favorite-add',
  ADD_TO_FAVORITES: 'add-to-favorites',
} as const;
"#;
        let groups = parse(src);
        let cmds = &groups[0].cmds;
        assert!(cmds[0].deprecated);
        assert!(!cmds[1].deprecated);
    }

    #[test]
    fn extracts_message_patterns() {
        let src = r#"
export class DomainsController {
  @MessagePattern({ cmd: 'get-domains' })
  getDomains() {}

  @MessagePattern('remove-domain')
  removeDomain() {}

  @EventPattern(['domain-created', 'domain-updated'])
  onDomain() {}
}
"#;
        let groups = parse(src);
        let patterns = groups
            .iter()
            .find(|g| g.container == "@MessagePattern")
            .unwrap();
        assert_eq!(
            patterns
                .cmds
                .iter()
                .map(|c| c.value.as_str())
                .collect::<Vec<_>>(),
            vec![
                "get-domains",
                "remove-domain",
                "domain-created",
                "domain-updated"
            ]
        );
    }

    #[test]
    fn zod_contract_yields_no_cmds() {
        let src = r#"
import { z } from 'zod';
export const WhoisSnapshotContractSchema = z.object({
  id: z.number(),
  lookupMethod: z.enum(['rdap', 'whois', 'whoisjson']).nullable(),
});
"#;
        let groups = parse(src);
        assert!(cmd_values(&groups).is_empty(), "{groups:?}");
    }

    #[test]
    fn resolves_same_file_refs_and_reports_foreign_ones() {
        // NotifierCmd-подобный агрегатор: часть значений — литералы, часть —
        // ссылки на соседний контейнер (резолвится) и на импорт (нет)
        let src = r#"
export const IncidentsCmd = {
  GET_LIST: 'incidents-get-list',
} as const;

export const NotifierCmd = {
  SEND: 'notifier-send',
  GET_LIST: IncidentsCmd.GET_LIST,
  SMTP_LIST: SmtpConfigsCmd.LIST,
} as const;
"#;
        let groups = parse(src);
        let notifier = groups
            .iter()
            .find(|g| g.container == "NotifierCmd")
            .unwrap();
        let values: Vec<&str> = notifier.cmds.iter().map(|c| c.value.as_str()).collect();
        assert!(values.contains(&"notifier-send"));
        assert!(values.contains(&"incidents-get-list"), "{values:?}");
        assert_eq!(notifier.refs.len(), 1);
        assert_eq!(notifier.refs[0].target, "SmtpConfigsCmd.LIST");
    }

    #[test]
    fn method_calls_are_not_refs() {
        let src = r#"
const SchemaCmd = {
  ID: 'id-cmd',
  broken: z.number(),
};
"#;
        let groups = parse(src);
        assert!(groups[0].refs.is_empty(), "{:?}", groups[0].refs);
    }

    #[test]
    fn nested_objects_do_not_leak_entries() {
        let src = r#"
const AppCmd = {
  OUTER: 'outer',
  nested: { inner: 'not-a-cmd' },
  AFTER: 'after',
};
"#;
        let groups = parse(src);
        let values: Vec<&str> = groups[0].cmds.iter().map(|c| c.value.as_str()).collect();
        assert_eq!(values, vec!["outer", "after"]);
    }
}
