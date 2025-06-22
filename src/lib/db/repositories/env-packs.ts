// Environment Packs Repository
import { sq, sql } from '../schema-query-builder';
import { BaseSchemaRepository } from './base';
import type { EnvPackRow, NewEnvPack, EnvVar } from '../schema';
import { envPackRowToPack as convertRowToPack } from '../schema';

export class SchemaEnvPacksRepository extends BaseSchemaRepository<EnvPackRow, NewEnvPack> {
  constructor() {
    super('env_packs');
  }

  // Получение всех пакетов
  async getAll() {
    const rows = await sq()
      .from('env_packs')
      .get();
    return rows.map(convertRowToPack);
  }

  // Получение пакета по ID
  async getById(packId: number)  {
    const row = await this.findById(packId);
    return row ? convertRowToPack(row) : null;
  }

  // Создание нового пакета
  async add(name: string, vars: EnvVar[], collectionId?: number | null) {
    return await this.create({
      name,
      vars: JSON.stringify(vars),
      collection_id: collectionId || null
    });
  }

  // Обновление переменных пакета
  async updateVars(packId: number, vars: EnvVar[]) {
    await this.update(packId, { vars: JSON.stringify(vars) });
  }

  // Обновление названия пакета
  async updateName(packId: number, name: string) {
    await this.update(packId, { name });
  }

  // Обновление привязки к коллекции
  async updateCollectionId(packId: number, collectionId: number | null) {
    await this.update(packId, { collection_id: collectionId });
  }

  // Получение глобальных пакетов (без привязки к коллекции)
  async getGlobal() {
    const rows = await sq()
      .from('env_packs')
      .whereNull('env_packs.collection_id')
      .get();
    return rows.map(convertRowToPack);
  }

  // Получение пакетов для определённой коллекции
  async getByCollectionId(collectionId: number) {
    const rows = await sq()
      .from('env_packs')
      .where('env_packs.collection_id', collectionId)
      .get();
    return rows.map(convertRowToPack);
  }

  // Дублирование пакета
  async duplicate(packId: number, newName: string) {
    const original = await this.findById(packId);
    if (!original) {
      throw new Error('Pack not found');
    }
    
    return await this.create({
      name: newName,
      vars: original.vars,
      collection_id: original.collection_id
    });
  }

  // Получение статистики по переменным
  async getVariableStats() {
    // Используем новые типизированные агрегаты!
    const result = await sq()
      .from('env_packs')
      .select({
        total_packs: sql<number>`COUNT(*)`,
        collection_packs: sql<number>`COUNT(collection_id)`,
        global_packs: sql<number>`COUNT(CASE WHEN collection_id IS NULL THEN 1 END)`
      })
      .get();
    
    return result[0] || {
      total_packs: 0,
      collection_packs: 0,
      global_packs: 0
    };
  }
}

// Экспорт экземпляра репозитория
export const envPacksRepo = new SchemaEnvPacksRepository(); 