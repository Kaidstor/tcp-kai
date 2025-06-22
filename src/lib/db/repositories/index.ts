// Центральный экспорт всех schema-based репозиториев
export { BaseSchemaRepository } from './base';

// Экспорт классов репозиториев
export { SchemaCollectionsRepository } from './collections';
export { SchemaRequestsRepository } from './requests';
export { SchemaHistoryRepository } from './history';
export { SchemaEnvPacksRepository } from './env-packs';
export { SchemaSettingsRepository } from './settings';

// Экспорт экземпляров репозиториев
export { collectionsRepo } from './collections';
export { requestsRepo } from './requests';
export { historyRepo } from './history';
export { envPacksRepo } from './env-packs';
export { settingsRepo } from './settings';

// Экспорт утилит
export { sq, raw, col, ensureDb } from '../schema-query-builder';

// Импорт утилит из query builder
import { sq, raw, col, ensureDb } from '../schema-query-builder';

// Импорт экземпляров репозиториев
import { collectionsRepo } from './collections';
import { requestsRepo } from './requests';
import { historyRepo } from './history';
import { envPacksRepo } from './env-packs';
import { settingsRepo } from './settings';

// Объект со всеми schema-based репозиториями
export const schemaDb = {
  // Репозитории
  collections: collectionsRepo,
  requests: requestsRepo,
  history: historyRepo,
  envPacks: envPacksRepo,
  settings: settingsRepo,
  
  // Утилиты
  sq,
  raw,
  col,
  ensureDb,
} as const; 

// Алиас для совместимости
export const db = schemaDb; 