// Импорты репозиториев
import { collectionsRepo, CollectionsRepository } from './collections';
import { requestsRepo, RequestsRepository } from './requests';
import { historyRepo, HistoryRepository } from './history';
import { envPacksRepo, EnvPacksRepository } from './env-packs';
import { settingsRepo, SettingsRepository } from './settings';
import { query, raw, BaseRepository, QueryBuilder, ensureDb, column, col } from './index';

// Экспорт репозиториев
export { collectionsRepo, CollectionsRepository };
export { requestsRepo, RequestsRepository };
export { historyRepo, HistoryRepository };
export { envPacksRepo, EnvPacksRepository };
export { settingsRepo, SettingsRepository };

// Основные функции для работы с базой данных
export { query, raw, BaseRepository, QueryBuilder, ensureDb, column, col };

// Типы
export type * from './types';

// Объект со всеми репозиториями для удобного доступа
export const db = {
  collections: collectionsRepo,
  requests: requestsRepo,
  history: historyRepo,
  envPacks: envPacksRepo,
  settings: settingsRepo,
  
  // Утилиты
  query,
  raw,
  ensureDb,
  column,
  col,
} as const;

// Пример использования:
// import { db, col } from './database/repositories';
// 
// // Получение всех коллекций
// const collections = await db.collections.getAll();
// 
// // Создание новой коллекции
// const id = await db.collections.add('My Collection');
// 
// // Использование query builder
// const requests = await db.query()
//   .table('requests')
//   .where('requests.collection_id', 1)
//   .orderBy('requests.name')
//   .get();
// 
// // Запрос с алиасами
// const requestsWithAliases = await db.query()
//   .table('requests')
//   .leftJoin('collections', 'requests.collection_id = collections.id')
//   .select(
//     col('requests.name').as('request_title'),
//     col('collections.name').as('collection_title')
//   )
//   .get();
// 
// // Raw SQL запрос
// const result = await db.raw('SELECT COUNT(*) as count FROM collections'); 