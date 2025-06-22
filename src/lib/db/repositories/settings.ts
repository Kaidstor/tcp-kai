// Settings Repository
import { sq, sql } from '../schema-query-builder';
import { BaseSchemaRepository } from './base';
import type { Setting, NewSetting } from '../schema';

export class SchemaSettingsRepository extends BaseSchemaRepository<Setting, NewSetting> {
  constructor() {
    super('settings');
  }

  // Получение значения настройки
  async get(key: string) {
    const result = await sq()
      .from('settings')
      .select(['settings.value'])
      .where('settings.key', key)
      .first();
    
    return result?.value || null;
  }

  // Обновление или создание настройки
  async set(key: string, value: any) {
    const existing = await sq()
      .from('settings')
      .where('settings.key', key)
      .first();

    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const timestamp = new Date().toISOString();

    if (existing) {
      await this.update(existing.id, { 
        value: stringValue, 
        updated_at: timestamp 
      });
    } else {
      await this.create({
        key,
        value: stringValue,
        created_at: timestamp,
        updated_at: timestamp
      });
    }
  }

  // Обновление настройки (алиас для set)
  async updateSetting(key: string, value: any) {
    return await this.set(key, value);
  }

  // Получение как число
  async getAsNumber(key: string) {
    const value = await this.get(key);
    return value ? parseFloat(value) : null;
  }

  // Получение как булево
  async getAsBoolean(key: string) {
    const value = await this.get(key);
    return value === 'true';
  }

  // Получение как JSON
  async getAsJson<T>(key: string) {
    const value = await this.get(key);
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  // Проверка существования настройки
  async exists(key: string) {
    const result = await sq()
      .from('settings')
      .select(['settings.id'])
      .where('settings.key', key)
      .first();
    
    return !!result;
  }

  // Удаление настройки по ключу
  async deleteByKey(key: string) {
    const setting = await sq()
      .from('settings')
      .where('settings.key', key)
      .first();
    
    if (setting) {
      await this.delete(setting.id);
    }
  }

  // Получение всех настроек
  async getAllSettings() {
    return await sq()
      .from('settings')
      .orderBy('settings.key', 'ASC')
      .get();
  }

  // Получение настроек по префиксу ключа
  async getByKeyPrefix(prefix: string) {
    return await sq()
      .from('settings')
      .where('settings.key', `${prefix}%`, 'LIKE')
      .orderBy('settings.key', 'ASC')
      .get();
  }
}

// Экспорт экземпляра репозитория
export const settingsRepo = new SchemaSettingsRepository(); 