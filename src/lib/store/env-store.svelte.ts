import { db } from "$lib/db/repositories";
import type { EnvPack } from "$lib/db/schema";
import { appStore } from "./app-store.svelte";

class EnvStore {
  envPacks = $state<EnvPack[]>([]);
  originalEnvPackVars = $state<EnvPack["vars"] | undefined>(undefined);
  currentEnvPack = $state<EnvPack | null>(null);

  async init() {
    this.envPacks = await db.envPacks.getAll();
  }

  async setCurrentEnvPack(id: number | null | undefined) {
    if (!id) {
      this.currentEnvPack = null;
      return;
    }

    this.currentEnvPack = this.envPacks.find((pack) => pack.id === id) ?? null;

    this.originalEnvPackVars = this.currentEnvPack
      ? JSON.parse(JSON.stringify(this.currentEnvPack.vars))
      : null;
  }

  resetCurrentEnvPackVars() {
    if (this.currentEnvPack) {
      this.currentEnvPack.vars = this.originalEnvPackVars;
    }
  }

  async addEnvPack(name: string) {
    const trimmedName = name.trim();
    if (trimmedName) {
      const currentCollectionId = appStore.currentCollection?.id ?? null;
      const newPackId = await db.envPacks.add(trimmedName, [], currentCollectionId);
      console.log("newPackId", newPackId);
      this.envPacks.push({
        id: newPackId,
        name: trimmedName,
        vars: [],
        collection_id: currentCollectionId,
      });
    }
  }

  async deleteEnvPack(id: number) {
    await db.envPacks.delete(id);
    if (this.currentEnvPack?.id === id) {
      this.currentEnvPack = null;
    }
    this.envPacks = this.envPacks.filter((pack) => pack.id !== id);
  }

  async updateEnvPackName(id: number, name: string) {
    await db.envPacks.updateName(id, name);
    this.envPacks = this.envPacks.map((pack) =>
      pack.id === id ? { ...pack, name } : pack,
    );
    if (this.currentEnvPack?.id === id) {
      this.currentEnvPack.name = name;
    }
  }

  async updateCurrentEnvPackVars() {
    if (this.currentEnvPack) {
      await db.envPacks.updateVars(
        this.currentEnvPack.id,
        this.currentEnvPack.vars ?? [],
      );
    }
  }

  async toggleEnvPackScope(packId: number) {
    const packIndex = this.envPacks.findIndex((p) => p.id === packId);
    if (packIndex === -1) return;

    const packToUpdate = this.envPacks[packIndex];
    let newCollectionId: number | null = null;

    if (packToUpdate.collection_id === null) {
      newCollectionId = appStore.currentCollection?.id ?? null;
    } else {
      newCollectionId = null;
    }

    await db.envPacks.updateCollectionId(packId, newCollectionId);

    this.envPacks[packIndex] = { ...packToUpdate, collection_id: newCollectionId };
    if (this.currentEnvPack?.id === packId) {
      this.currentEnvPack.collection_id = newCollectionId;
    }
  }
}

export const envStore = new EnvStore();
