// Система определения схемы базы данных (как в Drizzle ORM)

// Базовые типы полей
export type FieldType = "integer" | "text" | "real" | "blob";

// Определение поля (упрощённая версия)
export interface FieldDefinition<T = any> {
  name: string;
  type: FieldType;
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  references?: string; // упрощено - просто название поля
  __tsType: T; // phantom type для TypeScript
}

// Определение таблицы
export interface TableDefinition<
  TName extends string = string,
  TColumns extends Record<string, FieldDefinition> = any
> {
  name: TName;
  columns: TColumns;
}

// Упрощённые helper функции для создания полей
export function integer(name: string): FieldDefinition<number> {
  return {
    name,
    type: "integer",
    __tsType: null as any, // phantom type
  };
}

// Nullable версии
export function nullableInteger(name: string): FieldDefinition<number | null> {
  return {
    name,
    type: "integer",
    __tsType: null as any, // phantom type
  };
}

export function nullableText(name: string): FieldDefinition<string | null> {
  return {
    name,
    type: "text",
    __tsType: null as any, // phantom type
  };
}

export function text(name: string): FieldDefinition<string> {
  return {
    name,
    type: "text",
    __tsType: null as any, // phantom type
  };
}

export function real(name: string): FieldDefinition<number> {
  return {
    name,
    type: "real",
    __tsType: null as any, // phantom type
  };
}

// Модификаторы полей
export function primaryKey<T>(field: FieldDefinition<T>): FieldDefinition<T> {
  return { ...field, primaryKey: true };
}

export function notNull<T>(field: FieldDefinition<T>): FieldDefinition<T> {
  return { ...field, notNull: true };
}

export function unique<T>(field: FieldDefinition<T>): FieldDefinition<T> {
  return { ...field, unique: true };
}

export function references<T>(
  field: FieldDefinition<T>,
  refField: string
): FieldDefinition<T> {
  return { ...field, references: refField };
}

// Функция для создания таблицы
export function sqliteTable<
  TName extends string,
  TColumns extends Record<string, FieldDefinition>
>(name: TName, columns: TColumns): TableDefinition<TName, TColumns> {
  return {
    name,
    columns,
  };
}

// Типы для извлечения информации из схемы
export type InferSelectModel<T extends TableDefinition> = {
  [K in keyof T["columns"]]: T["columns"][K]["__tsType"];
};

export type InferInsertModel<T extends TableDefinition> = {
  [K in keyof T["columns"] as T["columns"][K]["primaryKey"] extends true
    ? never
    : K]?: T["columns"][K]["__tsType"];
};

// Типы для работы с полями таблицы
export type TableColumns<T extends TableDefinition> = T["columns"];

export type ColumnName<T extends TableDefinition> = keyof T["columns"];

export type QualifiedColumnName<T extends TableDefinition> =
  `${T["name"]}.${string & keyof T["columns"]}`;

// Определение нашей схемы базы данных
export const collectionsTable = sqliteTable("collections", {
  id: primaryKey(integer("id")),
  name: notNull(text("name")),
  pack_id: nullableInteger("pack_id"), // nullable
});

export const requestsTable = sqliteTable("requests", {
  id: primaryKey(integer("id")),
  collection_id: notNull(
    references(integer("collection_id"), "collections.id")
  ),
  name: notNull(text("name")),
  url: notNull(text("url")),
  cmd: notNull(text("cmd")),
  body: notNull(text("body")),
  received: nullableText("received"),
  weight: nullableInteger("weight"), // Вес запроса для сортировки по частоте использования
});

export const historyTable = sqliteTable("history", {
  id: primaryKey(integer("id")),
  request_id: notNull(references(integer("request_id"), "requests.id")),
  sent: notNull(text("sent")),
  received: notNull(text("received")),
  timestamp: notNull(text("timestamp")),
  execution_time: nullableInteger("execution_time"), // nullable
});

export const envPacksTable = sqliteTable("env_packs", {
  id: primaryKey(integer("id")),
  name: notNull(text("name")),
  vars: notNull(text("vars")), // JSON string
  collection_id: nullableInteger("collection_id"), // nullable
});

export const settingsTable = sqliteTable("settings", {
  id: primaryKey(integer("id")),
  key: unique(notNull(text("key"))),
  value: nullableText("value"), // nullable
  created_at: notNull(text("created_at")),
  updated_at: notNull(text("updated_at")),
});

// Типы, выведенные из схемы
export type Collection = InferSelectModel<typeof collectionsTable>;
export type Request = InferSelectModel<typeof requestsTable>;
export type HistoryEntry = InferSelectModel<typeof historyTable>;
export type EnvPackRow = InferSelectModel<typeof envPacksTable>;
export type Setting = InferSelectModel<typeof settingsTable>;

// Адаптер типов для совместимости с UI
export interface EnvVar {
  key: string;
  value: string;
}

// Расширенный тип для UI (с распарсенными vars)
export interface EnvPack extends Omit<EnvPackRow, "vars"> {
  vars: EnvVar[] | undefined;
}

// Alias для RequestItem (совместимость)
export type RequestItem = Request;

// Утилиты для преобразования между форматами
export function envPackRowToPack(row: EnvPackRow): EnvPack {
  return {
    ...row,
    vars: row.vars ? JSON.parse(row.vars) : null,
  };
}

export function envPackToRow(pack: EnvPack): Omit<EnvPackRow, "id"> {
  return {
    name: pack.name,
    collection_id: pack.collection_id,
    vars: pack.vars ? JSON.stringify(pack.vars) : "[]",
  };
}

// Типы для создания записей (без id)
export type NewCollection = InferInsertModel<typeof collectionsTable>;
export type NewRequest = InferInsertModel<typeof requestsTable>;
export type NewHistoryEntry = InferInsertModel<typeof historyTable>;
export type NewEnvPack = InferInsertModel<typeof envPacksTable>;
export type NewSetting = InferInsertModel<typeof settingsTable>;

// Реестр всех таблиц
export const schema = {
  collections: collectionsTable,
  requests: requestsTable,
  history: historyTable,
  env_packs: envPacksTable,
  settings: settingsTable,
} as const;

export type Schema = typeof schema;
