# Schema-Based Repositories

## 📁 Модульная структура репозиториев

Репозитории разбиты по отдельным файлам для лучшей организации кода.

## 📋 Файлы

- **`base.ts`** - Базовый репозиторий с CRUD операциями
- **`collections.ts`** - Репозиторий для коллекций
- **`requests.ts`** - Репозиторий для запросов (с автоматической типизацией JOIN!)
- **`history.ts`** - Репозиторий для истории выполнения
- **`env-packs.ts`** - Репозиторий для пакетов переменных окружения
- **`settings.ts`** - Репозиторий для настроек приложения
- **`index.ts`** - Центральный экспорт всех репозиториев

## 🎯 Способы использования

### 1. Импорт общего объекта (рекомендуется)

```typescript
import { schemaDb } from './repositories';

const collections = await schemaDb.collections.getAll();
const requests = await schemaDb.requests.getWithCollections(); // автоматическая типизация JOIN!
```

### 2. Импорт отдельных репозиториев

```typescript
import { collectionsRepo, requestsRepo } from './repositories';

const collections = await collectionsRepo.getAll();
const requestsByCollection = await requestsRepo.getByCollection(1);
```

### 3. Импорт классов для расширения

```typescript
import { BaseSchemaRepository, SchemaRequestsRepository } from './repositories';

class MyCustomRepository extends BaseSchemaRepository<MyType, MyNewType> {
  // кастомная логика
}
```

## ✨ Преимущества модульной структуры

1. **🔧 Лучшая организация** - каждый репозиторий в отдельном файле
2. **📝 Читаемость** - легче находить и редактировать логику
3. **🎯 Селективные импорты** - можно импортировать только нужные репозитории  
4. **🧪 Тестируемость** - проще тестировать отдельные репозитории
5. **♻️ Переиспользование** - можно расширять базовый репозиторий

## 🔄 Миграция

Если у вас есть код, использующий старый файл `schema-repositories.ts`:

```typescript
// Старый код - продолжает работать
import { schemaDb } from '../schema-repositories';

// Новый код - рекомендуется переходить
import { schemaDb } from '../repositories';
```

## 🚀 Пример расширения базового репозитория

```typescript
// В файле custom-repository.ts
import { BaseSchemaRepository } from './base';
import { sq } from '../schema-query-builder';

class CustomCollectionsRepo extends BaseSchemaRepository<Collection, NewCollection> {
  constructor() {
    super('collections');
  }

  // Добавляем кастомные методы
  async getActiveCollections() {
    return await sq()
      .from('collections')
      .where('collections.active', true)
      .get();
  }
}
``` 