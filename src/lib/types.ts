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
  /** Frecency score driving sidebar order; halves per week idle (see decayedWeight). */
  weight: number | null;
  /** Момент последней отправки (ms epoch); null — распад ещё не начался. */
  last_used_at: number | null;
  /** Event-паттерн (@EventPattern): кадр без id, ответ не ожидается. 0/1. */
  emit: number;
}

export interface HistoryEntry {
  id: number;
  request_id: number;
  sent: string;
  received: string;
  timestamp: string;
  /** Round-trip duration in ms; null for rows written before v3. */
  execution_time: number | null;
  /** 1 — обмен удался; 0 — ошибка (пишется с v8, раньше ошибок не было). */
  ok: number;
  /** Контекст на момент отправки (v8); null у старых записей. */
  cmd: string | null;
  url: string | null;
  pack: string | null;
}

/** History row without the payloads — the dropdown only needs these. */
export type HistoryListItem = Pick<
  HistoryEntry,
  "id" | "timestamp" | "execution_time" | "ok" | "pack"
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
  /** Лимит ожидания ответа, сек; 0 — без лимита. undefined → 60. */
  timeout_secs?: number;
  /** Сколько записей истории хранить на запрос; 0 — без лимита. undefined → 200. */
  history_limit?: number;
  /** Ориентация сплита запрос/ответ. */
  layout?: "horizontal" | "vertical";
}

export const DEFAULT_TIMEOUT_SECS = 60;
export const DEFAULT_HISTORY_LIMIT = 200;

/** ApiResponse from the Rust `send_tcp_request` command. */
export interface ApiResponse {
  ok: boolean;
  message: string;
}

/** Группа cmd-значений из Rust-парсера контрактов (`parse_contract`). */
export interface ContractGroup {
  container: string;
  /** Контейнер похож на реестр cmd (имя содержит cmd/pattern). */
  is_cmd: boolean;
  cmds: ContractCmd[];
  /** Значения-ссылки (`KEY: OtherCmd.KEY`), не разрешившиеся внутри файла —
   *  их литералы живут в импортируемых файлах. */
  refs: { key: string; target: string }[];
}

export interface ContractCmd {
  key: string;
  value: string;
  deprecated: boolean;
}
