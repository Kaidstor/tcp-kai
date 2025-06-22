// Базовый репозиторий с CRUD операциями
import { sq, raw, ensureDb } from '../schema-query-builder';

export abstract class BaseSchemaRepository<T extends { id: number }, TNew> {
  constructor(protected tableName: keyof typeof import('../schema').schema) {}

  // Создание записи
  async create(data: TNew): Promise<number> {
    await ensureDb();
    const fields = Object.keys(data as any).join(', ');
    const placeholders = Object.keys(data as any).map(() => '?').join(', ');
    const values = Object.values(data as any);
    
    const sql = `INSERT INTO ${this.tableName} (${fields}) VALUES (${placeholders});`;
    const result = await raw(sql, values);
    
    if (result.lastInsertId === undefined || result.lastInsertId === null) {
      throw new Error(`Failed to get last insert ID for ${this.tableName}.`);
    }
    return result.lastInsertId;
  }

  // Обновление записи
  async update(id: number, data: Partial<TNew>): Promise<void> {
    await ensureDb();
    const fields = Object.keys(data as any).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(data as any), id];
    
    const sql = `UPDATE ${this.tableName} SET ${fields} WHERE id = ?;`;
    await raw(sql, values);
  }

  // Удаление записи
  async delete(id: number): Promise<void> {
    await ensureDb();
    await raw(`DELETE FROM ${this.tableName} WHERE id = ?;`, [id]);
  }

  // Получение записи по ID
  async findById(id: number): Promise<T | null> {
    const result = await sq()
      .from(this.tableName)
      .where(`${this.tableName}.id`, id)
      .first();
    return result as T | null;
  }

  // Получение всех записей
  async findAll(): Promise<T[]> {
    const result = await sq()
      .from(this.tableName)
      .get() as any;
    return result as T[];
  }
} 