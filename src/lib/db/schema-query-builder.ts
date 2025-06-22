// Query Builder с использованием предопределённой схемы
import Database from '@tauri-apps/plugin-sql';
import type { 
  TableDefinition, 
  InferSelectModel,
  Schema
} from './schema';
import { schema } from './schema';

let db: Database;

async function ensureDb() {
  if (!db) {
    db = await Database.load('sqlite:app.db');
  }
}

// Типизированная SQL функция (как в Drizzle ORM)
export interface SQLWrapper<T = unknown> {
  __brand: 'SQLWrapper';
  __type: T;
  sql: string;
}

// Функция sql<T> для создания типизированных SQL выражений
export function sql<T = unknown>(strings: TemplateStringsArray, ...values: any[]): SQLWrapper<T> {
  const sqlString = strings.reduce((acc, str, i) => {
    return acc + str + (values[i] ?? '');
  }, '');
  
  return {
    __brand: 'SQLWrapper',
    __type: undefined as any,
    sql: sqlString
  };
}

// Типы для колонок с квалификатором таблицы
type QualifiedColumn<T extends TableDefinition> = `${T['name']}.${string & keyof T['columns']}`;

// Типы для алиасов колонок
interface ColumnAlias {
  column: string;
  alias: string;
}

// Функция для создания алиасов
export function col(column: string) {
  return {
    as: (alias: string): ColumnAlias => ({
      column,
      alias
    })
  };
}

// Тип для извлечения названия таблицы из квалифицированной колонки
type ExtractTableName<T extends string> = T extends `${infer Table}.${string}` ? Table : never;

// Тип для извлечения названия колонки из квалифицированной колонки
type ExtractColumnName<T extends string> = T extends `${string}.${infer Column}` ? Column : T;

// Тип для извлечения типа поля из схемы
type GetColumnType<TTable extends keyof Schema, TColumn extends string> = 
  TTable extends keyof Schema 
    ? TColumn extends keyof Schema[TTable]['columns']
      ? Schema[TTable]['columns'][TColumn] extends { __tsType: infer T }
        ? T
        : never
      : never
    : never;

// Типы для колонок таблицы (как в Drizzle ORM)
type TableColumn<TTable extends keyof Schema> = keyof InferSelectModel<Schema[TTable]> & string;

// Квалифицированные колонки (table.column)
type QualifiedTableColumn<TTable extends keyof Schema> = `${TTable}.${TableColumn<TTable>}`;

// Строгие колонки для WHERE (только собственные и квалифицированные колонки текущей таблицы)
type StrictWhereColumn<TTable extends keyof Schema> = 
  | TableColumn<TTable>
  | QualifiedTableColumn<TTable>;

// Все возможные колонки для WHERE (с поддержкой JOIN и raw expressions)
type WhereColumn<TTable extends keyof Schema> = 
  | TableColumn<TTable>
  | QualifiedTableColumn<TTable>;

// Типы для результата SELECT с учётом схемы
type SelectResult<TColumns extends readonly (string | ColumnAlias)[]> = {
  [K in keyof TColumns as TColumns[K] extends ColumnAlias 
    ? TColumns[K]['alias']
    : TColumns[K] extends string 
      ? ExtractColumnName<TColumns[K]>
      : never
  ]: TColumns[K] extends ColumnAlias
    ? TColumns[K]['column'] extends `${infer Table}.${infer Column}`
      ? Table extends keyof Schema
        ? Column extends keyof Schema[Table]['columns']
          ? Schema[Table]['columns'][Column] extends { __tsType: infer T }
            ? T
            : any
          : any
        : any
      : any
    : TColumns[K] extends `${infer Table}.${infer Column}`
      ? Table extends keyof Schema
        ? Column extends keyof Schema[Table]['columns']
          ? Schema[Table]['columns'][Column] extends { __tsType: infer T }
            ? T
            : any
          : any
        : any
      : any
};

// Utility type для "раскрытия" типов в IntelliSense
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// Получение типа таблицы по её имени автоматически из схемы
type InferTableType<TTable extends keyof Schema> = InferSelectModel<Schema[TTable]>;

// Функция для раскрытия типа с infer
type ExpandTableType<T> = T extends infer U ? Prettify<U> : never;

// Допустимые названия таблиц автоматически из схемы
type TableName = keyof Schema;

// Типы для SELECT с поддержкой объектов (как в Drizzle ORM)
type SelectColumn<TTable extends TableName> = 
  | StrictWhereColumn<TTable>
  | ColumnAlias
  | SQLWrapper<any>;

type SelectObject<TTable extends TableName> = {
  [key: string]: SelectColumn<TTable>;
};

// Тип для извлечения типа из SQLWrapper
type ExtractSQLType<T> = T extends SQLWrapper<infer U> ? U : never;

// Результат SELECT объекта
type SelectObjectResult<T extends SelectObject<any>> = {
  [K in keyof T]: T[K] extends SQLWrapper<infer U>
    ? U
    : T[K] extends ColumnAlias
    ? any // Тип алиаса сложно вычислить, оставляем any
    : T[K] extends string
    ? any // Для строковых колонок тоже any (можно улучшить позже)
    : never;
};

// Schema-based QueryBuilder
export class SchemaQueryBuilder<
  TSelectedColumns extends any = undefined,
  TTable extends TableName | undefined = undefined
