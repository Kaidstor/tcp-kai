// UI chrome: palette, dialogs (confirm/prompt/env/settings), toast, theme and
// the editor split.
import { db } from "../../db";
import { applyTheme } from "../../themes";
import type { AppSettings } from "../../types";
import type {
  ConfirmRequest,
  Get,
  PaletteKind,
  PromptRequest,
  Set,
  Toast,
} from "../types";

export interface UiSlice {
  palette: PaletteKind | null;
  /** Pending confirm dialog; null when closed (see confirmDialog). */
  confirm: ConfirmRequest | null;
  /** Pending prompt dialog; null when closed (see promptDialog). */
  prompt: PromptRequest | null;
  toast: Toast | null;
  envConfigOpen: boolean;
  settingsOpen: boolean;
  /** Диалог импорта контракта; string — предзаполненный путь (drag&drop). */
  importOpen: boolean;
  importPath: string;
  /** Диалог раннера (прогон выбранных запросов коллекции). */
  runnerOpen: boolean;
  /** Contents of the `settings` table that the UI cares about. */
  settings: AppSettings;
  /** Request-editor height, % of the editor split (20–80). */
  editorPct: number;

  setPalette: (palette: PaletteKind | null) => void;
  setEnvConfigOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openImport: (path?: string) => void;
  closeImport: () => void;
  setRunnerOpen: (open: boolean) => void;
  setEditorPct: (pct: number) => void;
  /** Applies the theme immediately and persists it to the settings table. */
  setTheme: (id: string) => Promise<void>;
  /** Пишет ключи настроек в стор и в settings-таблицу. */
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  showToast: (message: string, kind?: Toast["kind"]) => void;
  /** Opens the in-app confirm dialog; resolves true on confirm, false on
   *  cancel/Esc/backdrop. Replaces window.confirm(), which doesn't block in
   *  the Tauri webview. */
  confirmDialog: (req: ConfirmRequest) => Promise<boolean>;
  /** ConfirmDialog's buttons report the outcome here. */
  resolveConfirm: (ok: boolean) => void;
  /** Opens the single-field prompt; resolves to the trimmed value, or null
   *  when cancelled. */
  promptDialog: (req: PromptRequest) => Promise<string | null>;
  /** PromptDialog reports the outcome here. */
  resolvePrompt: (value: string | null) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// Resolvers of the open dialog promises — kept outside the store so its state
// stays serializable.
let confirmResolve: ((ok: boolean) => void) | null = null;
let promptResolve: ((value: string | null) => void) | null = null;

export function createUiSlice(set: Set, get: Get): UiSlice {
  return {
    palette: null,
    confirm: null,
    prompt: null,
    toast: null,
    envConfigOpen: false,
    settingsOpen: false,
    importOpen: false,
    importPath: "",
    runnerOpen: false,
    settings: {},
    editorPct: 50,

    setPalette: (palette) => set({ palette }),
    setEnvConfigOpen: (envConfigOpen) => set({ envConfigOpen }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    openImport: (path) => set({ importOpen: true, importPath: path ?? "" }),
    closeImport: () => set({ importOpen: false, importPath: "" }),
    setRunnerOpen: (runnerOpen) => set({ runnerOpen }),
    // Pane snapping/min-height are enforced in EditorSplit; here we only guard
    // the raw range so a bad percentage can never escape [0, 100].
    setEditorPct: (pct) => set({ editorPct: Math.min(Math.max(pct, 0), 100) }),

    setTheme: async (id) => {
      applyTheme(id);
      set({ settings: { ...get().settings, theme: id } });
      try {
        await db.settings.set("theme", id);
      } catch (e) {
        // theme is applied for this session; only the persistence failed
        get().showToast(`Тема не сохранена: ${String(e)}`);
      }
    },

    updateSettings: async (patch) => {
      set({ settings: { ...get().settings, ...patch } });
      try {
        for (const [key, value] of Object.entries(patch)) {
          await db.settings.set(key, value === undefined ? null : String(value));
        }
      } catch (e) {
        get().showToast(`Настройка не сохранена: ${String(e)}`);
      }
    },

    showToast: (message, kind = "error") => {
      set({ toast: { message, kind } });
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => set({ toast: null }), 6000);
    },

    confirmDialog: (req) => {
      confirmResolve?.(false); // a newer request cancels the one still open
      return new Promise<boolean>((resolve) => {
        confirmResolve = resolve;
        set({ confirm: req });
      });
    },

    resolveConfirm: (ok) => {
      set({ confirm: null });
      const resolve = confirmResolve;
      confirmResolve = null;
      resolve?.(ok);
    },

    promptDialog: (req) => {
      promptResolve?.(null);
      return new Promise<string | null>((resolve) => {
        promptResolve = resolve;
        set({ prompt: req });
      });
    },

    resolvePrompt: (value) => {
      set({ prompt: null });
      const resolve = promptResolve;
      promptResolve = null;
      resolve?.(value);
    },
  };
}
