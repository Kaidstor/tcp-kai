import { updateSetting as dbUpdateSetting, getCollections, getSetting, getSettingAsNumber } from "$lib/db";
import type { Collection } from "$lib/types";
import { envStore } from "./env-store.svelte";
import { requestStore } from "./request-store.svelte";

class AppStore {
  collections = $state<Collection[]>([]);
  currentCollection = $state<Collection | undefined>(undefined);

  constructor() {}

  async init() {
    this.collections = await getCollections();
    const lastCollectionId = await getSettingAsNumber("last_collection_id") ?? this.collections[0]?.id;

    if (!lastCollectionId) return;
    
    const colId = lastCollectionId;
    await this.setCurrentCollection(colId);

    await requestStore.loadRequests(colId, {
        currentRequestId: await getSettingAsNumber("last_request_id") 
    });

    await envStore.init();
  }

  getCollection(id: number | null) {
    return id ? this.collections.find((c) => c.id === id) : undefined;
  }

  async setCurrentCollection(id: number | null, { updateSetting = true }: { updateSetting?: boolean } = {}) {
    try {
      if (updateSetting) {
        await dbUpdateSetting("last_collection_id", id);
      }

      if (id) {
        await requestStore.loadRequests(id);
        await envStore.setCurrentEnvPack(this.currentCollection?.pack_id);
      }

      this.currentCollection = this.getCollection(id);
    } catch (error) {
      console.error('Error setting current collection:', error);
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

