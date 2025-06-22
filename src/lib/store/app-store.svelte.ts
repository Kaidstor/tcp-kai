import { db } from "$lib/db/repositories";
import type { Collection } from "$lib/db/schema";
import { envStore } from "./env-store.svelte";
import { requestStore } from "./request-store.svelte";

class AppStore {
  collections = $state<Collection[]>([]);
  currentCollection = $state<Collection | undefined>(undefined);

  constructor() {}

  async init() {
    await envStore.init();

    // 2. Загружаем коллекции и остальное состояние
    this.collections = await db.collections.getAll();
    const lastCollectionId =
      (await db.settings.getAsNumber("last_collection_id")) ?? this.collections[0]?.id;

    if (!lastCollectionId) return;

    const colId = lastCollectionId;
    await this.setCurrentCollection(colId);

    await requestStore.loadRequests(colId, {
      currentRequestId: await db.settings.getAsNumber("last_request_id"),
    });
  }

  getCollection(id: number | null) {
    return id ? this.collections.find((c) => c.id === id) : undefined;
  }

  async setCurrentCollection(
    id: number | null,
    { updateSetting = true }: { updateSetting?: boolean } = {},
  ) {
    try {
      if (updateSetting) {
        await db.settings.updateSetting("last_collection_id", id);
      }

      const newCollection = this.getCollection(id);

      if (id) {
        await requestStore.loadRequests(id);
        await envStore.setCurrentEnvPack(newCollection?.pack_id);
      }

      this.currentCollection = newCollection;
    } catch (error) {
      console.error("Error setting current collection:", error);
    }
  }

  addCollection(collection: Collection) {
    this.collections.push(collection);
    this.setCurrentCollection(collection.id);
  }

  deleteCollection(id: number) {
    if (this.currentCollection?.id === id) {
      this.setCurrentCollection(null);
    }
    this.collections = this.collections.filter((c) => c.id !== id);
  }
}

export const appStore = new AppStore();
