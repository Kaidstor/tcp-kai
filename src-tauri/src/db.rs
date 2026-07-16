//! Чтение app.db для CLI: коллекции (микросервисы), запросы и паки переменных
//! — та же база, что у GUI, поэтому `tcp-kai` видит всё заведённое в
//! приложении, а отправка из CLI попадает в общую историю.
//!
//! Схемой владеют миграции приложения (`lib.rs`): здесь база только
//! открывается (`create_if_missing(false)`) — CLI не должен создавать пустую
//! базу и подсовывать её GUI, если приложение ещё ни разу не запускали.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

/// identifier из tauri.conf.json — им же tauri именует каталог с данными.
pub const APP_IDENTIFIER: &str = "com.kaidstor.app";

/// Коллекция = микросервис (`coordinator`, `whois`, …).
#[derive(Debug, Clone, Serialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    /// Пак, применённый в GUI; CLI переопределяет его флагом `-e`.
    pub pack_id: Option<i64>,
}

/// Сохранённый запрос: `cmd` — паттерн NestJS, `url` — строка подключения с
/// `{{host}}:{{port}}` до подстановки. `emit` — event-паттерн: кадр без id,
/// ответ не ожидается.
#[derive(Debug, Clone, Serialize)]
pub struct Request {
    pub id: i64,
    pub name: String,
    pub url: Option<String>,
    pub cmd: Option<String>,
    pub body: Option<String>,
    pub weight: Option<i64>,
    pub emit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

/// Пак переменных = стенд (`local`, `prod`). `collection_id: None` —
/// глобальный, доступен любой коллекции.
#[derive(Debug, Clone, Serialize)]
pub struct EnvPack {
    pub id: i64,
    pub name: String,
    pub vars: Vec<EnvVar>,
    pub collection_id: Option<i64>,
}

/// Путь к базе приложения. `TCP_KAI_DB` перекрывает — нужен для тестов на
/// копии, чтобы не трогать живую базу.
pub fn db_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("TCP_KAI_DB") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    // tauri кладёт базу в app_config_dir = <config_dir>/<identifier>
    let dir = dirs::config_dir().ok_or("не удалось определить каталог конфигурации")?;
    Ok(dir.join(APP_IDENTIFIER).join("app.db"))
}

/// Открывает базу приложения. GUI может держать её открытой, поэтому ждём на
/// блокировке вместо падения по SQLITE_BUSY.
pub async fn open() -> Result<SqlitePool, String> {
    let path = db_path()?;
    if !path.exists() {
        return Err(format!(
            "база приложения не найдена: {}\nзапусти tcp-kai хотя бы раз — CLI работает с его базой",
            path.display()
        ));
    }
    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("не удалось открыть {}: {e}", path.display()))
}

/// Разбор `vars`: битая или правленная руками строка не должна ронять весь
/// список паков — как и в приложении, такой пак просто едет пустым.
fn parse_vars(raw: &str) -> Vec<EnvVar> {
    serde_json::from_str(raw).unwrap_or_default()
}

/// Колонки v8 (`requests.emit`, `history.ok/cmd/url/pack`) появляются
/// миграцией GUI при его первом запуске. Обновлённый CLI мог оказаться на
/// машине раньше — деградируем мягко, а не падаем на «no such column».
async fn has_column(pool: &SqlitePool, table: &str, column: &str) -> bool {
    sqlx::query("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")
        .bind(table)
        .bind(column)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .is_some()
}

pub async fn collections(pool: &SqlitePool) -> Result<Vec<Collection>, String> {
    let rows = sqlx::query("SELECT id, name, pack_id FROM collections ORDER BY name ASC")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| Collection {
            id: r.get("id"),
            name: r.get("name"),
            pack_id: r.get("pack_id"),
        })
        .collect())
}

/// Запросы коллекции — в порядке сайдбара GUI (самые используемые сверху).
pub async fn requests(pool: &SqlitePool, collection_id: i64) -> Result<Vec<Request>, String> {
    let emit_col = if has_column(pool, "requests", "emit").await {
        "emit"
    } else {
        "0 AS emit"
    };
    let rows = sqlx::query(&format!(
        "SELECT id, name, url, cmd, body, weight, {emit_col}
           FROM requests
          WHERE collection_id = ?
          ORDER BY weight DESC, name ASC",
    ))
    .bind(collection_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| Request {
            id: r.get("id"),
            name: r.get("name"),
            url: r.get("url"),
            cmd: r.get("cmd"),
            body: r.get("body"),
            weight: r.get("weight"),
            emit: r.get::<i64, _>("emit") != 0,
        })
        .collect())
}

/// Создаёт запрос — используется импортом контрактов. Возвращает id.
pub async fn insert_request(
    pool: &SqlitePool,
    collection_id: i64,
    name: &str,
    url: &str,
    cmd: &str,
    body: &str,
) -> Result<i64, String> {
    let id = sqlx::query(
        "INSERT INTO requests (collection_id, name, url, cmd, body) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(collection_id)
    .bind(name)
    .bind(url)
    .bind(cmd)
    .bind(body)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();
    Ok(id)
}

/// Паки, доступные коллекции: глобальные плюс её собственные — тот же отбор,
/// что у `usableEnvPacks` на фронтенде.
pub async fn packs(pool: &SqlitePool, collection_id: i64) -> Result<Vec<EnvPack>, String> {
    let rows = sqlx::query(
        "SELECT id, name, vars, collection_id
           FROM env_packs
          WHERE collection_id IS NULL OR collection_id = ?
          ORDER BY name ASC",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            let vars: String = r.get("vars");
            EnvPack {
                id: r.get("id"),
                name: r.get("name"),
                vars: parse_vars(&vars),
                collection_id: r.get("collection_id"),
            }
        })
        .collect())
}

