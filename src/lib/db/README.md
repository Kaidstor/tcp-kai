# Database Layer с Fluent Interface

Новая система для работы с базой данных основана на fluent interface паттерне, который делает код более читаемым и предоставляет отличную типизацию.

## Структура

```
src/database/
├── index.ts          # Основной QueryBuilder и базовые функции
├── types.ts          # Типы для всех таблиц
├── collections.ts    # Репозиторий для коллекций
├── requests.ts       # Репозиторий для запросов
├── history.ts        # Репозиторий для истории
├── env-packs.ts      # Репозиторий для пакетов переменных окружения
├── settings.ts       # Репозиторий для настроек
├── repositories.ts   # Централизованный экспорт
└── README.md         # Эта документация
```

## Быстрый старт

```typescript
import { db } from '../database/repositories';

// Получение всех коллекций
const collections = await db.collections.getAll();

// Создание новой коллекции
const collectionId = await db.collections.add('My Collection');

// Получение запросов для коллекции
const requests = await db.requests.getByCollection(collectionId);
```

## Query Builder

### Основные методы

```typescript
import { query } from '../database/repositories';

// SELECT с WHERE
const requests = await query()
  .table('requests')
  .select('requests.id', 'requests.name', 'requests.url')
  .where('requests.collection_id', 1)
  .orderBy('requests.name', 'ASC')
  .limit(10)
  .get();

// Получение первой записи
const request = await query()
  .table('requests')
  .where('requests.id', 123)
  .first();

// Различные WHERE условия
const filtered = await query()
  .table('history')
  .where('history.request_id', requestId)
  .whereNot('history.execution_time', null)
  .whereIn('history.id', [1, 2, 3])
  .whereNull('history.error')
  .get();
```

### JOIN операции

```typescript
// LEFT JOIN для получения данных из связанных таблиц
const requestsWithCollections = await query()
  .table('requests')
  .leftJoin('collections', 'requests.collection_id = collections.id')
  .select('requests.*', 'collections.name as collection_name')
  .get();
```

### Алиасы колонок

Система поддерживает создание алиасов для колонок с помощью функций `col()` и `column()`:

```typescript
import { query, col, column } from '../database/repositories';

// Использование col() для простых алиасов (рекомендуется)
const requestsWithAliases = await query()
  .table('requests')
  .leftJoin('collections', 'requests.collection_id = collections.id')
  .select(
    'requests.id',
    col('requests.name').as('request_title'),
    col('requests.url').as('api_endpoint'),
    col('collections.name').as('collection_name')
  )
  .get();

// Смешивание обычных полей с алиасами
const mixedSelect = await query()
  .table('history')
  .select(
    'history.id',
    'history.timestamp',
    col('history.execution_time').as('exec_time_ms'),
    col('requests.name').as('request_name')
  )
  .get();

// Использование raw строк для сложных выражений
const aggregatedData = await query()
  .table('requests')
  .select(
    'collection_id',
    'COUNT(*) AS total_requests',
    'AVG(LENGTH(body)) AS avg_body_size'
  )
  .get();
```

## Репозитории

### Collections

```typescript
import { db } from '../database/repositories';

// Основные операции
const collections = await db.collections.getAll();
const id = await db.collections.add('New Collection');
await db.collections.updatePack(collectionId, packId);
await db.collections.delete(collectionId);

// Специальные методы
const collectionsWithPack = await db.collections.getByPackId(packId);
const collectionsWithoutPack = await db.collections.getWithoutPack();
```

### Requests

```typescript
// Получение запросов
const requests = await db.requests.getByCollection(collectionId);
const found = await db.requests.searchByName('api');

// Создание и обновление
const requestId = await db.requests.add(collectionId, 'Test API', 'http://api.test', 'GET', '{}');
await db.requests.updateRequest(requestId, {
  name: 'Updated API',
  url: 'http://api.test/v2',
  cmd: 'POST',
  body: '{"test": true}'
});
```

### History

```typescript
// Работа с историей
const history = await db.history.getByRequest(requestId);
const historyList = await db.history.getListByRequest(requestId); // Без полных данных
const latest = await db.history.getLatestByRequest(requestId);

// Добавление записи
const historyId = await db.history.add(requestId, sentData, receivedData, executionTime);

// Статистика
const stats = await db.history.getExecutionStats(requestId);
// Результат: { total_count, avg_execution_time, min_execution_time, max_execution_time }

// Очистка старых записей
await db.history.cleanupOldEntries(requestId, 50); // Оставить только 50 последних
```

### Environment Packs

```typescript
// Получение пакетов
const allPacks = await db.envPacks.getAll();
const pack = await db.envPacks.getById(packId);
const globalPacks = await db.envPacks.getGlobal();

// Создание и обновление
const packId = await db.envPacks.add('Production', [
  { key: 'API_URL', value: 'https://api.prod.com' },
  { key: 'API_KEY', value: 'secret-key' }
], collectionId);

await db.envPacks.updateVars(packId, updatedVars);
await db.envPacks.updateName(packId, 'New Name');

// Дополнительные операции
const duplicateId = await db.envPacks.duplicate(packId, 'Copy of Pack');
const variableStats = await db.envPacks.getVariableStats();
```

### Settings

```typescript
// Получение настроек
const value = await db.settings.get('app.theme');
const port = await db.settings.getAsNumber('server.port');
const isEnabled = await db.settings.getAsBoolean('features.darkMode');
const config = await db.settings.getAsJson('app.config');

// Обновление
await db.settings.updateSetting('app.theme', 'dark');
await db.settings.updateSetting('server.port', 3000);
await db.settings.updateSetting('app.config', { version: '1.0.0' });

// Массовые операции
await db.settings.updateMany({
  'app.theme': 'dark',
  'server.port': 3000,
  'features.darkMode': true
});

// Утилиты
const exists = await db.settings.exists('app.theme');
await db.settings.createIfNotExists('app.theme', 'light');
await db.settings.reset('app.theme', 'light');
```

## Raw SQL

Для сложных запросов можно использовать raw SQL:

```typescript
import { raw } from '../database/repositories';

const result = await raw(`
  SELECT r.name, COUNT(h.id) as history_count
  FROM requests r
  LEFT JOIN history h ON r.id = h.request_id
  WHERE r.collection_id = ?
  GROUP BY r.id, r.name
  ORDER BY history_count DESC
`, [collectionId]);
```

## Типизация

Система предоставляет строгую типизацию:

```typescript
// Типы автоматически выводятся
const collections: Collection[] = await db.collections.getAll();

// Ошибки типизации при неправильном использовании
await query()
  .table('requests')
  .where('requests.nonexistent_field', 'value'); // TypeScript ошибка!
```

## Миграция со старой системы

Старые функции из `src/lib/db.ts` можно заменить следующим образом:

```typescript
// Старый код
import { getCollections, addCollection } from '../lib/db';
const collections = await getCollections();
const id = await addCollection('Test');

// Новый код
import { db } from '../database/repositories';
const collections = await db.collections.getAll();
const id = await db.collections.add('Test');
```

## Преимущества

1. **Читаемость**: Fluent interface делает код похожим на обычную речь
2. **Типизация**: Строгая типизация предотвращает ошибки
3. **Гибкость**: Легко строить сложные запросы
4. **Модульность**: Каждая таблица в отдельном файле
5. **Расширяемость**: Легко добавлять новые методы и таблицы
6. **Алиасы**: Поддержка алиасов для более читаемых результатов запросов
7. **Безопасность**: Защита от SQL-инъекций через параметризованные запросы 