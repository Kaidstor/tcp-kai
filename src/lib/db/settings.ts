import { BaseRepository, query } from './index';
import type { Setting } from './types';

export class SettingsRepository extends BaseRepository<Setting> {
  constructor() {
    super('settings');
  }

  // Получение значения настройки
  async get(key: string): Promise<string | null> {
    const setting = await query()
      .table('settings')
      .select('settings.value')
      .where('settings.key', key)
      .first<{ value: string | null }>();
    
    return setting ? setting.value : null;
  }

  // Получение значения настройки как число
  async getAsNumber(key: string): Promise<number | null> {
    const value = await this.get(key);
    return value ? parseInt(value) : null;
  }

  // Получение значения настройки как булево
  async getAsBoolean(key: string): Promise<boolean | null> {
    const value = await this.get(key);
    if (value === null) return null;
    return value.toLowerCase() === 'true' || value === '1';
  }

  // Получение значения настройки как JSON
  async getAsJson<T = any>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  // Обновление значения настройки
  async updateSetting(key: string, value: string | number | boolean | object | null): Promise<void> {
    let stringValue: string | null;
    
    if (value === null) {
      stringValue = null;
    } else if (typeof value === 'object') {
      stringValue = JSON.stringify(value);
    } else {
      stringValue = String(value);
    }

    const { raw } = await import('./index');
    try {
      await raw(
        'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?;',
        [stringValue, key]
      );
    } catch (error) {
      console.error('Error updating setting:', error);
      console.error('Key:', key);
      console.error('Value:', value);
      throw error;
    }
  }

  // Получение всех настроек
  async getAll(): Promise<Setting[]> {
    return await query()
      .table('settings')
      .get<Setting>();
  }

  // Получение настроек по префиксу ключа
  async getByPrefix(prefix: string): Promise<Setting[]> {
    return await query()
      .table('settings')
      .where('settings.key', `${prefix}%`, 'LIKE')
      .get<Setting>();
  }

  // Создание новой настройки (если она не существует)
  async createIfNotExists(key: string, defaultValue: string | number | boolean | object): Promise<void> {
    const existing = await this.get(key);
    if (existing === null) {
      const { raw } = await import('./index');
      let stringValue: string;
      
      if (typeof defaultValue === 'object') {
        stringValue = JSON.stringify(defaultValue);
      } else {
        stringValue = String(defaultValue);
      }

      await raw(
        'INSERT INTO settings (key, value) VALUES (?, ?);',
        [key, stringValue]
      );
    }
  }

  // Удаление настройки
  async remove(key: string): Promise<void> {
    const { raw } = await import('./index');
    await raw('DELETE FROM settings WHERE key = ?;', [key]);
  }

  // Получение настроек как объект (ключ-значение)
  async getAllAsObject(): Promise<Record<string, string | null>> {
    const settings = await this.getAll();
    const result: Record<string, string | null> = {};
    
    for (const setting of settings) {
      result[setting.key] = setting.value;
    }
    
    return result;
  }

  // Массовое обновление настроек
  async updateMany(settings: Record<string, string | number | boolean | object | null>): Promise<void> {
    const { raw } = await import('./index');
    
    for (const [key, value] of Object.entries(settings)) {
      await this.updateSetting(key, value);
    }
  }

  // Сброс настройки к значению по умолчанию
  async reset(key: string, defaultValue: string | number | boolean | object): Promise<void> {
    await this.updateSetting(key, defaultValue);
  }

  // Проверка существования настройки
  async exists(key: string): Promise<boolean> {
    const setting = await query()
      .table('settings')
      .select('settings.id')
      .where('settings.key', key)
      .first<{ id: number }>();
    
    return setting !== null;
  }
}

// Экспорт экземпляра репозитория
export const settingsRepo = new SettingsRepository(); 