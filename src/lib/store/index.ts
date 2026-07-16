// Store assembly: one zustand store composed from domain slices (see
// slices/*). Consumers import useApp and the selectors from here.
import { create } from "zustand";
import { createCollectionsSlice } from "./slices/collections";
import { createEnvSlice } from "./slices/env";
import { createHistorySlice } from "./slices/history";
import { createRequestsSlice } from "./slices/requests";
import { createRunnerSlice } from "./slices/runner";
import { createSendSlice } from "./slices/send";
import { createUiSlice } from "./slices/ui";
import type { AppStore } from "./types";

export const useApp = create<AppStore>((set, get) => ({
  ...createUiSlice(set, get),
  ...createCollectionsSlice(set, get),
  ...createRequestsSlice(set, get),
  ...createEnvSlice(set, get),
  ...createHistorySlice(set, get),
  ...createSendSlice(set, get),
  ...createRunnerSlice(set, get),
}));

export {
  activePack,
  activeVars,
  currentCollection,
  currentRequest,
  editingPack,
  envDirty,
  isSending,
  usableEnvPacks,
} from "./selectors";
export type { Draft } from "./slices/send";
export type {
  AppStore,
  ConfirmRequest,
  PaletteKind,
  PromptRequest,
  Toast,
} from "./types";

// HMR would re-create the store with empty state (init() doesn't re-run) —
// reload instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
