// Types shared by the slices and by consumers outside the store. AppStore is
// assembled at the bottom from the slice interfaces — each slice file owns
// its own contract.
import type { StoreApi } from "zustand";
import type { CollectionsSlice } from "./slices/collections";
import type { EnvSlice } from "./slices/env";
import type { HistorySlice } from "./slices/history";
import type { RequestsSlice } from "./slices/requests";
import type { RunnerSlice } from "./slices/runner";
import type { SendSlice } from "./slices/send";
import type { UiSlice } from "./slices/ui";

export interface Toast {
  message: string;
  kind: "error" | "info" | "success";
}

/** In-app confirm dialog request — window.confirm() doesn't block in the
 *  Tauri webview, so destructive actions go through confirmDialog() instead. */
export interface ConfirmRequest {
  title: string;
  message?: string;
  /** Confirm button label, default "Удалить". */
  confirmLabel?: string;
  /** Destructive action: the confirm button turns red. */
  danger?: boolean;
}

/** Single-field prompt (new collection / new request); resolves to the typed
 *  string, or null when cancelled. */
export interface PromptRequest {
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  initialValue?: string;
}

/** ⌘P opens the collection palette, ⌘K the request palette. */
export type PaletteKind = "collections" | "requests";

export type AppStore = UiSlice &
  CollectionsSlice &
  RequestsSlice &
  EnvSlice &
  HistorySlice &
  SendSlice &
  RunnerSlice;

/** Slice factories take these; every slice can reach the whole store via
 *  get(), which is how cross-slice actions (e.g. selecting a request seeding
 *  the editors) stay in one place. */
export type Set = StoreApi<AppStore>["setState"];
export type Get = StoreApi<AppStore>["getState"];
