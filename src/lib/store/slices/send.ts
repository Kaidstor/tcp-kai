// The exchange itself: the editors' working copy (draft), the TCP round-trip
// through the Rust command, and what a send records — history entry (both
// outcomes), usage weight, and the request's saved url/cmd/body/emit.
import { api, errText, parseApiResponse } from "../../api";
import { db } from "../../db";
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TIMEOUT_SECS,
} from "../../types";
import {
  formatJson,
  isInvalidJsonBody,
  isProdPack,
  isWriteCmd,
  processEnvVars,
  secs,
} from "../../utils";
import { activePack, activeVars } from "../selectors";
import type { Get, Set } from "../types";

/** What the request bar and the two editors show. Belongs to the open
 *  request but is only written back to the DB on send. */
export interface Draft {
  url: string;
  cmd: string;
  /** Request body, `{{vars}}` unresolved — that's what gets saved. */
  body: string;
  /** Pretty-printed response, or "" before the first send. */
  received: string;
  /** Event-паттерн: кадр без id, ответ не ожидается. */
  emit: boolean;
}

export const EMPTY_DRAFT: Draft = {
  url: "",
  cmd: "",
  body: "",
  received: "",
  emit: false,
};

/** −10%, matching the SQL in db.requests.decayWeights. */
const decay = (weight: number | null) =>
  weight && weight > 0 ? Math.floor((weight * 9) / 10) : weight;

export interface SendSlice {
  draft: Draft;
  /** Id of the in-flight request; null when idle. */
  sendingId: string | null;
  statusText: string;
  /** Duration of the last exchange, ms; null while none has run. */
  requestTime: number | null;
  /** Исход показанного обмена (для бейджа ответа); null — ещё не было. */
  lastOk: boolean | null;
  /** Панель ответа показывает сырой конверт, а не развёрнутый response. */
  showRaw: boolean;

  setDraft: (draft: Draft) => void;
  patchDraft: (patch: Partial<Draft>) => void;
  resetDraft: () => void;
  setShowRaw: (showRaw: boolean) => void;
  send: () => Promise<void>;
  /** Cancels the in-flight request; the backend drops the connection. */
  stop: () => void;
}

// Start of the in-flight exchange (performance.now()); only one runs at a time.
let startedAt = 0;

