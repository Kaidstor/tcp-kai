// Прогон нескольких запросов коллекции подряд (smoke после деплоя): каждый
// резолвится текущим паком и шлётся с таймаутом настроек. Результаты живут
// только в диалоге раннера — историю запросов прогон не засоряет.
import { api, errText, parseApiResponse } from "../../api";
import { DEFAULT_TIMEOUT_SECS } from "../../types";
import { parseEnvelope, processEnvVars } from "../../utils";
import { activeVars } from "../selectors";
import type { Get, Set } from "../types";

export interface RunnerResult {
  status: "running" | "ok" | "err";
  ms?: number;
  /** Короткий итог: текст ошибки или err из конверта. */
  message?: string;
}

export interface RunnerSlice {
  /** requestId → исход; пусто до первого прогона. */
  runnerResults: Record<number, RunnerResult>;
  runnerBusy: boolean;

  runRequests: (ids: number[]) => Promise<void>;
  stopRunner: () => void;
  resetRunner: () => void;
}

// Отмена между запросами и id летящего обмена — вне стора, им незачем рендер.
let cancelRequested = false;
let inFlightId: string | null = null;

export function createRunnerSlice(set: Set, get: Get): RunnerSlice {
  return {
    runnerResults: {},
    runnerBusy: false,

    runRequests: async (ids) => {
      if (get().runnerBusy) return;
      cancelRequested = false;
      set({ runnerBusy: true, runnerResults: {} });

      const timeoutSecs = get().settings.timeout_secs ?? DEFAULT_TIMEOUT_SECS;

      for (const id of ids) {
        if (cancelRequested) break;
        const request = get().requests.find((r) => r.id === id);
        if (!request) continue;

        set((s) => ({
          runnerResults: { ...s.runnerResults, [id]: { status: "running" } },
        }));

        // переменные берутся на момент каждого запроса — как при ручной отправке
        const vars = activeVars(get());
        const started = performance.now();
        const sendId = `runner-${id}-${Date.now()}`;
        inFlightId = sendId;

        let result: RunnerResult;
        try {
          const raw = await api.sendTcpRequest({
            connection: processEnvVars(request.url, vars),
            pattern: request.cmd,
            json: processEnvVars(request.body, vars),
            requestId: sendId,
            timeoutMs: timeoutSecs * 1000,
            emit: request.emit === 1,
          });
          const ms = performance.now() - started;
          const response = parseApiResponse(raw);
          if (!response.ok) {
            result = { status: "err", ms, message: response.message };
          } else {
            // err в конверте — сервис ответил, но ответил ошибкой
            const envelope = parseEnvelope(response.message);
            if (envelope && envelope.err !== null && envelope.err !== undefined) {
              result = {
                status: "err",
                ms,
                message: JSON.stringify(envelope.err),
              };
            } else {
              result = { status: "ok", ms };
            }
          }
        } catch (e) {
          result = {
            status: "err",
            ms: performance.now() - started,
            message: errText(e),
          };
        }
        inFlightId = null;

        set((s) => ({ runnerResults: { ...s.runnerResults, [id]: result } }));
      }

      set({ runnerBusy: false });
    },

    stopRunner: () => {
      cancelRequested = true;
      if (inFlightId) void api.cancelTcpRequest(inFlightId);
    },

    resetRunner: () => {
      cancelRequested = true;
      set({ runnerResults: {}, runnerBusy: false });
    },
  };
}