> {
  private fields: string[] = [];
  private wheres: Array<{ column: string; value: any; operator: string }> = [];
  private orderByClause: string = '';
  private limitClause: number | null = null;
  private offsetClause: number | null = null;
  private tableName: string = '';
  private joinClauses: string[] = [];

  // FROM clause
  from<TNewTable extends TableName>(tableName: TNewTable): SchemaQueryBuilder<undefined, TNewTable> {
    this.tableName = tableName as string;
    return this as any;
  }

  // SELECT clause с поддержкой объектов (как в Drizzle ORM)
  select<TSelection extends 
    | (TTable extends TableName ? readonly (StrictWhereColumn<TTable> | ColumnAlias | SQLWrapper<any>)[] : readonly (string | ColumnAlias)[])
    | (TTable extends TableName ? SelectObject<TTable> : Record<string, any>)
  >(
    selection: TSelection
  ): SchemaQueryBuilder<TSelection, TTable> {
    
    if (Array.isArray(selection)) {
      // Массив колонок (существующая логика)
      this.fields = selection.map(col => {
        if (typeof col === 'string') {
          return col;
        }
        if (typeof col === 'object' && 'column' in col && 'alias' in col) {
          return `${col.column} AS ${col.alias}`;
        }
        if (typeof col === 'object' && '__brand' in col && col.__brand === 'SQLWrapper') {
          return (col as SQLWrapper).sql;
        }
        return col as string;
      });
    } else {
      // Объект с агрегатами (новая логика)
      this.fields = Object.entries(selection).map(([alias, col]) => {
        if (typeof col === 'string') {
          return `${col} AS ${alias}`;
        }
        if (typeof col === 'object' && 'column' in col && 'alias' in col) {
          return `${col.column} AS ${alias}`;
        }
        if (typeof col === 'object' && '__brand' in col && col.__brand === 'SQLWrapper') {
          return `${(col as SQLWrapper).sql} AS ${alias}`;
        }
        return `${col} AS ${alias}`;
      });
    }
    
    return this as any;
  }

  // WHERE clauses с типизированными колонками (строгая типизация)
  where<TColumn extends TTable extends TableName ? StrictWhereColumn<TTable> : never>(
    column: TColumn, 
    value: any, 
    operator: string = '='
  ): this {
    this.wheres.push({ column: column as string, value, operator });
    return this;
  }

  whereNot<TColumn extends TTable extends TableName ? StrictWhereColumn<TTable> : never>(
    column: TColumn, 
    value: any
  ): this {
    return this.where(column, value, '!=');
  }

  whereIn<TColumn extends TTable extends TableName ? StrictWhereColumn<TTable> : never>(
    column: TColumn, 
    values: any[]
  ): this {
    this.wheres.push({ column: column as string, value: values, operator: 'IN' });
    return this;
  }

  whereNull<TColumn extends TTable extends TableName ? StrictWhereColumn<TTable> : never>(
    column: TColumn
  ): this {
    this.wheres.push({ column: column as string, value: null, operator: 'IS NULL' });
    return this;
  }

  whereNotNull<TColumn extends TTable extends TableName ? StrictWhereColumn<TTable> : never>(
    column: TColumn
  ): this {
    this.wheres.push({ column: column as string, value: null, operator: 'IS NOT NULL' });
    return this;
  }

  // WHERE методы для JOIN запросов (менее строгая типизация)
  whereRaw(column: string, value: any, operator: string = '='): this {
    this.wheres.push({ column, value, operator });
    return this;
  }

  // ORDER BY clause с типизированными колонками
  orderBy<TColumn extends TTable extends TableName ? StrictWhereColumn<TTable> : never>(
    column: TColumn, 
    direction: 'ASC' | 'DESC' = 'ASC'
  ): this {
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

  // Выполнение SELECT запроса с автоматическим выводом типов
  async get<TReturn = TSelectedColumns extends SelectObject<any>
    ? SelectObjectResult<TSelectedColumns>[]
    : TSelectedColumns extends readonly (string | ColumnAlias)[] 
      ? SelectResult<TSelectedColumns>[] 
      : TTable extends TableName
        ? ExpandTableType<InferTableType<TTable>>[]
        : any[]
  >(): Promise<TReturn> {
    await ensureDb();
    const sql = this.buildSelectQuery();
    const params = this.buildParams();
    return await db.select(sql, params) as TReturn;
  }

  // Получение первой записи
  async first<TReturn = TSelectedColumns extends SelectObject<any>
    ? SelectObjectResult<TSelectedColumns> | null
    : TSelectedColumns extends readonly (string | ColumnAlias)[] 
      ? SelectResult<TSelectedColumns> | null
      : TTable extends TableName
        ? ExpandTableType<InferTableType<TTable>> | null
        : any | null
  >(): Promise<TReturn> {
    const results = await this.limit(1).get();
    return (results.length > 0 ? results[0] : null) as TReturn;
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

// Основная функция для создания schema-based query builder
export function sq() {
  return new SchemaQueryBuilder();
}

// Функция для выполнения raw SQL
export async function raw(sql: string, params?: any[]): Promise<any> {
  await ensureDb();
  return await db.execute(sql, params);
}

export { ensureDb };