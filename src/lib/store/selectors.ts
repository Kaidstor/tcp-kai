// Derived views over the store. Kept as plain functions (not state) so there
// is exactly one source of truth for each fact; components pass them to
// useApp(), slices call them with get().
//
// zustand v5 feeds a selector straight to useSyncExternalStore, which compares
// results with Object.is — a selector that allocates on every call makes React
// throw "getSnapshot should be cached". So: return references out of state
// where possible, and wrap the ones that must allocate (usableEnvPacks) in
// useShallow at the call site.
import type { EnvPack, EnvVar, RequestItem } from "../types";
import type { AppStore } from "./types";

/** Stable identity for "no variables" — a fresh [] would re-render forever. */
const NO_VARS: EnvVar[] = [];

export const currentCollection = (s: AppStore) =>
  s.collections.find((c) => c.id === s.currentCollectionId);

export const currentRequest = (s: AppStore): RequestItem | undefined =>
  s.requests.find((r) => r.id === s.currentRequestId);

/** Pack applied to the open collection — the one substitution reads. */
export const activePack = (s: AppStore): EnvPack | null => {
  const packId = currentCollection(s)?.pack_id;
  return s.envPacks.find((p) => p.id === packId) ?? null;
};

export const activeVars = (s: AppStore): EnvVar[] => activePack(s)?.vars ?? NO_VARS;

/** Packs the open collection may use: global ones plus its own.
 *  Allocates — pass through useShallow when selecting it in a component. */
export const usableEnvPacks = (s: AppStore): EnvPack[] =>
  s.envPacks.filter(
    (p) => p.collection_id === null || p.collection_id === s.currentCollectionId,
  );

/** Pack open in the env dialog. */
export const editingPack = (s: AppStore): EnvPack | null =>
  s.envPacks.find((p) => p.id === s.editingPackId) ?? null;

/** The env dialog holds unsaved variable edits. */
export const envDirty = (s: AppStore): boolean => {
  const pack = editingPack(s);
  return pack ? JSON.stringify(pack.vars) !== JSON.stringify(s.draftVars) : false;
};

export const isSending = (s: AppStore): boolean => s.sendingId !== null;