export function createSendSlice(set: Set, get: Get): SendSlice {
  /** Пишет обмен в историю (+ хвост сверх лимита) и отражает его в сторе. */
  const record = async (args: {
    requestId: number;
    sent: string;
    received: string;
    ms: number;
    ok: boolean;
    cmd: string;
    url: string;
    pack: string | null;
  }) => {
    const historyId = await db.history.add({
      request_id: args.requestId,
      sent: args.sent,
      received: args.received,
      execution_time: args.ms,
      ok: args.ok ? 1 : 0,
      cmd: args.cmd,
      url: args.url,
      pack: args.pack,
    });
    const limit = get().settings.history_limit ?? DEFAULT_HISTORY_LIMIT;
    const pruned = await db.history.prune(args.requestId, limit);
    await db.requests.decayWeights();
    await db.requests.bumpWeight(args.requestId);
    set((s) => ({
      // `history` belongs to whatever request is open now — if the user
      // moved on mid-flight, this entry isn't part of that list
      history:
        s.currentRequestId === args.requestId
          ? [
              {
                id: historyId,
                timestamp: new Date().toISOString(),
                execution_time: args.ms,
                ok: args.ok ? 1 : 0,
                pack: args.pack,
              },
              ...s.history.filter((h) => !pruned.includes(h.id)),
            ]
          : s.history,
      // mirror the weight SQL exactly (decay all, bump the sent one); the
      // list keeps its order until reloaded, so rows don't jump around
      // under the cursor mid-session
      requests: s.requests.map((r) =>
        r.id === args.requestId
          ? { ...r, weight: (decay(r.weight) ?? 0) + 1 }
          : { ...r, weight: decay(r.weight) },
      ),
    }));
  };

  return {
    draft: EMPTY_DRAFT,
    sendingId: null,
    statusText: "Ready",
    requestTime: null,
    lastOk: null,
    showRaw: false,

    setDraft: (draft) => set({ draft }),
    patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
    resetDraft: () =>
      set({
        draft: EMPTY_DRAFT,
        statusText: "Ready",
        requestTime: null,
        lastOk: null,
      }),
    setShowRaw: (showRaw) => set({ showRaw }),

    send: async () => {
      const requestId = get().currentRequestId;
      const request = get().requests.find((r) => r.id === requestId);
      if (!request || get().sendingId) return;

      // snapshot: this is the payload being sent, and what gets saved —
      // edits made while it's in flight belong to the next send
      const draft = get().draft;
      const vars = activeVars(get());
      const pack = activePack(get());

      // непустое не-JSON тело кадр молча превратит в data: null — спросить
      if (isInvalidJsonBody(draft.body)) {
        const ok = await get().confirmDialog({
          title: "Тело — не JSON",
          message:
            "NestJS-транспорт отправит data: null вместо тела. Отправить всё равно?",
          confirmLabel: "Отправить null",
        });
        if (!ok) return;
      }

      // write-паттерн на боевой пак — то, о чём предупреждает skills/tcp-kai
      if (isProdPack(pack?.name) && isWriteCmd(draft.cmd)) {
        const ok = await get().confirmDialog({
          title: `Запись на «${pack?.name}»`,
          message: `cmd «${draft.cmd}» похож на изменение данных, а пак «${pack?.name}» — на боевой стенд.`,
          confirmLabel: "Отправить",
          danger: true,
        });
        if (!ok) return;
      }

      const timeoutSecs = get().settings.timeout_secs ?? DEFAULT_TIMEOUT_SECS;
      const connection = processEnvVars(draft.url, vars);
      const sendId = String(Date.now());
      startedAt = performance.now();
      set({ sendingId: sendId, statusText: "Sending...", requestTime: null });

      /** True once stop() or a newer send has taken over. */
      const superseded = () => get().sendingId !== sendId;
      /** The request is still the one on screen — otherwise the editors and
       *  the status line belong to something else and must not be touched. */
      const stillOpen = () => get().currentRequestId === request.id;

      try {
        const raw = await api.sendTcpRequest({
          connection,
          pattern: draft.cmd,
          json: processEnvVars(draft.body, vars),
          requestId: sendId,
          timeoutMs: timeoutSecs * 1000,
          emit: draft.emit,
        });
        if (superseded()) return;

        const ms = performance.now() - startedAt;
        const response = parseApiResponse(raw);

        if (!response.ok) {
          if (stillOpen()) {
            get().patchDraft({ received: "" });
            set({
              requestTime: ms,
              lastOk: false,
              statusText: `Error in ${secs(ms)}: ${response.message}`,
            });
          }
          get().showToast(response.message);
          // ошибка тоже история: «что я послал, когда упало»
          await record({
            requestId: request.id,
            sent: draft.body,
            received: response.message,
            ms,
            ok: false,
            cmd: draft.cmd,
            url: connection,
            pack: pack?.name ?? null,
          });
          return;
        }

        const received = draft.emit ? "" : formatJson(response.message);
        if (stillOpen()) {
          get().patchDraft({ received });
          set({
            requestTime: ms,
            lastOk: true,
            statusText: draft.emit
              ? `Event sent in ${secs(ms)}`
              : `Done in ${secs(ms)}`,
          });
        }

        await record({
          requestId: request.id,
          sent: draft.body, // stored with {{vars}} intact, like the editor shows
          received,
          ms,
          ok: true,
          cmd: draft.cmd,
          url: connection,
          pack: pack?.name ?? null,
        });
      } catch (e) {
        // a cancel rejects the invoke — stop() already owns the status line
        if (superseded()) return;
        const ms = performance.now() - startedAt;
        if (stillOpen())
          set({ requestTime: ms, lastOk: false, statusText: `Failed in ${secs(ms)}` });
        get().showToast(errText(e));
      } finally {
        if (!superseded()) set({ sendingId: null });
        // persist what was sent, whatever the outcome
        await db.requests
          .update(request.id, {
            name: request.name,
            url: draft.url,
            cmd: draft.cmd,
            body: draft.body,
            emit: draft.emit ? 1 : 0,
          })
          .then(() =>
            set((s) => ({
              requests: s.requests.map((r) =>
                r.id === request.id
                  ? {
                      ...r,
                      url: draft.url,
                      cmd: draft.cmd,
                      body: draft.body,
                      emit: draft.emit ? 1 : 0,
                    }
                  : r,
              ),
            })),
          )
          .catch(() => {
            // the exchange itself succeeded; a failed save shouldn't erase it
          });
      }
    },

    stop: () => {
      const sendId = get().sendingId;
      if (!sendId) return;
      void api.cancelTcpRequest(sendId);
      const ms = performance.now() - startedAt;
      set({
        sendingId: null,
        requestTime: ms,
        lastOk: false,
        statusText: `Stopped in ${secs(ms)}`,
      });
    },
  };
}
