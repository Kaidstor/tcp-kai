// Environment packs: named {key,value} sets, either global or bound to one
// collection. A collection points at the pack whose variables its requests
// resolve `{{name}}` against (see utils/processEnvVars).
//
// Two different notions of "current pack" are kept apart on purpose: the pack
// *applied* to the open collection (collections.pack_id — what substitution
// uses) and the pack being *edited* in the config dialog. Selecting a pack to
// edit must not silently change what requests send.
import { db } from "../../db";
import type { EnvPack, EnvVar } from "../../types";
import { usableEnvPacks } from "../selectors";
import type { Get, Set } from "../types";

export interface EnvSlice {
  envPacks: EnvPack[];
  /** Pack open in the env dialog; not necessarily the applied one. */
  editingPackId: number | null;
  /** Editing buffer for editingPackId — Save writes it, Reset drops it. */
  draftVars: EnvVar[];

  /** Opens the dialog on the applied pack (or the first available one). */
  openEnvConfig: () => void;
  selectEditingPack: (id: number) => void;
  setDraftVars: (vars: EnvVar[]) => void;
  /** Drops unsaved edits back to what's in the DB. */
  resetDraftVars: () => void;
  saveDraftVars: () => Promise<void>;
  createEnvPack: (name: string) => Promise<void>;
  renameEnvPack: (id: number, name: string) => Promise<void>;
  deleteEnvPack: (id: number) => Promise<void>;
  /** Global ⇄ bound to the open collection. */
  toggleEnvPackScope: (id: number) => Promise<void>;
  /** Applies a pack to the open collection (saving pending edits first). */
  activateEnvPack: (id: number) => Promise<void>;
}

export function createEnvSlice(set: Set, get: Get): EnvSlice {
  /** Points the dialog at `id` and refills the editing buffer from the DB copy. */
  const openPack = (id: number | null) => {
    const pack = get().envPacks.find((p) => p.id === id);
    set({
      editingPackId: pack?.id ?? null,
      draftVars: pack ? pack.vars.map((v) => ({ ...v })) : [],
    });
  };

  return {
    envPacks: [],
    editingPackId: null,
    draftVars: [],

    openEnvConfig: () => {
      const applied = get().collections.find(
        (c) => c.id === get().currentCollectionId,
      )?.pack_id;
      openPack(applied ?? usableEnvPacks(get())[0]?.id ?? null);
      set({ envConfigOpen: true });
    },

    selectEditingPack: (id) => openPack(id),

    setDraftVars: (draftVars) => set({ draftVars }),

    resetDraftVars: () => openPack(get().editingPackId),

    saveDraftVars: async () => {
      const id = get().editingPackId;
      if (id === null) return;
      const vars = get().draftVars;
      await db.envPacks.setVars(id, vars);
      set((s) => ({
        envPacks: s.envPacks.map((p) => (p.id === id ? { ...p, vars } : p)),
      }));
    },

    createEnvPack: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // new packs start bound to the open collection; the scope toggle frees them
      const collectionId = get().currentCollectionId;
      const id = await db.envPacks.add(trimmed, [], collectionId);
      set((s) => ({
        envPacks: [
          ...s.envPacks,
          { id, name: trimmed, vars: [], collection_id: collectionId },
        ],
      }));
      openPack(id);
    },

    renameEnvPack: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await db.envPacks.rename(id, trimmed);
      set((s) => ({
        envPacks: s.envPacks.map((p) =>
          p.id === id ? { ...p, name: trimmed } : p,
        ),
      }));
    },

    deleteEnvPack: async (id) => {
      await db.envPacks.remove(id);
      set((s) => ({
        envPacks: s.envPacks.filter((p) => p.id !== id),
        // the FK is ON DELETE SET NULL — mirror that in memory so a collection
        // doesn't keep pointing at a pack that no longer exists
        collections: s.collections.map((c) =>
          c.pack_id === id ? { ...c, pack_id: null } : c,
        ),
      }));
      if (get().editingPackId === id) openPack(usableEnvPacks(get())[0]?.id ?? null);
    },

    toggleEnvPackScope: async (id) => {
      const pack = get().envPacks.find((p) => p.id === id);
      if (!pack) return;
      const collectionId =
        pack.collection_id === null ? get().currentCollectionId : null;
      // "bind to collection" needs a collection to bind to
      if (pack.collection_id === null && collectionId === null) return;

      await db.envPacks.setCollection(id, collectionId);
      set((s) => ({
        envPacks: s.envPacks.map((p) =>
          p.id === id ? { ...p, collection_id: collectionId } : p,
        ),
      }));
    },

    activateEnvPack: async (id) => {
      const collectionId = get().currentCollectionId;
      if (collectionId === null) return;
      // Apply implies Save — the pack takes effect exactly as shown
      if (get().editingPackId === id) await get().saveDraftVars();
      await db.collections.setPack(collectionId, id);
      set((s) => ({
        collections: s.collections.map((c) =>
          c.id === collectionId ? { ...c, pack_id: id } : c,
        ),
      }));
    },
  };
}
