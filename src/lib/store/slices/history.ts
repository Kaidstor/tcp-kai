// Per-request exchange log. The list is payload-free; the full sent/received
// pair is fetched only when an entry is opened.
import { db } from "../../db";
import type { HistoryListItem } from "../../types";
import { secs } from "../../utils";
import type { Get, Set } from "../types";

export interface HistorySlice {
  /** History of the open request, newest first. */
  history: HistoryListItem[];

  loadHistory: (requestId: number) => Promise<void>;
  /** Loads an entry's payloads back into the editors. */
  openHistoryItem: (id: number) => Promise<void>;
  deleteHistoryItem: (id: number) => Promise<void>;
}

export function createHistorySlice(set: Set, get: Get): HistorySlice {
  return {
    history: [],

    loadHistory: async (requestId) => {
      const history = await db.history.listByRequest(requestId);
      // the user may have switched requests while this was loading
      if (get().currentRequestId !== requestId) return;
      set({ history });
    },

    openHistoryItem: async (id) => {
      try {
        const entry = await db.history.byId(id);
        if (!entry) return;
        get().patchDraft({ body: entry.sent, received: entry.received });
        set({
          requestTime: entry.execution_time,
          statusText: entry.execution_time
            ? `Completed in ${secs(entry.execution_time)}`
            : "Done",
        });
      } catch (e) {
        get().showToast(`Не удалось загрузить историю: ${String(e)}`);
      }
    },

    deleteHistoryItem: async (id) => {
      await db.history.remove(id);
      set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
    },
  };
}
