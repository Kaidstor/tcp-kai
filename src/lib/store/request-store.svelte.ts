import { db } from "$lib/db/repositories";
import type { RequestItem } from "$lib/db/schema";

class RequestStore {
  requests = $state<RequestItem[]>([]);
  currentRequest = $state<RequestItem | null>(null);

  constructor(requests: RequestItem[]) {
    this.requests = requests;
  }

  setCurrentRequest(id: number | null) {
    this.currentRequest = id
      ? this.requests.find((request) => request.id === id) || null
      : null;
  }

  getRequest(id: number) {
    return this.requests.find((request) => request.id === id);
  }

  async loadRequests(
    collectionId: number,
    { currentRequestId = null }: { currentRequestId?: number | null } = {}
  ) {
    this.requests = await db.requests.getByCollection(collectionId);

    if (currentRequestId) {
      this.setCurrentRequest(currentRequestId);
    }
  }

  async addRequest(request: Omit<RequestItem, "id">) {
    const newRequestId = await db.requests.add(
      request.collection_id,
      request.name,
      request.url || "",
      request.cmd || "",
      request.body || ""
    );

    this.requests.push({ ...request, id: newRequestId });
    this.setCurrentRequest(newRequestId);
  }

  updateRequest(request: RequestItem) {
    const index = this.requests.findIndex((r) => r.id === request.id);
    if (index !== -1) {
      this.requests[index] = request;
    }
  }

  async deleteRequest(id: number) {
    await db.requests.delete(id);
    this.requests = this.requests.filter((r) => r.id !== id);

    if (this.currentRequest?.id === id) {
      this.setCurrentRequest(null);
    }
  }

  deleteAllRequests() {
    this.requests = [];
    this.currentRequest = null;
  }
}

export const requestStore = new RequestStore([]);
