// Requests of the open collection. Opening one seeds the editors (send slice)
// and its history — the two always move together, so it happens here.
import { db } from "../../db";
import type { RequestItem } from "../../types";
import { decayedWeight, formatJson } from "../../utils";
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
  renameRequest: (id: number, name: string) => Promise<void>;
  /** Копия запроса (url/cmd/body/emit) под именем «… (копия)». */
  duplicateRequest: (id: number) => Promise<void>;
  deleteRequest: (id: number) => Promise<void>;
  /** Массовое создание запросов по cmd-паттернам из контракта; уже
   *  существующие (по cmd или имени) пропускаются. Возвращает создано/пропущено. */
  importCmds: (values: string[]) => Promise<{ created: number; skipped: number }>;
  /** Переключает event-режим открытого запроса и сразу сохраняет его. */
  setEmitFlag: (emit: boolean) => Promise<void>;
}

export function createRequestsSlice(set: Set, get: Get): RequestsSlice {
  return {
    requests: [],
    currentRequestId: null,

    loadRequests: async (collectionId) => {
      // most-used first: frecency-вес с учётом распада; сортировка здесь,
      // а не в SQL — pow() есть не во всех сборках SQLite
      const rows = await db.requests.byCollection(collectionId);
      const now = Date.now();
      const score = new Map(
        rows.map((r) => [r.id, decayedWeight(r.weight, r.last_used_at, now)]),
      );
      rows.sort(
        (a, b) =>
          score.get(b.id)! - score.get(a.id)! || a.name.localeCompare(b.name),
      );
      set({ requests: rows });
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
        emit: request.emit === 1,
      });
      set({
        statusText: "Ready",
        requestTime: latest?.execution_time ?? null,
        lastOk: latest ? latest.ok === 1 : null,
        showRaw: false,
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
        emit: 0,
      };
      const id = await db.requests.add(request);
      set((s) => ({
        requests: [
          ...s.requests,
          { ...request, id, weight: null, last_used_at: null },
        ],
      }));
      await get().selectRequest(id);
    },

    renameRequest: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await db.requests.rename(id, trimmed);
      set((s) => ({
        requests: s.requests.map((r) =>
          r.id === id ? { ...r, name: trimmed } : r,
        ),
      }));
    },

    duplicateRequest: async (id) => {
      const source = get().requests.find((r) => r.id === id);
      if (!source) return;
      // «cmd (копия)», «cmd (копия 2)», … — пока имя не освободится
      const taken = new Set(get().requests.map((r) => r.name));
      let name = `${source.name} (копия)`;
      for (let n = 2; taken.has(name); n++) name = `${source.name} (копия ${n})`;

      const request = {
        collection_id: source.collection_id,
        name,
        url: source.url,
        cmd: source.cmd,
        body: source.body,
        emit: source.emit,
      };
      const newId = await db.requests.add(request);
      set((s) => ({
        requests: [
          ...s.requests,
          { ...request, id: newId, weight: null, last_used_at: null },
        ],
      }));
      await get().selectRequest(newId);
    },

    deleteRequest: async (id) => {
      await db.requests.remove(id); // history cascades
      set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      if (get().currentRequestId === id) get().clearRequest();
    },

    importCmds: async (values) => {
      const collectionId = get().currentCollectionId;
      if (collectionId === null) return { created: 0, skipped: 0 };

      const existing = get().requests;
      const known = (value: string) =>
        existing.some((r) => r.cmd === value || r.name === value);

      let created = 0;
      let skipped = 0;
      const added: RequestItem[] = [];
      for (const raw of values) {
        const value = raw.trim();
        if (!value || known(value) || added.some((r) => r.cmd === value)) {
          skipped++;
          continue;
        }
        const request = {
          collection_id: collectionId,
          name: value,
          url: DEFAULT_URL,
          cmd: value,
          body: "{}",
          emit: 0,
        };
        const id = await db.requests.add(request);
        added.push({ ...request, id, weight: null, last_used_at: null });
        created++;
      }
      if (added.length > 0) {
        set((s) => ({ requests: [...s.requests, ...added] }));
      }
      return { created, skipped };
    },

    setEmitFlag: async (emit) => {
      const request = get().requests.find((r) => r.id === get().currentRequestId);
      if (!request) return;
      const draft = get().draft;
      get().patchDraft({ emit });
      try {
        await db.requests.update(request.id, {
          name: request.name,
          url: draft.url,
          cmd: draft.cmd,
          body: draft.body,
          emit: emit ? 1 : 0,
        });
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === request.id
              ? { ...r, url: draft.url, cmd: draft.cmd, body: draft.body, emit: emit ? 1 : 0 }
              : r,
          ),
        }));
      } catch (e) {
        get().showToast(`Не сохранил режим события: ${String(e)}`);
      }
    },
  };
}
