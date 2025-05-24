// Типы для таблиц базы данных

export interface Collection {
  id: number;
  name: string;
  pack_id?: number | null;
}

export interface Request {
  id: number;
  collection_id: number;
  name: string;
  url: string;
  cmd: string;
  body: string;
}

export interface HistoryEntry {
  id: number;
  request_id: number;
  sent: string;
  received: string;
  timestamp: string;
  execution_time?: number | null;
}

export interface EnvPackRow {
  id: number;
  name: string;
  vars: string; // JSON string
  collection_id: number | null;
}

export interface EnvPack {
  id: number;
  name: string;
  vars: { key: string; value: string }[] | null;
  collection_id: number | null;
}

export interface Setting {
  id: number;
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
}

// Базовые типы для fluent interface
export type BaseTable = {
  [colName: string]: string | number | boolean | null;
};

// Схема всех таблиц
export type DatabaseSchema = {
  collections: Collection;
  requests: Request;
  history: HistoryEntry;
  env_packs: EnvPackRow;
  settings: Setting;
} & { [tableName: string]: BaseTable };

// Типы для SELECT операций
export type Columns<Tables extends { [tableName: string]: BaseTable }> = {
  [K in keyof Tables]: K extends string 
    ? (keyof Tables[K] extends string 
        ? `${K}.${keyof Tables[K]}` 
        : never) 
    : never;
}[keyof Tables];

export type Flat<Tables extends { [tableName: string]: BaseTable }> = {
  [K in Columns<Tables>]: Tables[K extends `${infer T}.${infer _}` ? T : never][K extends `${infer _}.${infer C}`
    ? C
    : never];
};

// Типы для алиасов
export interface ColumnAlias<T = any> {
  column: string;
  alias: string;
  __type?: T;
}

export type SelectColumns<Tables extends { [tableName: string]: BaseTable }> = 
  | Columns<Tables>
  | ColumnAlias
  | string; // для raw строк типа 'COUNT(*) as count'

// Типы для операций создания и обновления
export type InsertData<T> = Omit<T, 'id'>;
export type UpdateData<T> = Partial<Omit<T, 'id'>>;

// Типы результатов операций
export interface ExecuteResult {
  lastInsertId?: number | null;
  rowsAffected?: number;
}

export interface SelectResult<T> extends Array<T> {} 