// Collections — the root of the data tree: a collection owns its requests and
// points at the env pack whose variables their URLs and bodies resolve
// against. Boot (init) lives here for the same reason.
import { db } from "../../db";
import { applyTheme } from "../../themes";
import type { Collection } from "../../types";
import type { Get, Set } from "../types";

export interface CollectionsSlice {
  collections: Collection[];
  currentCollectionId: number | null;
  /** False until init() has read the DB — the shell waits rather than
   *  flashing the "no collection" empty state. */
  ready: boolean;

  /** Loads packs, collections, theme and the last session's selection. */
  init: () => Promise<void>;
  /** Switches collection: reloads its requests and drops the open request. */
  selectCollection: (id: number | null) => Promise<void>;
  /** Returns the new id, or null when the name is taken (names are UNIQUE). */
  createCollection: (name: string) => Promise<number | null>;
  renameCollection: (id: number, name: string) => Promise<void>;
  /** Requests and history go with it (ON DELETE CASCADE). */
  deleteCollection: (id: number) => Promise<void>;
}

/** Case-insensitive name clash against every collection but `exceptId`. */
const nameTaken = (list: Collection[], name: string, exceptId?: number) =>
  list.some(
    (c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase(),
  );

export function createCollectionsSlice(set: Set, get: Get): CollectionsSlice {
  return {
    collections: [],
    currentCollectionId: null,
    ready: false,

    init: async () => {
      const [envPacks, collections, theme] = await Promise.all([
        db.envPacks.all(),
        db.collections.all(),
        db.settings.get("theme"),
      ]);
      // main.tsx applied the cached theme pre-render; reconcile with the DB
      if (theme) applyTheme(theme);
      set({ envPacks, collections, settings: { theme: theme ?? undefined } });

      const lastCollectionId = await db.settings.getNumber("last_collection_id");
      // the remembered collection may have been deleted since
      const collection =
        collections.find((c) => c.id === lastCollectionId) ?? collections[0];
      if (!collection) {
        set({ ready: true });
        return;
      }
      await get().selectCollection(collection.id);

      const lastRequestId = await db.settings.getNumber("last_request_id");
      if (
        lastRequestId !== null &&
        get().requests.some((r) => r.id === lastRequestId)
      ) {
        await get().selectRequest(lastRequestId);
      }
      set({ ready: true });
    },

    selectCollection: async (id) => {
      await db.settings.set("last_collection_id", id);
      const collection = get().collections.find((c) => c.id === id) ?? null;
      set({ currentCollectionId: collection?.id ?? null });
      get().clearRequest();
      if (!collection) {
        set({ requests: [] });
        return;
      }
      await get().loadRequests(collection.id);
    },

    createCollection: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      if (nameTaken(get().collections, trimmed)) {
        get().showToast(`Коллекция "${trimmed}" уже существует`);
        return null;
      }
      const id = await db.collections.add(trimmed);
      set((s) => ({
        collections: [...s.collections, { id, name: trimmed, pack_id: null }],
      }));
      await get().selectCollection(id);
      return id;
    },

    renameCollection: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (nameTaken(get().collections, trimmed, id)) {
        get().showToast(`Коллекция "${trimmed}" уже существует`);
        return;
      }
      await db.collections.rename(id, trimmed);
      set((s) => ({
        collections: s.collections.map((c) =>
          c.id === id ? { ...c, name: trimmed } : c,
        ),
      }));
    },

    deleteCollection: async (id) => {
      await db.collections.remove(id);
      set((s) => ({ collections: s.collections.filter((c) => c.id !== id) }));
      // deleting the open collection leaves nothing selected — the shell
      // falls back to the "pick a collection" empty state
      if (get().currentCollectionId === id) await get().selectCollection(null);
    },
  };
}