/// Контекст записи истории: что и куда реально отправлялось. `sent` — тело
/// с `{{vars}}` до подстановки (секретам нечего делать в незашифрованной базе).
pub struct SendRecord<'a> {
    pub request_id: i64,
    pub sent: &'a str,
    pub received: &'a str,
    pub execution_time_ms: f64,
    /// Обмен удался; ошибки тоже пишутся — «что я послал, когда упало».
    pub ok: bool,
    pub cmd: &'a str,
    /// Строка подключения после подстановки — куда фактически ходили.
    pub url: &'a str,
    pub pack: Option<&'a str>,
}

/// Сколько записей истории хранится на запрос: ключ `history_limit` из
/// settings (им же пользуется GUI), 0 — без лимита.
pub const DEFAULT_HISTORY_LIMIT: i64 = 200;

async fn history_limit(pool: &SqlitePool) -> i64 {
    let raw: Option<Option<String>> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'history_limit'")
            .fetch_optional(pool)
            .await
            .unwrap_or(None);
    raw.flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| *n >= 0)
        .unwrap_or(DEFAULT_HISTORY_LIMIT)
}

/// Записывает отправку так же, как GUI: запись в историю, затухание весов на
/// −10% и +1 отправленному. Одной транзакцией — иначе параллельный GUI успеет
/// увидеть затухание без бампа. Хвост истории сверх лимита обрезается.
pub async fn record_send(pool: &SqlitePool, rec: &SendRecord<'_>) -> Result<i64, String> {
    let limit = history_limit(pool).await;
    let v8 = has_column(pool, "history", "ok").await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // timestamp считает сам SQLite: strftime('%Y-%m-%dT%H:%M:%fZ') повторяет
    // формат Date.toISOString() из приложения, которым отсортирована история
    let id = if v8 {
        sqlx::query(
            "INSERT INTO history (request_id, sent, received, timestamp, execution_time, ok, cmd, url, pack)
             VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?, ?, ?)",
        )
        .bind(rec.request_id)
        .bind(rec.sent)
        .bind(rec.received)
        .bind(rec.execution_time_ms)
        .bind(rec.ok as i64)
        .bind(rec.cmd)
        .bind(rec.url)
        .bind(rec.pack)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .last_insert_rowid()
    } else {
        sqlx::query(
            "INSERT INTO history (request_id, sent, received, timestamp, execution_time)
             VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)",
        )
        .bind(rec.request_id)
        .bind(rec.sent)
        .bind(rec.received)
        .bind(rec.execution_time_ms)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .last_insert_rowid()
    };

    if limit > 0 {
        sqlx::query(
            "DELETE FROM history
              WHERE request_id = ?1
                AND id NOT IN (
                  SELECT id FROM history
                   WHERE request_id = ?1
                   ORDER BY timestamp DESC, id DESC
                   LIMIT ?2
                )",
        )
        .bind(rec.request_id)
        .bind(limit)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    sqlx::query("UPDATE requests SET weight = (weight * 9) / 10 WHERE weight > 0")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE requests SET weight = COALESCE(weight, 0) + 1 WHERE id = ?")
        .bind(rec.request_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(id)
}

/// Запись истории для `tcp-kai history` — последние обмены запроса.
#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub timestamp: String,
    pub execution_time: Option<f64>,
    pub ok: bool,
    pub pack: Option<String>,
    pub url: Option<String>,
    pub sent: Option<String>,
    pub received: Option<String>,
}

pub async fn history(
    pool: &SqlitePool,
    request_id: i64,
    limit: i64,
) -> Result<Vec<HistoryEntry>, String> {
    let cols = if has_column(pool, "history", "ok").await {
        "ok, pack, url"
    } else {
        "1 AS ok, NULL AS pack, NULL AS url"
    };
    let rows = sqlx::query(&format!(
        "SELECT id, timestamp, execution_time, {cols}, sent, received
           FROM history
          WHERE request_id = ?
          ORDER BY timestamp DESC, id DESC
          LIMIT ?",
    ))
    .bind(request_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| HistoryEntry {
            id: r.get("id"),
            timestamp: r.get("timestamp"),
            execution_time: r.get("execution_time"),
            ok: r.get::<i64, _>("ok") != 0,
            pack: r.get("pack"),
            url: r.get("url"),
            sent: r.get("sent"),
            received: r.get("received"),
        })
        .collect())
}

/// Строка списка коллекций для `tcp-kai ls`.
#[derive(Debug, Clone, Serialize)]
pub struct CollectionOverview {
    pub name: String,
    /// Пак, применённый в приложении; None — коллекция без переменных.
    pub pack: Option<String>,
    pub requests: i64,
}

pub async fn overview(pool: &SqlitePool) -> Result<Vec<CollectionOverview>, String> {
    let rows = sqlx::query(
        "SELECT c.name AS name,
                p.name AS pack,
                (SELECT COUNT(*) FROM requests r WHERE r.collection_id = c.id) AS n
           FROM collections c
           LEFT JOIN env_packs p ON p.id = c.pack_id
          ORDER BY c.name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| CollectionOverview {
            name: r.get("name"),
            pack: r.get("pack"),
            requests: r.get("n"),
        })
        .collect())
}
