// The exchange itself: the editors' working copy (draft), the TCP round-trip
// through the Rust command, and what a successful send records — history
// entry, usage weight, and the request's saved url/cmd/body.
import { api, errText, parseApiResponse } from "../../api";
import { db } from "../../db";
import { formatJson, processEnvVars, secs } from "../../utils";
import { activeVars } from "../selectors";
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
}

const EMPTY_DRAFT: Draft = { url: "", cmd: "", body: "", received: "" };

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

  setDraft: (draft: Draft) => void;
  patchDraft: (patch: Partial<Draft>) => void;
  resetDraft: () => void;
  send: () => Promise<void>;
  /** Cancels the in-flight request; the backend drops the connection. */
  stop: () => void;
}

// Start of the in-flight exchange (performance.now()); only one runs at a time.
let startedAt = 0;

export function createSendSlice(set: Set, get: Get): SendSlice {
  return {
    draft: EMPTY_DRAFT,
    sendingId: null,
    statusText: "Ready",
    requestTime: null,

    setDraft: (draft) => set({ draft }),
    patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
    resetDraft: () =>
      set({ draft: EMPTY_DRAFT, statusText: "Ready", requestTime: null }),

    send: async () => {
      const requestId = get().currentRequestId;
      const request = get().requests.find((r) => r.id === requestId);
      if (!request || get().sendingId) return;

      // snapshot: this is the payload being sent, and what gets saved —
      // edits made while it's in flight belong to the next send
      const draft = get().draft;
      const vars = activeVars(get());
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
          connection: processEnvVars(draft.url, vars),
          pattern: draft.cmd,
          json: processEnvVars(draft.body, vars),
          requestId: sendId,
        });
        if (superseded()) return;

        const ms = performance.now() - startedAt;
        const response = parseApiResponse(raw);

        if (!response.ok) {
          if (stillOpen()) {
            get().patchDraft({ received: "" });
            set({
              requestTime: ms,
              statusText: `Error in ${secs(ms)}: ${response.message}`,
            });
          }
          get().showToast(response.message);
          return;
        }

        const received = formatJson(response.message);
        if (stillOpen()) {
          get().patchDraft({ received });
          set({ requestTime: ms, statusText: `Done in ${secs(ms)}` });
        }

        const historyId = await db.history.add({
          request_id: request.id,
          sent: draft.body, // stored with {{vars}} intact, like the editor shows
          received,
          execution_time: ms,
        });
        await db.requests.decayWeights();
        await db.requests.bumpWeight(request.id);
        set((s) => ({
          // `history` belongs to whatever request is open now — if the user
          // moved on mid-flight, this entry isn't part of that list
          history:
            s.currentRequestId === request.id
              ? [
                  {
                    id: historyId,
                    timestamp: new Date().toISOString(),
                    execution_time: ms,
                  },
                  ...s.history,
                ]
              : s.history,
          // mirror the weight SQL exactly (decay all, bump the sent one); the
          // list keeps its order until reloaded, so rows don't jump around
          // under the cursor mid-session
          requests: s.requests.map((r) =>
            r.id === request.id
              ? { ...r, weight: (decay(r.weight) ?? 0) + 1 }
              : { ...r, weight: decay(r.weight) },
          ),
        }));
      } catch (e) {
        // a cancel rejects the invoke — stop() already owns the status line
        if (superseded()) return;
        const ms = performance.now() - startedAt;
        if (stillOpen()) set({ requestTime: ms, statusText: `Failed in ${secs(ms)}` });
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
          })
          .then(() =>
            set((s) => ({
              requests: s.requests.map((r) =>
                r.id === request.id
                  ? { ...r, url: draft.url, cmd: draft.cmd, body: draft.body }
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
      set({ sendingId: null, requestTime: ms, statusText: `Stopped in ${secs(ms)}` });
    },
  };
}
