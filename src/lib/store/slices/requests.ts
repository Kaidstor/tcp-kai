// Requests of the open collection. Opening one seeds the editors (send slice)
// and its history — the two always move together, so it happens here.
import { db } from "../../db";
import type { RequestItem } from "../../types";
import { formatJson } from "../../utils";
import type { Get, Set } from "../types";

/** Seeded into every new request — the usual NestJS microservice address,
 *  resolved from the collection's env pack. */
const DEFAULT_URL = "{{host}}:{{port}}";

export interface RequestsSlice {
  requests: RequestItem[];
  currentRequestId: number | null;

  loadRequests: (collectionId: number) => Promise<void>;
  /** Opens a request: editors get its last exchange (or the saved body), and
   *  the history list is refreshed. */
  selectRequest: (id: number) => Promise<void>;
  /** Closes the open request and clears the editors. */
  clearRequest: () => void;
  createRequest: (cmd: string) => Promise<void>;
  deleteRequest: (id: number) => Promise<void>;
}

export function createRequestsSlice(set: Set, get: Get): RequestsSlice {
  return {
    requests: [],
    currentRequestId: null,

    loadRequests: async (collectionId) => {
      set({ requests: await db.requests.byCollection(collectionId) });
    },

    selectRequest: async (id) => {
      const request = get().requests.find((r) => r.id === id);
      if (!request) return;
      set({ currentRequestId: id });
      void db.settings.set("last_request_id", id);

      const latest = await db.history.latestByRequest(id);
      // a fast switch to another request while this history was loading wins
      if (get().currentRequestId !== id) return;

      get().setDraft({
        url: request.url,
        cmd: request.cmd,
        // last exchange if there is one, else the saved body
        body: latest ? latest.sent : formatJson(request.body || "{}"),
        received: latest?.received ?? "",
      });
      set({
        statusText: "Ready",
        requestTime: latest?.execution_time ?? null,
      });
      await get().loadHistory(id);
    },

    clearRequest: () => {
      set({ currentRequestId: null, history: [] });
      get().resetDraft();
    },

    createRequest: async (cmd) => {
      const name = cmd.trim();
      const collectionId = get().currentCollectionId;
      if (!name || collectionId === null) return;

      const request = {
        collection_id: collectionId,
        name,
        url: DEFAULT_URL,
        cmd: name,
        body: "{}",
      };
      const id = await db.requests.add(request);
      set((s) => ({ requests: [...s.requests, { ...request, id, weight: null }] }));
      await get().selectRequest(id);
    },

    deleteRequest: async (id) => {
      await db.requests.remove(id); // history cascades
      set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      if (get().currentRequestId === id) get().clearRequest();
    },
  };
}
