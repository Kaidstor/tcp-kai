// Collections Repository
import { sq, sql } from '../schema-query-builder';
import { BaseSchemaRepository } from './base';
import type { Collection, NewCollection } from '../schema';

export class SchemaCollectionsRepository extends BaseSchemaRepository<Collection, NewCollection> {
  constructor() {
    super('collections');
  }

  // Получение всех коллекций
  async getAll() {
    return await sq()
      .from('collections')
      .get(); 
  }

  // Создание новой коллекции
  async add(name: string): Promise<number> {
    return await this.create({ name });
  }

  async rename(collectionId: number, name: string): Promise<void> {
    await this.update(collectionId, { name });
  }

  // Обновление связи коллекции с пакетом переменных окружения
  async updatePack(collectionId: number, packId: number | null): Promise<void> {
    await this.update(collectionId, { pack_id: packId });
  }

  // Получение коллекций с определенным pack_id
  async getByPackId(packId: number) {
    return await sq()
      .from('collections')
      .where('collections.pack_id', packId)
      .get(); 
  }

  // Получение коллекций без привязки к пакету
  async getWithoutPack() {
    return await sq()
      .from('collections')
      .whereNull('collections.pack_id')
      .get(); 
  }

  // Получение коллекций с детальной статистикой
  async getWithStats() {
    return await sq()
      .from('collections')
      .select({
        id: 'collections.id',
        name: 'collections.name',
        packId: 'collections.pack_id',
        requestCount: sql<number>`(
          SELECT COUNT(*) 
          FROM requests 
          WHERE collection_id = collections.id
        )`,
        envPackCount: sql<number>`(
          SELECT COUNT(*) 
          FROM env_packs 
          WHERE collection_id = collections.id
        )`,
        historyCount: sql<number>`(
          SELECT COUNT(*) 
          FROM history 
          WHERE request_id IN (
            SELECT id FROM requests WHERE collection_id = collections.id
          )
        )`,
        lastActivity: sql<string | null>`(
          SELECT MAX(timestamp) 
          FROM history 
          WHERE request_id IN (
            SELECT id FROM requests WHERE collection_id = collections.id
          )
        )`
      })
      .get();
  }

  // Получение общей статистики коллекций
  async getOverallStats() {
    const result = await sq()
      .from('collections')
      .select({
        totalCollections: sql<number>`COUNT(*)`,
        collectionsWithPacks: sql<number>`COUNT(pack_id)`,
        collectionsWithoutPacks: sql<number>`COUNT(CASE WHEN pack_id IS NULL THEN 1 END)`,
        avgRequestsPerCollection: sql<number>`(
          SELECT AVG(request_count) FROM (
            SELECT COUNT(*) as request_count 
            FROM requests 
            GROUP BY collection_id
          )
        )`,
        totalRequests: sql<number>`(
          SELECT COUNT(*) FROM requests
        )`,
        totalEnvPacks: sql<number>`(
          SELECT COUNT(*) FROM env_packs WHERE collection_id IS NOT NULL
        )`
      })
      .get();
      
    return result[0];
  }
}

// Экспорт экземпляра репозитория
export const collectionsRepo = new SchemaCollectionsRepository(); 