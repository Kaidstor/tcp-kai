import { BaseRepository, query, col } from './index';
import type { Request } from './types';

export class RequestsRepository extends BaseRepository<Request> {
  constructor() {
    super('requests');
  }

  // Получение всех запросов для коллекции
  async getByCollection(collectionId: number): Promise<Request[]> {
    return await query()
      .table('requests')
      .select('requests.id', 'requests.name', 'requests.url', 'requests.cmd', 'requests.body')
      .where('requests.collection_id', collectionId)
      .get<Request>();
  }

  // Создание нового запроса
  async add(collectionId: number, name: string, url: string, cmd: string, body: string): Promise<number> {
    return await this.create({
      collection_id: collectionId,
      name,
      url,
      cmd,
      body
    });
  }

  // Обновление запроса
  async updateRequest(requestId: number, data: {
    name: string;
    url: string;
    cmd: string;
    body: string;
  }): Promise<void> {
    await this.update(requestId, data);
  }

  // Получение запросов с фильтрацией по URL
  async getByUrl(url: string): Promise<Request[]> {
    return await query()
      .table('requests')
      .where('requests.url', url)
      .get<Request>();
  }

  // Получение запросов по команде
  async getByCommand(cmd: string): Promise<Request[]> {
    return await query()
      .table('requests')
      .where('requests.cmd', cmd)
      .get<Request>();
  }

  // Поиск запросов по имени (LIKE)
  async searchByName(searchTerm: string): Promise<Request[]> {
    return await query()
      .table('requests')
      .where('requests.name', `%${searchTerm}%`, 'LIKE')
      .get<Request>();
  }

  // Получение запросов с их коллекциями
  async getWithCollections(): Promise<Array<Request & { collection_name: string }>> {
    return await query()
      .table('requests')
      .leftJoin('collections', 'requests.collection_id = collections.id')
      .select(
        'requests.id',
        'requests.collection_id', 
        'requests.name',
        'requests.url',
        'requests.cmd',
        'requests.body',
        col('collections.name').as('collection_name')
      )
      .get<Request & { collection_name: string }>();
  }
}

// Экспорт экземпляра репозитория
export const requestsRepo = new RequestsRepository(); 