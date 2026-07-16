// SQLite access layer. The schema itself is owned by the Rust migrations in
// src-tauri/src/lib.rs — this module is only the typed query surface the app
// actually uses, grouped by table.
import Database from "@tauri-apps/plugin-sql";
import type {
  Collection,
  EnvPack,
  EnvVar,
  HistoryEntry,
  HistoryListItem,
  RequestItem,
} from "./types";

let handle: Database | null = null;
let loading: Promise<Database> | null = null;

/** Single shared connection; concurrent first-callers await the same load. */
async function conn(): Promise<Database> {
  if (handle) return handle;
  if (!loading) {
    loading = Database.load("sqlite:app.db").then((db) => (handle = db));
  }
  return loading;
}

const select = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await conn()).select<T[]>(sql, params);

const exec = async (sql: string, params: unknown[] = []) =>
  (await conn()).execute(sql, params);

/** INSERT returning the new row id. */
async function insert(sql: string, params: unknown[]): Promise<number> {
  const res = await exec(sql, params);
  if (res.lastInsertId == null) {
    throw new Error(`INSERT returned no row id: ${sql}`);
  }
  return res.lastInsertId;
}

/** Row shape of `env_packs`; `vars` is a JSON array of {key,value}. */
interface EnvPackRow {
  id: number;
  name: string;
  vars: string;
  collection_id: number | null;
}

function toEnvPack(row: EnvPackRow): EnvPack {
  let vars: EnvVar[] = [];
  try {
    const parsed: unknown = JSON.parse(row.vars);
    // a hand-edited/legacy row must not take the whole pack list down
    if (Array.isArray(parsed)) vars = parsed as EnvVar[];
  } catch {
    vars = [];
  }
  return { id: row.id, name: row.name, vars, collection_id: row.collection_id };
}

