// Requests Repository
import { sq, col, sql, raw } from "../schema-query-builder";
import { BaseSchemaRepository } from "./base";
import type { Request, NewRequest } from "../schema";

export class SchemaRequestsRepository extends BaseSchemaRepository<
  Request,
  NewRequest
> {
  constructor() {
    super("requests");
  }

  // Получение всех запросов для коллекции (отсортированные по весу)
  async getByCollection(collectionId: number) {
    return await sq()
      .from("requests")
      .where("requests.collection_id", collectionId)
      .orderBy("requests.weight", "DESC")
      .orderBy("requests.name", "ASC")
      .get();
  }

  // Создание нового запроса
  async add(
    collectionId: number,
    name: string,
    url: string,
    cmd: string,
    body: string
  ) {
    return await this.create({
      collection_id: collectionId,
      name,
      url,
      cmd,
      body,
    });
  }

  // Обновление запроса
  async updateRequest(
    requestId: number,
    data: {
      name: string;
      url: string;
      cmd: string;
      body: string;
    }
  ) {
    await this.update(requestId, data);
  }

  // Получение запросов с их коллекциями
  async getWithCollections() {
    return await sq()
      .from("requests")
      .leftJoin("collections", "requests.collection_id = collections.id")
      .select([
        "requests.id",
        "requests.collection_id",
        "requests.name",
        "requests.url",
        "requests.cmd",
        "requests.body",
        col("collections.name").as("collection_name"),
      ])
      .get();
  }

  // Поиск запросов по имени
  async searchByName(searchTerm: string) {
    return await sq()
      .from("requests")
      .where("requests.name", `%${searchTerm}%`, "LIKE")
      .get();
  }

  // Получение запросов по URL
  async getByUrl(url: string) {
    return await sq().from("requests").where("requests.url", url).get();
  }

  // Получение запросов по команде
  async getByCommand(cmd: string) {
    return await sq().from("requests").where("requests.cmd", cmd).get();
  }

  // Получение статистики по коллекциям
  async getCollectionStats() {
    return await sq()
      .from("requests")
      .leftJoin("collections", "requests.collection_id = collections.id")
      .select([
        col("requests.collection_id").as("collectionId"),
        col("collections.name").as("collectionName"),
        col("COUNT(requests.id)").as("requestCount"),
        col("AVG(LENGTH(requests.url))").as("avgUrlLength"),
        col("AVG(LENGTH(requests.body))").as("avgBodyLength"),
      ])
      .get();
  }

  // Получение статистики по командам
  async getCommandStats() {
    return await sq()
      .from("requests")
      .select({
        command: "requests.cmd",
        count: sql<number>`COUNT(*)`,
        avgUrlLength: sql<number>`AVG(LENGTH(requests.url))`,
        avgBodyLength: sql<number>`AVG(LENGTH(requests.body))`,
      })
      .get();
  }

  // Получение общей статистики
  async getOverallStats() {
    const result = await sq()
      .from("requests")
      .select({
        totalRequests: sql<number>`COUNT(*)`,
        uniqueUrls: sql<number>`COUNT(DISTINCT requests.url)`,
        uniqueCommands: sql<number>`COUNT(DISTINCT requests.cmd)`,
        avgUrlLength: sql<number>`AVG(LENGTH(requests.url))`,
        maxUrlLength: sql<number>`MAX(LENGTH(requests.url))`,
        avgBodyLength: sql<number>`AVG(LENGTH(requests.body))`,
        maxBodyLength: sql<number>`MAX(LENGTH(requests.body))`,
      })
      .get();

    return result[0];
  }

  // Увеличение веса запроса при использовании
  async incrementWeight(requestId: number) {
    await raw(
      "UPDATE requests SET weight = COALESCE(weight, 0) + 1 WHERE id = ?",
      [requestId]
    );
  }

  // Сброс всех весов в коллекции
  async resetWeights(collectionId: number) {
    await raw("UPDATE requests SET weight = 0 WHERE collection_id = ?", [
      collectionId,
    ]);
  }

  // Уменьшение веса всех запросов (затухание)
  async decayWeights() {
    // Уменьшаем вес на 10% и округляем вниз через целочисленное деление.
    // Это надежно работает во всех версиях SQLite.
    await raw(
      "UPDATE requests SET weight = (weight * 9) / 10 WHERE weight > 0"
    );
  }
}

// Экспорт экземпляра репозитория
export const requestsRepo = new SchemaRequestsRepository();
