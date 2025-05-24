import { BaseRepository, query } from './index';
import type { HistoryEntry } from './types';

export class HistoryRepository extends BaseRepository<HistoryEntry> {
  constructor() {
    super('history');
  }

  // Получение полной истории для запроса
  async getByRequest(requestId: number): Promise<HistoryEntry[]> {
    return await query()
      .table('history')
      .select('history.id', 'history.sent', 'history.received', 'history.timestamp', 'history.execution_time')
      .where('history.request_id', requestId)
      .orderBy('history.timestamp', 'DESC')
      .get<HistoryEntry>();
  }

  // Получение списка истории без полных данных (для списка)
  async getListByRequest(requestId: number): Promise<Pick<HistoryEntry, 'id' | 'timestamp' | 'execution_time'>[]> {
    return await query()
      .table('history')
      .select('history.id', 'history.timestamp', 'history.execution_time')
      .where('history.request_id', requestId)
      .orderBy('history.timestamp', 'DESC')
      .get<Pick<HistoryEntry, 'id' | 'timestamp' | 'execution_time'>>();
  }

  // Добавление новой записи истории
  async add(requestId: number, sent: string, received: string, executionTime?: number): Promise<number> {
    return await this.create({
      request_id: requestId,
      sent,
      received,
      timestamp: new Date().toISOString(),
      execution_time: executionTime
    });
  }

  // Получение последней записи для запроса
  async getLatestByRequest(requestId: number): Promise<HistoryEntry | null> {
    return await query()
      .table('history')
      .where('history.request_id', requestId)
      .orderBy('history.timestamp', 'DESC')
      .limit(1)
      .first<HistoryEntry>();
  }

  // Получение истории по диапазону дат
  async getByDateRange(requestId: number, startDate: string, endDate: string): Promise<HistoryEntry[]> {
    return await query()
      .table('history')
      .where('history.request_id', requestId)
      .where('history.timestamp', startDate, '>=')
      .where('history.timestamp', endDate, '<=')
      .orderBy('history.timestamp', 'DESC')
      .get<HistoryEntry>();
  }

  // Получение статистики выполнения
  async getExecutionStats(requestId: number): Promise<{
    total_count: number;
    avg_execution_time: number | null;
    min_execution_time: number | null;
    max_execution_time: number | null;
  }> {
    // Для этого запроса используем raw SQL, так как нужны агрегирующие функции
    const { raw } = await import('./index');
    const result = await raw(`
      SELECT 
        COUNT(*) as total_count,
        AVG(execution_time) as avg_execution_time,
        MIN(execution_time) as min_execution_time,
        MAX(execution_time) as max_execution_time
      FROM history 
      WHERE request_id = ? AND execution_time IS NOT NULL
    `, [requestId]);
    
    return result[0] || {
      total_count: 0,
      avg_execution_time: null,
      min_execution_time: null,
      max_execution_time: null
    };
  }

  // Очистка старой истории (оставляем только последние N записей)
  async cleanupOldEntries(requestId: number, keepCount: number = 100): Promise<void> {
    const { raw } = await import('./index');
    await raw(`
      DELETE FROM history 
      WHERE request_id = ? 
      AND id NOT IN (
        SELECT id FROM (
          SELECT id FROM history 
          WHERE request_id = ? 
          ORDER BY timestamp DESC 
          LIMIT ?
        ) as keep_ids
      )
    `, [requestId, requestId, keepCount]);
  }
}

// Экспорт экземпляра репозитория
export const historyRepo = new HistoryRepository(); 