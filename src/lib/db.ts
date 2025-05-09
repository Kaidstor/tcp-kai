import Database from '@tauri-apps/plugin-sql';
import type { Collection, EnvPack, EnvPackRow, HistoryEntry } from './types';

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
  const result = await db.execute('INSERT INTO collections (name) VALUES (?);', [name]);

  if (result.lastInsertId === undefined || result.lastInsertId === null) {
    throw new Error("Failed to get last insert ID for collection.");
  }
  return result.lastInsertId;
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
  const result = await db.execute(
    'INSERT INTO requests (collection_id, name, url, cmd, body) VALUES (?, ?, ?, ?, ?);',
    [collectionId, name, url, cmd, body]
  );
  // Get the last inserted ID
  if (result.lastInsertId === undefined || result.lastInsertId === null) {
    throw new Error("Failed to get last insert ID for request.");
  }
  return result.lastInsertId;
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
  const result = await db.execute(
    'INSERT INTO history (request_id, sent, received, execution_time) VALUES (?, ?, ?, ?);',
    [requestId, sent, received, executionTime]
  );
  
  // Получаем ID вставленной записи
  if (result.lastInsertId === undefined || result.lastInsertId === null) {
    throw new Error("Failed to get last insert ID for history.");
  }
  return result.lastInsertId;
}

// Delete a history entry
export async function deleteHistory(id: number): Promise<void> {
  await ensureDb();
  await db.execute('DELETE FROM history WHERE id = ?;', [id]);
}

// Packs of environment variables
export async function getEnvPacks(): Promise<EnvPack[]> {
  await ensureDb();
  const rows: EnvPackRow[] = await db.select(
    'SELECT id, name, vars, collection_id FROM env_packs;',
    [],
  );
  
  return rows.map(({ id, name, vars, collection_id }) => ({
    id,
    name,
    vars: vars ? JSON.parse(vars) : null,
    collection_id,
  }));
}

export async function addEnvPack(
  name: string,
  vars: { key: string; value: string }[] = [],
  collectionId: number | null = null,
): Promise<number> {
  await ensureDb();
  const result = await db.execute(
    'INSERT INTO env_packs (name, vars, collection_id) VALUES (?, ?, ?);',
    [name, JSON.stringify(vars), collectionId],
  );
  
  // Use the lastInsertId from the execute result
  if (result.lastInsertId === undefined || result.lastInsertId === null) {
    throw new Error("Failed to get last insert ID for env pack.");
  }
  return result.lastInsertId;
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
  const rows: EnvPack[] = await db.select(
    'SELECT id, name, vars, collection_id FROM env_packs WHERE id = ?;',
    [packId],
  );
  if (rows.length === 0) return null;

  const pack = rows[0];
  
  return { id: pack.id, name: pack.name, vars: JSON.parse(pack.vars as unknown as string), collection_id: pack.collection_id };
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

// Update the collection_id of an existing pack
export async function updateEnvPackCollectionId(
  packId: number,
  collectionId: number | null,
): Promise<void> {
  await ensureDb();
  await db.execute(
    'UPDATE env_packs SET collection_id = ? WHERE id = ?;',
    [collectionId, packId],
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

export async function getSettingAsNumber(key: string): Promise<number | null> {
  const value = await getSetting(key);
  return value ? parseInt(value) : null;
}

export async function updateSetting(key: string, value: string | number | null): Promise<void> {
  try {
  await ensureDb();
  await db.execute(
      'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?;',
      [value === null ? null : String(value), key]
    );
  } catch (error) {
    console.error('Error updating setting:', error);
    console.error('Key:', key);
    console.error('Value:', value);

    throw error;
  }
}
