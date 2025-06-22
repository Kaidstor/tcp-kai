// History Repository
import { sq, raw, sql } from '../schema-query-builder';
import { BaseSchemaRepository } from './base';
import type { HistoryEntry, NewHistoryEntry } from '../schema';

export class SchemaHistoryRepository extends BaseSchemaRepository<HistoryEntry, NewHistoryEntry> {
  constructor() {
    super('history');
  }

  // Получение истории для запроса
  async getByRequest(requestId: number) {
    return await sq()
      .from('history')
      .where('history.request_id', requestId)
      .orderBy('history.timestamp', 'DESC')
      .get();
  }

  // Добавление записи в историю
  async add(requestId: number, sent: string, received: string, executionTime?: number): Promise<number> {
    return await this.create({
      request_id: requestId,
      sent,
      received,
      timestamp: new Date().toISOString(),
      execution_time: executionTime || null
    });
  }

  // Получение последней записи истории для запроса
  async getLatestByRequest(requestId: number) {
    return await sq()
      .from('history')
      .where('history.request_id', requestId)
      .orderBy('history.timestamp', 'DESC')
      .first();
  }

  // Получение статистики выполнения
  async getExecutionStats(requestId: number): Promise<{
    total_count: number;
    avg_execution_time: number | null;
    min_execution_time: number | null;
    max_execution_time: number | null;
  }> {
    // Используем типизированные агрегаты!
    const result = await sq()
      .from('history')
      .select({
        total_count: sql<number>`COUNT(*)`,
        avg_execution_time: sql<number | null>`AVG(execution_time)`,
        min_execution_time: sql<number | null>`MIN(execution_time)`,
        max_execution_time: sql<number | null>`MAX(execution_time)`
      })
      .where('history.request_id', requestId)
      .whereNotNull('history.execution_time')
      .get();
    
    return result[0] || {
      total_count: 0,
      avg_execution_time: null,
      min_execution_time: null,
      max_execution_time: null
    };
  }

  // Получение списка истории (полных данных для простоты)
  async getListByRequest(requestId: number) {
    return await sq()
      .from('history')
      .where('history.request_id', requestId)
      .orderBy('history.timestamp', 'DESC')
      .get(); 
  }

  // Очистка старых записей (оставить только N последних)
  async cleanupOldEntries(requestId: number, keepCount: number) {
    const sql = `
      DELETE FROM history 
      WHERE request_id = ? 
      AND id NOT IN (
        SELECT id FROM history 
        WHERE request_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      )
    `;
    await raw(sql, [requestId, requestId, keepCount]);
  }
}

// Экспорт экземпляра репозитория
export const historyRepo = new SchemaHistoryRepository(); 