// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};
use tauri_plugin_process;
use tauri_plugin_updater;

mod commands;
pub mod contract;
pub mod daemon;
pub mod tcp;

// Доступ к app.db из Rust нужен только CLI: у GUI база своя, через plugin-sql
// на фронтенде. Под фичей, чтобы обычная сборка не тянула sqlx напрямую.
#[cfg(feature = "cli")]
pub mod db;

use std::sync::{Arc, Mutex};

/// Нативное меню приложения: Check for Updates / Settings / Install CLI…
/// Пункты шлют на фронтенд события `menu://<id>` — обработчики в App.tsx.
/// Edit-меню обязательно: без него в webview на macOS не работают ⌘C/⌘V.
#[cfg(desktop)]
fn set_app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    use tauri::Emitter;

    let handle = app.handle();
    let check_updates =
        MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(handle)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    let install_cli =
        MenuItemBuilder::with_id("install-cli", "Install CLI…").build(handle)?;
    let app_menu = SubmenuBuilder::new(handle, "tcp-kai")
        .about(Some(AboutMetadata::default()))
        .item(&check_updates)
        .separator()
        .item(&settings)
        .item(&install_cli)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if matches!(id, "settings" | "check-updates" | "install-cli") {
            let _ = app.emit(&format!("menu://{id}"), ());
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Define a single initial migration for final schema
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema".into(),
            sql: r#"
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pack_id INTEGER REFERENCES env_packs(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS env_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vars TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  cmd TEXT,
  body TEXT
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sent TEXT,
  received TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_settings_table".into(),
            sql: r#"

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Индекс для быстрого поиска по ключу
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
-- Начальные настройки
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_collection_id', NULL);
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_request_id', NULL);
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_execution_time".into(),
            sql: r#"
-- Add execution_time column to history table
ALTER TABLE history ADD COLUMN execution_time REAL;
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_collection_id_to_env_packs".into(),
            sql: r#"
-- Add collection_id to env_packs to allow for global or collection-specific packs
ALTER TABLE env_packs ADD COLUMN collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL;
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_received_to_requests".into(),
            sql: r#"
ALTER TABLE requests ADD COLUMN received TEXT;
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_weight_to_requests".into(),
            sql: r#"
ALTER TABLE requests ADD COLUMN weight INTEGER;
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_unique_collection_name".into(),
            sql: r#"
UPDATE collections
SET name = name || ' (' || id || ')'
WHERE id NOT IN (
  SELECT MIN(id) FROM collections GROUP BY name
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "history_context_and_emit".into(),
            sql: r#"
-- Контекст обмена на момент отправки: без него запись истории после
-- переименования cmd или смены пака перестаёт что-либо говорить.
-- ok: 0 — обмен не удался (раньше ошибки в историю не попадали вовсе).
ALTER TABLE history ADD COLUMN ok INTEGER NOT NULL DEFAULT 1;
ALTER TABLE history ADD COLUMN cmd TEXT;
ALTER TABLE history ADD COLUMN url TEXT;
ALTER TABLE history ADD COLUMN pack TEXT;
-- Event-паттерн (@EventPattern): кадр без id, ответ не ожидается.
ALTER TABLE requests ADD COLUMN emit INTEGER NOT NULL DEFAULT 0;
"#
            .into(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_last_used_at_to_requests".into(),
            sql: r#"
-- Момент последней отправки (ms epoch) — опора half-life-распада веса.
-- NULL у старых строк: их вес берётся как есть, распад начнётся с первой отправки.
ALTER TABLE requests ADD COLUMN last_used_at INTEGER;
"#
            .into(),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                set_app_menu(app)?;
            }
            Ok(())
        })
        // Initialize SQL plugin with migrations
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:app.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Mutex::new(commands::RequestState::new())))
        .invoke_handler(tauri::generate_handler![
            commands::send_tcp_request,
            commands::cancel_tcp_request,
            commands::parse_contract,
            commands::install_cli,
            commands::relaunch_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
