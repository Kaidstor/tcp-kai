import { addEnvPack, deleteEnvPack, getEnvPacks, updateEnvPack, updateEnvPackName } from "$lib/db";
import type { EnvPack } from "$lib/types";

class EnvStore {
  envPacks = $state<EnvPack[]>([]);
  originalEnvPackVars = $state<EnvPack["vars"] | null | undefined>(null);
  currentEnvPack = $state<EnvPack | null | undefined>(null);

  constructor() {
    this.init();
  }

  async init() {
    this.envPacks = await getEnvPacks();
    this.currentEnvPack = this.envPacks[0] ?? null;
  }

  async setCurrentEnvPack(id: number | null | undefined) {
    if (!id) {
      this.currentEnvPack = null;
      return;
    }

    this.currentEnvPack = this.envPacks.find((pack) => pack.id === id);

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
      const newPackId = await addEnvPack(trimmedName);
      this.envPacks.push({ id: newPackId, name: trimmedName, vars: [] });
    }
  }

  async deleteEnvPack(id: number) {
    await deleteEnvPack(id);
    if (this.currentEnvPack?.id === id) {
      this.currentEnvPack = null;
    }
    this.envPacks = this.envPacks.filter((pack) => pack.id !== id);
  }

  async updateEnvPackName(id: number, name: string) {
    await updateEnvPackName(id, name);
    this.envPacks = this.envPacks.map((pack) =>
      pack.id === id ? { ...pack, name } : pack
    );
  }

  async updateCurrentEnvPackVars() {
    if (this.currentEnvPack) {
      await updateEnvPack(this.currentEnvPack.id, this.currentEnvPack.vars ?? []);
    }
  }
}

export const envStore = new EnvStore();
