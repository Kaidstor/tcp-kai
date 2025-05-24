// Примеры использования алиасов в новой системе базы данных
import { db, query, col, column } from './repositories';

export async function aliasesExamples() {
  console.log('=== Aliases Examples ===');

  // Пример 1: Использование col() для простых алиасов
  const requestsWithAliases = await query()
    .table('requests')
    .leftJoin('collections', 'requests.collection_id = collections.id')
    .select(
      'requests.id',
      col('requests.name').as('request_name'),
      col('requests.url').as('api_endpoint'),
      col('collections.name').as('collection_name')
    )
    .get();

  console.log('Requests with aliases:', requestsWithAliases);

  // Пример 2: Смешивание обычных полей с алиасами
  const mixedSelect = await query()
    .table('history')
    .leftJoin('requests', 'history.request_id = requests.id')
    .select(
      'history.id',
      'history.timestamp',
      col('history.execution_time').as('exec_time_ms'),
      col('requests.name').as('request_name'),
      col('requests.url').as('endpoint')
    )
    .where('history.execution_time', 0, '>')
    .orderBy('history.execution_time', 'DESC')
    .limit(10)
    .get();

  console.log('History with mixed fields:', mixedSelect);

  // Пример 3: Использование raw строк для сложных выражений
  const complexSelect = await query()
    .table('collections')
    .leftJoin('requests', 'collections.id = requests.collection_id')
    .select(
      'collections.id',
      'collections.name',
      'COUNT(requests.id) AS requests_count',
      'COALESCE(collections.pack_id, 0) AS pack_id_safe'
    )
    .get();

  console.log('Complex select with aggregation:', complexSelect);

  // Пример 4: Статистика с алиасами
  const statsWithAliases = await query()
    .table('history')
    .leftJoin('requests', 'history.request_id = requests.id')
    .leftJoin('collections', 'requests.collection_id = collections.id')
    .select(
      col('collections.name').as('collection_name'),
      'COUNT(history.id) AS total_requests',
      'AVG(history.execution_time) AS avg_execution_time',
      'MIN(history.execution_time) AS fastest_request',
      'MAX(history.execution_time) AS slowest_request'
    )
    .get();

  console.log('Statistics with aliases:', statsWithAliases);

  // Пример 5: Типизированный алиас (использует column вместо col)
  // Примечание: этот способ более строгий, но может требовать больше типизации
  const typedAliases = await query()
    .table('requests')
    .select(
      'requests.id',
      col('requests.name').as('title'), // Простой способ
      // column<DatabaseSchema>('requests.url').as('endpoint') // Типизированный способ
    )
    .get();

  console.log('Typed aliases:', typedAliases);

  return {
    requestsWithAliases,
    mixedSelect,
    complexSelect,
    statsWithAliases,
    typedAliases
  };
}

// Пример использования в репозитории
export class ExampleRepository {
  // Метод с алиасами для читаемости результатов
  async getRequestSummary(collectionId: number) {
    return await query()
      .table('requests')
      .leftJoin('history', 'requests.id = history.request_id')
      .select(
        col('requests.id').as('request_id'),
        col('requests.name').as('request_title'),
        col('requests.url').as('api_url'),
        col('requests.cmd').as('http_method'),
        'COUNT(history.id) AS execution_count',
        'AVG(history.execution_time) AS avg_response_time',
        'MAX(history.timestamp) AS last_executed'
      )
      .where('requests.collection_id', collectionId)
      .get();
  }

  // Метод для получения топ самых используемых эндпоинтов
  async getTopEndpoints(limit: number = 10) {
    return await query()
      .table('requests')
      .leftJoin('history', 'requests.id = history.request_id')
      .leftJoin('collections', 'requests.collection_id = collections.id')
      .select(
        col('requests.name').as('endpoint_name'),
        col('requests.url').as('endpoint_url'),
        col('collections.name').as('collection_name'),
        'COUNT(history.id) AS usage_count',
        'AVG(history.execution_time) AS avg_response_time'
      )
      .get();
  }
}

// Типы для результатов с алиасами
export interface RequestWithAliases {
  request_name: string;
  api_endpoint: string;
  collection_name: string;
}

export interface RequestSummary {
  request_id: number;
  request_title: string;
  api_url: string;
  http_method: string;
  execution_count: number;
  avg_response_time: number | null;
  last_executed: string | null;
}

export interface TopEndpoint {
  endpoint_name: string;
  endpoint_url: string;
  collection_name: string;
  usage_count: number;
  avg_response_time: number | null;
} 