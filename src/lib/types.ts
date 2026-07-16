// Row shapes of the SQLite tables (see src-tauri/src/lib.rs for the
// migrations that own the schema) plus the few UI-side view types.

export interface Collection {
  id: number;
  name: string;
  /** Env pack applied to this collection; null = no variables. */
  pack_id: number | null;
}

export interface RequestItem {
  id: number;
  collection_id: number;
  name: string;
  url: string;
  cmd: string;
  body: string;
  /** Usage counter driving sidebar order; decays on every send. */
  weight: number | null;
}

export interface HistoryEntry {
  id: number;
  request_id: number;
  sent: string;
  received: string;
  timestamp: string;
  /** Round-trip duration in ms; null for rows written before v3. */
  execution_time: number | null;
}

/** History row without the payloads — the dropdown only needs these. */
export type HistoryListItem = Pick<
  HistoryEntry,
  "id" | "timestamp" | "execution_time"
>;

export interface EnvVar {
  key: string;
  value: string;
}

export interface EnvPack {
  id: number;
  name: string;
  vars: EnvVar[];
  /** null = global pack, usable from any collection. */
  collection_id: number | null;
}

/** What the app reads/writes in the `settings` key-value table. */
export interface AppSettings {
  theme?: string;
}

/** ApiResponse from the Rust `send_tcp_request` command. */
export interface ApiResponse {
  ok: boolean;
  message: string;
}
