// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

mod commands;
use std::sync::{Arc, Mutex};

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
"#.into(),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        // Initialize SQL plugin with migrations
        .plugin(SqlBuilder::default().add_migrations("sqlite:app.db", migrations).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Mutex::new(commands::RequestState::new())))
        .invoke_handler(tauri::generate_handler![commands::send_tcp_request, commands::cancel_tcp_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
