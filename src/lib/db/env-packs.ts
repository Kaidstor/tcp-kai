import { BaseRepository, query } from './index';
import type { EnvPack, EnvPackRow } from './types';

export class EnvPacksRepository extends BaseRepository<EnvPackRow> {
  constructor() {
    super('env_packs');
  }

  // Получение всех пакетов переменных окружения
  async getAll(): Promise<EnvPack[]> {
    const rows = await query()
      .table('env_packs')
      .select('env_packs.id', 'env_packs.name', 'env_packs.vars', 'env_packs.collection_id')
      .get<EnvPackRow>();
    
    return rows.map(({ id, name, vars, collection_id }) => ({
      id,
      name,
      vars: vars ? JSON.parse(vars) : null,
      collection_id,
    }));
  }

  // Получение пакета по ID
  async getById(packId: number): Promise<EnvPack | null> {
    const row = await query()
      .table('env_packs')
      .where('env_packs.id', packId)
      .first<EnvPackRow>();
    
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      vars: row.vars ? JSON.parse(row.vars) : null,
      collection_id: row.collection_id,
    };
  }

  // Создание нового пакета переменных окружения
  async add(
    name: string,
    vars: { key: string; value: string }[] = [],
    collectionId: number | null = null,
  ): Promise<number> {
    return await this.create({
      name,
      vars: JSON.stringify(vars),
      collection_id: collectionId,
    });
  }

  // Обновление переменных пакета
  async updateVars(
    packId: number,
    vars: { key: string; value: string }[],
  ): Promise<void> {
    await this.update(packId, {
      vars: JSON.stringify(vars),
    });
  }

  // Обновление имени пакета
  async updateName(packId: number, name: string): Promise<void> {
    await this.update(packId, { name });
  }

  // Обновление привязки к коллекции
  async updateCollectionId(
    packId: number,
    collectionId: number | null,
  ): Promise<void> {
    await this.update(packId, { collection_id: collectionId });
  }

  // Получение пакетов для определенной коллекции
  async getByCollectionId(collectionId: number): Promise<EnvPack[]> {
    const rows = await query()
      .table('env_packs')
      .where('env_packs.collection_id', collectionId)
      .get<EnvPackRow>();
    
    return rows.map(({ id, name, vars, collection_id }) => ({
      id,
      name,
      vars: vars ? JSON.parse(vars) : null,
      collection_id,
    }));
  }

  // Получение глобальных пакетов (не привязанных к коллекции)
  async getGlobal(): Promise<EnvPack[]> {
    const rows = await query()
      .table('env_packs')
      .whereNull('env_packs.collection_id')
      .get<EnvPackRow>();
    
    return rows.map(({ id, name, vars, collection_id }) => ({
      id,
      name,
      vars: vars ? JSON.parse(vars) : null,
      collection_id,
    }));
  }

  // Поиск пакетов по имени
  async searchByName(searchTerm: string): Promise<EnvPack[]> {
    const rows = await query()
      .table('env_packs')
      .where('env_packs.name', `%${searchTerm}%`, 'LIKE')
      .get<EnvPackRow>();
    
    return rows.map(({ id, name, vars, collection_id }) => ({
      id,
      name,
      vars: vars ? JSON.parse(vars) : null,
      collection_id,
    }));
  }

  // Дублирование пакета
  async duplicate(packId: number, newName?: string): Promise<number> {
    const originalPack = await this.getById(packId);
    if (!originalPack) {
      throw new Error(`EnvPack with id ${packId} not found`);
    }

    const name = newName || `${originalPack.name} (Copy)`;
    return await this.add(name, originalPack.vars || [], originalPack.collection_id);
  }

  // Получение статистики использования переменных
  async getVariableStats(): Promise<Array<{ key: string; usage_count: number }>> {
    const { raw } = await import('./index');
    const packs = await this.getAll();
    
    const variableUsage = new Map<string, number>();
    
    for (const pack of packs) {
      if (pack.vars) {
        for (const variable of pack.vars) {
          const count = variableUsage.get(variable.key) || 0;
          variableUsage.set(variable.key, count + 1);
        }
      }
    }
    
    return Array.from(variableUsage.entries())
      .map(([key, usage_count]) => ({ key, usage_count }))
      .sort((a, b) => b.usage_count - a.usage_count);
  }
}

// Экспорт экземпляра репозитория
export const envPacksRepo = new EnvPacksRepository(); 