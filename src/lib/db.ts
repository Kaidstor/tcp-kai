import Database from '@tauri-apps/plugin-sql';
import type { Collection, EnvPack, HistoryEntry } from './types';

let db: Database;

async function ensureDb() {
  if (!db) {
    db = await Database.load('sqlite:app.db');
  }
}

// Collections
export async function getCollections(): Promise<Collection[]> {
  await ensureDb();
  return await db.select('SELECT id, name, pack_id FROM collections;');
}
export async function addCollection(name: string): Promise<number> {
  await ensureDb();
  await db.execute('INSERT INTO collections (name) VALUES (?);', [name]);

  const idResult = await db.select<{id: number}[]>('SELECT last_insert_rowid() as id;');
  return idResult[0].id;
}

export async function deleteCollection(id: number): Promise<void> {
  await ensureDb();
  await db.execute('DELETE FROM collections WHERE id = ?;', [id]);
}

// Requests
export async function getRequests(collectionId: number): Promise<any[]> {
  await ensureDb();
  return await db.select(
    'SELECT id, name, url, cmd, body FROM requests WHERE collection_id = ?;',
    [collectionId]
  );
}
export async function addRequest(collectionId: number, name: string, url: string, cmd: string, body: string): Promise<number> {
  await ensureDb();
  await db.execute(
    'INSERT INTO requests (collection_id, name, url, cmd, body) VALUES (?, ?, ?, ?, ?);',
    [collectionId, name, url, cmd, body]
  );
  // Get the last inserted ID
  const idResult = await db.select<{id: number}[]>('SELECT last_insert_rowid() as id;');
  return idResult[0].id;
}
export async function updateRequest({requestId, name, url, cmd, body}: {requestId: number, name: string, url: string, cmd: string, body: string}): Promise<void> {
  await ensureDb();
  await db.execute(
    'UPDATE requests SET name = ?, url = ?, cmd = ?, body = ? WHERE id = ?;',
    [name, url, cmd, body, requestId]
  );
}

// Удаление запроса (и связанной истории благодаря CASCADE)
export async function deleteRequest(requestId: number): Promise<void> {
  await ensureDb();
  await db.execute('DELETE FROM requests WHERE id = ?;', [requestId]);
}

// History
export async function getHistory(requestId: number): Promise<HistoryEntry[]> {
  await ensureDb();
  return await db.select(
    'SELECT id, sent, received, timestamp FROM history WHERE request_id = ? ORDER BY timestamp DESC;',
    [requestId]
  );
}

// Получение списка истории без полных данных запросов и ответов
export async function getHistoryList(requestId: number): Promise<Pick<HistoryEntry, 'id' | 'timestamp' | 'execution_time'>[]> {
  await ensureDb();
  return await db.select(
    'SELECT id, timestamp, execution_time FROM history WHERE request_id = ? ORDER BY timestamp DESC;',
    [requestId]
  );
}

// Получение конкретной записи истории по ID
export async function getHistoryItem(historyId: number): Promise<HistoryEntry | null> {
  await ensureDb();
  const items: HistoryEntry[] = await db.select(
    'SELECT * FROM history WHERE id = ?;',
    [historyId]
  );
  return items.length > 0 ? items[0] : null;
}

export async function addHistory(requestId: number, sent: string, received: string, executionTime?: number): Promise<number> {
  await ensureDb();
  await db.execute(
    'INSERT INTO history (request_id, sent, received, execution_time) VALUES (?, ?, ?, ?);',
    [requestId, sent, received, executionTime]
  );
  
  // Получаем ID вставленной записи
  const idResult = await db.select<{id: number}[]>('SELECT last_insert_rowid() as id;');
  return idResult[0].id;
}

// Delete a history entry
export async function deleteHistory(id: number): Promise<void> {
  await ensureDb();
  await db.execute('DELETE FROM history WHERE id = ?;', [id]);
}

// Packs of environment variables
export async function getEnvPacks(): Promise<EnvPack[]> {
  await ensureDb();
  const rows: { id: number; name: string; vars: string }[] = await db.select(
    'SELECT id, name, vars FROM env_packs;',
    [],
  );
  return rows.map(({ id, name, vars }) => ({
    id,
    name,
    vars: JSON.parse(vars),
  }));
}

export async function addEnvPack(
  name: string,
  vars: { key: string; value: string }[] = [],
): Promise<number> {
  await ensureDb();
  await db.execute(
    'INSERT INTO env_packs (name, vars) VALUES (?, ?);',
    [name, JSON.stringify(vars)],
  );
  
  // Get the last inserted ID
  const idResult = await db.select<{id: number}[]>('SELECT last_insert_rowid() as id;');
  return idResult[0].id;
}

export async function deleteEnvPack(id: number): Promise<void> {
  await ensureDb();
  await db.execute('DELETE FROM env_packs WHERE id = ?;', [id]);
}

// Fetch a single pack by ID
export async function getEnvPack(
  packId: number,
): Promise<EnvPack | null> {
  await ensureDb();
  const rows: { id: number; name: string; vars: string }[] = await db.select(
    'SELECT id, name, vars FROM env_packs WHERE id = ?;',
    [packId],
  );
  if (rows.length === 0) return null;
  const { id, name, vars } = rows[0];
  return { id, name, vars: JSON.parse(vars) };
}

// Update the vars JSON of an existing pack
export async function updateEnvPack(
  packId: number,
  vars: { key: string; value: string }[],
): Promise<void> {
  await ensureDb();
  await db.execute(
    'UPDATE env_packs SET vars = ? WHERE id = ?;',
    [JSON.stringify(vars), packId],
  );
}

// Update the name of an existing pack
export async function updateEnvPackName(
  packId: number,
  name: string,
): Promise<void> {
  await ensureDb();
  await db.execute(
    'UPDATE env_packs SET name = ? WHERE id = ?;',
    [name, packId],
  );
}

// Update the pack_id on a collection
export async function updateCollectionPack(collectionId: number, packId: number | null): Promise<void> {
  await ensureDb();
  await db.execute('UPDATE collections SET pack_id = ? WHERE id = ?;', [packId, collectionId]);
}

// Настройки приложения
export async function getSetting(key: string): Promise<string | null> {
  await ensureDb();
  const results = await db.select<{ value: string | null }[]>(
    'SELECT value FROM settings WHERE key = ?;',
    [key]
  );
  
  return results.length > 0 ? results[0].value : null;
}

export async function updateSetting(key: string, value: string | number | null): Promise<void> {
  await ensureDb();
  await db.execute(
    'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?;',
    [value === null ? null : String(value), key]
  );
} 