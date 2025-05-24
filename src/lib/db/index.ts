import Database from '@tauri-apps/plugin-sql';
import type { 
  DatabaseSchema, 
  BaseTable, 
  Columns, 
  Flat,
  SelectResult,
  ColumnAlias,
  SelectColumns
} from './types';

let db: Database;

async function ensureDb() {
  if (!db) {
    db = await Database.load('sqlite:app.db');
  }
}

// Функция для создания алиасов
export function column<Tables extends { [tableName: string]: BaseTable }>(
  name: Columns<Tables>
): {
  as: (alias: string) => ColumnAlias;
} {
  return {
    as: (alias: string) => ({
      column: name,
      alias,
    })
  };
}

// Упрощенная функция для создания алиасов (без строгой типизации)
export function col(name: string): {
  as: (alias: string) => ColumnAlias;
} {
  return {
    as: (alias: string) => ({
      column: name,
      alias,
    })
  };
}

// Вспомогательная функция для обработки колонок с алиасами
function processColumn(col: SelectColumns<any>): string {
  if (typeof col === 'string') {
    return col;
  }
  if (typeof col === 'object' && 'column' in col && 'alias' in col) {
    return `${col.column} AS ${col.alias}`;
  }
  return col as string;
}

// Основной QueryBuilder класс
export class QueryBuilder<Tables extends { [tableName: string]: BaseTable } = {}> {
  private fields: string[] = [];
  private wheres: Array<{ column: string; value: any; operator: string }> = [];
  private orderByClause: string = '';
  private limitClause: number | null = null;
  private offsetClause: number | null = null;
  private tableName: string = '';
  private joinClauses: string[] = [];

  // Добавление таблицы в контекст
  table<N extends keyof DatabaseSchema>(name: N) {
    return new QueryBuilder<Tables & { [K in N]: DatabaseSchema[K] }>()
      .from(name as string);
  }

  // FROM clause
  from(table: string) {
    this.tableName = table;
    return this;
  }

  // SELECT clause  
  select(...columns: SelectColumns<Tables>[]): this {
    this.fields = columns.map(col => processColumn(col));
    return this;
  }

  // WHERE clauses
  where(column: string | Columns<Tables>, value: any, operator: string = '='): this {
    this.wheres.push({ column: column as string, value, operator });
    return this;
  }

  whereNot<K extends Columns<Tables>>(column: K, value: Flat<Tables>[K]): this {
    return this.where(column, value, '!=');
  }

  whereIn<K extends Columns<Tables>>(column: K, values: Flat<Tables>[K][]): this {
    this.wheres.push({ column, value: values, operator: 'IN' });
    return this;
  }

  whereNull<K extends Columns<Tables>>(column: K): this {
    this.wheres.push({ column, value: null, operator: 'IS NULL' });
    return this;
  }

  whereNotNull<K extends Columns<Tables>>(column: K): this {
    this.wheres.push({ column, value: null, operator: 'IS NOT NULL' });
    return this;
  }

  // ORDER BY clause
  orderBy<K extends Columns<Tables>>(column: K, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderByClause = `ORDER BY ${column} ${direction}`;
    return this;
  }

  // LIMIT and OFFSET
  limit(count: number): this {
    this.limitClause = count;
    return this;
  }

  offset(count: number): this {
    this.offsetClause = count;
    return this;
  }

  // JOIN operations
  join(table: string, condition: string): this {
    this.joinClauses.push(`JOIN ${table} ON ${condition}`);
    return this;
  }

  leftJoin(table: string, condition: string): this {
    this.joinClauses.push(`LEFT JOIN ${table} ON ${condition}`);
    return this;
  }

  // Выполнение SELECT запроса
  async get<T = any>(): Promise<SelectResult<T>> {
    await ensureDb();
    const sql = this.buildSelectQuery();
    const params = this.buildParams();
    return await db.select(sql, params) as SelectResult<T>;
  }

  // Получение первой записи
  async first<T = any>(): Promise<T | null> {
    const results = await this.limit(1).get<T>();
    return results.length > 0 ? results[0] : null;
  }

  // Построение SQL для SELECT
  private buildSelectQuery(): string {
    const fields = this.fields.length > 0 ? this.fields.join(', ') : '*';
    let sql = `SELECT ${fields} FROM ${this.tableName}`;
    
    if (this.joinClauses.length > 0) {
      sql += ' ' + this.joinClauses.join(' ');
    }
    
    if (this.wheres.length > 0) {
      sql += ' WHERE ' + this.wheres.map((w, i) => {
        if (w.operator === 'IN') {
          const placeholders = (w.value as any[]).map(() => '?').join(', ');
          return `${w.column} IN (${placeholders})`;
        } else if (w.operator === 'IS NULL' || w.operator === 'IS NOT NULL') {
          return `${w.column} ${w.operator}`;
        }
        return `${w.column} ${w.operator} ?`;
      }).join(' AND ');
    }
    
    if (this.orderByClause) {
      sql += ' ' + this.orderByClause;
    }
    
    if (this.limitClause !== null) {
      sql += ` LIMIT ${this.limitClause}`;
    }
    
    if (this.offsetClause !== null) {
      sql += ` OFFSET ${this.offsetClause}`;
    }
    
    return sql + ';';
  }

  // Построение параметров запроса
  private buildParams(): any[] {
    const params: any[] = [];
    
    for (const where of this.wheres) {
      if (where.operator === 'IN') {
        params.push(...(where.value as any[]));
      } else if (where.operator !== 'IS NULL' && where.operator !== 'IS NOT NULL') {
        params.push(where.value);
      }
    }
    
    return params;
  }
}

// Основная функция для создания билдера запросов
export function query() {
  return new QueryBuilder();
}

// Функция для выполнения raw SQL
export async function raw(sql: string, params?: any[]): Promise<any> {
  await ensureDb();
  return await db.execute(sql, params);
}

// Базовые CRUD операции
export class BaseRepository<T extends { id: number }> {
  constructor(protected tableName: string) {}

  // Создание записи
  async create(data: Omit<T, 'id'>): Promise<number> {
    await ensureDb();
    const fields = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const values = Object.values(data);
    
    const sql = `INSERT INTO ${this.tableName} (${fields}) VALUES (${placeholders});`;
    const result = await db.execute(sql, values);
    
    if (result.lastInsertId === undefined || result.lastInsertId === null) {
      throw new Error(`Failed to get last insert ID for ${this.tableName}.`);
    }
    return result.lastInsertId;
  }

  // Обновление записи
  async update(id: number, data: Partial<Omit<T, 'id'>>): Promise<void> {
    await ensureDb();
    const fields = Object.keys(data).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(data), id];
    
    const sql = `UPDATE ${this.tableName} SET ${fields} WHERE id = ?;`;
    await db.execute(sql, values);
  }

  // Удаление записи
  async delete(id: number): Promise<void> {
    await ensureDb();
    await db.execute(`DELETE FROM ${this.tableName} WHERE id = ?;`, [id]);
  }

  // Получение записи по ID
  async findById(id: number): Promise<T | null> {
    return await query()
      .table(this.tableName)
      .where(`${this.tableName}.id`, id)
      .first<T>();
  }

  // Получение всех записей
  async findAll(): Promise<T[]> {
    return await query()
      .table(this.tableName as any)
      .get<T>();
  }
}

export { ensureDb }; 