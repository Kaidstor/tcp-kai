import { BaseRepository, query } from './index';
import type { Collection } from './types';

export class CollectionsRepository extends BaseRepository<Collection> {
  constructor() {
    super('collections');
  }

  // Получение всех коллекций
  async getAll(): Promise<Collection[]> {
    return await query()
      .table('collections')
      .select('collections.id', 'collections.name', 'collections.pack_id')
      .get<Collection>();
  }

  // Создание новой коллекции
  async add(name: string): Promise<number> {
    return await this.create({ name });
  }

  // Обновление связи коллекции с пакетом переменных окружения
  async updatePack(collectionId: number, packId: number | null): Promise<void> {
    await this.update(collectionId, { pack_id: packId });
  }

  // Получение коллекций с определенным pack_id
  async getByPackId(packId: number): Promise<Collection[]> {
    return await query()
      .table('collections')
      .where('collections.pack_id', packId)
      .get<Collection>();
  }

  // Получение коллекций без привязки к пакету
  async getWithoutPack(): Promise<Collection[]> {
    return await query()
      .table('collections')
      .whereNull('collections.pack_id')
      .get<Collection>();
  }
}

// Экспорт экземпляра репозитория
export const collectionsRepo = new CollectionsRepository(); 