export const db = {
  collections: {
    all: () =>
      select<Collection>(
        "SELECT id, name, pack_id FROM collections ORDER BY name ASC",
      ),

    add: (name: string) =>
      insert("INSERT INTO collections (name) VALUES (?)", [name]),

    rename: (id: number, name: string) =>
      exec("UPDATE collections SET name = ? WHERE id = ?", [name, id]),

    /** Points the collection at an env pack (null detaches it). */
    setPack: (id: number, packId: number | null) =>
      exec("UPDATE collections SET pack_id = ? WHERE id = ?", [packId, id]),

    /** Requests and their history go too — ON DELETE CASCADE handles it. */
    remove: (id: number) => exec("DELETE FROM collections WHERE id = ?", [id]),
  },

  requests: {
    /** Most-used first; `weight` is maintained by bumpWeight/decayWeights. */
    byCollection: (collectionId: number) =>
      select<RequestItem>(
        `SELECT id, collection_id, name, url, cmd, body, weight, emit
           FROM requests
          WHERE collection_id = ?
          ORDER BY weight DESC, name ASC`,
        [collectionId],
      ),

    add: (req: Omit<RequestItem, "id" | "weight">) =>
      insert(
        `INSERT INTO requests (collection_id, name, url, cmd, body, emit)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.collection_id, req.name, req.url, req.cmd, req.body, req.emit],
      ),

    update: (
      id: number,
      data: Pick<RequestItem, "name" | "url" | "cmd" | "body" | "emit">,
    ) =>
      exec(
        "UPDATE requests SET name = ?, url = ?, cmd = ?, body = ?, emit = ? WHERE id = ?",
        [data.name, data.url, data.cmd, data.body, data.emit, id],
      ),

    rename: (id: number, name: string) =>
      exec("UPDATE requests SET name = ? WHERE id = ?", [name, id]),

    remove: (id: number) => exec("DELETE FROM requests WHERE id = ?", [id]),

    /** Sent request climbs the sidebar. */
    bumpWeight: (id: number) =>
      exec(
        "UPDATE requests SET weight = COALESCE(weight, 0) + 1 WHERE id = ?",
        [id],
      ),

    /** −10% on every send, so yesterday's favourites drift back down.
     *  Integer division keeps it portable across SQLite builds. */
    decayWeights: () =>
      exec("UPDATE requests SET weight = (weight * 9) / 10 WHERE weight > 0"),
  },

  history: {
    /** Payload-free listing for the history dropdown. */
    listByRequest: (requestId: number) =>
      select<HistoryListItem>(
        `SELECT id, timestamp, execution_time, ok, pack
           FROM history
          WHERE request_id = ?
          ORDER BY timestamp DESC`,
        [requestId],
      ),

    byId: async (id: number): Promise<HistoryEntry | null> =>
      (
        await select<HistoryEntry>(
          `SELECT id, request_id, sent, received, timestamp, execution_time,
                  ok, cmd, url, pack
             FROM history WHERE id = ?`,
          [id],
        )
      )[0] ?? null,

    /** Most recent entry — restores the editors when a request is opened. */
    latestByRequest: async (requestId: number): Promise<HistoryEntry | null> =>
      (
        await select<HistoryEntry>(
          `SELECT id, request_id, sent, received, timestamp, execution_time,
                  ok, cmd, url, pack
             FROM history
            WHERE request_id = ?
            ORDER BY timestamp DESC
            LIMIT 1`,
          [requestId],
        )
      )[0] ?? null,

    add: (entry: Omit<HistoryEntry, "id" | "timestamp">) =>
      insert(
        `INSERT INTO history (request_id, sent, received, timestamp, execution_time,
                              ok, cmd, url, pack)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.request_id,
          entry.sent,
          entry.received,
          new Date().toISOString(),
          entry.execution_time,
          entry.ok,
          entry.cmd,
          entry.url,
          entry.pack,
        ],
      ),

    /** Хвост истории сверх лимита; 0 — хранить всё. Возвращает срезанные id,
     *  чтобы стор мог убрать их из открытого списка без перезагрузки. */
    prune: async (requestId: number, keep: number): Promise<number[]> => {
      if (keep <= 0) return [];
      const stale = await select<{ id: number }>(
        `SELECT id FROM history
          WHERE request_id = ?1
            AND id NOT IN (
              SELECT id FROM history
               WHERE request_id = ?1
               ORDER BY timestamp DESC, id DESC
               LIMIT ?2
            )`,
        [requestId, keep],
      );
      if (stale.length === 0) return [];
      await exec(
        `DELETE FROM history WHERE id IN (${stale.map(() => "?").join(",")})`,
        stale.map((r) => r.id),
      );
      return stale.map((r) => r.id);
    },

    remove: (id: number) => exec("DELETE FROM history WHERE id = ?", [id]),
  },

  envPacks: {
    all: async (): Promise<EnvPack[]> =>
      (
        await select<EnvPackRow>(
          "SELECT id, name, vars, collection_id FROM env_packs ORDER BY name ASC",
        )
      ).map(toEnvPack),

    add: (name: string, vars: EnvVar[], collectionId: number | null) =>
      insert("INSERT INTO env_packs (name, vars, collection_id) VALUES (?, ?, ?)", [
        name,
        JSON.stringify(vars),
        collectionId,
      ]),

    setVars: (id: number, vars: EnvVar[]) =>
      exec("UPDATE env_packs SET vars = ? WHERE id = ?", [
        JSON.stringify(vars),
        id,
      ]),

    rename: (id: number, name: string) =>
      exec("UPDATE env_packs SET name = ? WHERE id = ?", [name, id]),

    /** null = global pack; otherwise scoped to that collection. */
    setCollection: (id: number, collectionId: number | null) =>
      exec("UPDATE env_packs SET collection_id = ? WHERE id = ?", [
        collectionId,
        id,
      ]),

    remove: (id: number) => exec("DELETE FROM env_packs WHERE id = ?", [id]),
  },

  settings: {
    get: async (key: string): Promise<string | null> =>
      (
        await select<{ value: string | null }>(
          "SELECT value FROM settings WHERE key = ?",
          [key],
        )
      )[0]?.value ?? null,

    getNumber: async (key: string): Promise<number | null> => {
      const raw = await db.settings.get(key);
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },

    /** Upsert — `key` is UNIQUE, so the conflict clause covers both cases.
     *  (The table has no created_at column; only updated_at.) */
    set: (key: string, value: string | number | null) =>
      exec(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                        updated_at = excluded.updated_at`,
        [key, value === null ? null : String(value), new Date().toISOString()],
      ),
  },
};
