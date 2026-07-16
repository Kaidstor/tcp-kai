// Address + cmd + send/stop. The URL resolves `{{vars}}` against the
// collection's env pack; both fields are saved on send. Плюс режим события
// (@EventPattern) и превью кадра — GUI-аналог `tcp-kai --dry-run`.
import { Eye, SendHorizontal, Square, Zap } from "lucide-react";
import { useState } from "react";
import { activeVars, isSending, useApp } from "../lib/store";
import { processEnvVars } from "../lib/utils";
import { EnvVarInput } from "./EnvVarInput";
import { IconButton, Input, Overlay, cn } from "./ui";

/** Кадр, который соберёт бэкенд (src-tauri/src/tcp.rs::build_frame). */
function buildFramePreview(pattern: string, body: string, emit: boolean): string {
  let data: unknown = null;
  const trimmed = body.trim();
  if (trimmed) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null; // как на проводе: не-JSON уезжает null'ом
    }
  }
  const payload = emit
    ? { pattern, data }
    : { pattern, data, id: "unique_id_12345" };
  const json = JSON.stringify(payload);
  return `${[...json].length}#${json}`;
}

export function RequestBar() {
  const draft = useApp((s) => s.draft);
  const patchDraft = useApp((s) => s.patchDraft);
  const vars = useApp(activeVars);
  const sending = useApp(isSending);
  const send = useApp((s) => s.send);
  const stop = useApp((s) => s.stop);
  const setEmitFlag = useApp((s) => s.setEmitFlag);
  const [preview, setPreview] = useState<string | null>(null);

  const openPreview = () => {
    const connection = processEnvVars(draft.url, vars);
    const body = processEnvVars(draft.body, vars);
    const frame = buildFramePreview(draft.cmd, body, draft.emit);
    setPreview(`→ ${connection}\n\n${frame}`);
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-zinc-800 bg-zinc-900 p-2">
      <EnvVarInput
        value={draft.url}
        onChange={(url) => patchDraft({ url })}
        envVars={vars}
        placeholder="host:port"
      />
      <Input
        value={draft.cmd}
        placeholder="CMD"
        className="font-mono"
        onChange={(e) => patchDraft({ cmd: e.target.value })}
      />
      <div className="flex items-center gap-1">
        <IconButton
          title={
            draft.emit
              ? "Event-паттерн: кадр без id, ответ не ожидается (выключить)"
              : "Отправлять как событие (@EventPattern)"
          }
          onClick={() => void setEmitFlag(!draft.emit)}
          className={cn(draft.emit && "bg-amber-500/15 text-amber-400")}
        >
          <Zap size={14} />
        </IconButton>
        <IconButton title="Превью кадра (с подстановкой переменных)" onClick={openPreview}>
          <Eye size={14} />
        </IconButton>
        <button
          onClick={() => (sending ? stop() : void send())}
          title={sending ? "Остановить" : "Отправить (⌘↵)"}
          className={cn(
            "inline-flex items-center justify-center rounded-md px-3 py-1 transition-colors",
            sending
              ? "bg-zinc-800 text-red-400 hover:bg-zinc-700"
              : "bg-sky-600 text-white hover:bg-sky-500",
          )}
        >
          {sending ? <Square size={14} /> : <SendHorizontal size={14} />}
        </button>
      </div>

      {preview !== null && (
        <Overlay
          onClose={() => setPreview(null)}
          closeOnEsc
          className="items-start bg-black/60 pt-[16vh]"
        >
          <div className="w-[40rem] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <h2 className="mb-1 text-[14px] font-semibold text-zinc-100">
              Кадр NestJS-транспорта
            </h2>
            <p className="mb-3 text-[11px] text-zinc-500">
              Что уедет на провод после подстановки переменных — в сеть ничего
              не отправлено. Переменные из sec здесь не резолвятся.
            </p>
            <pre className="max-h-[50vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] whitespace-pre-wrap break-all text-zinc-300">
              {preview}
            </pre>
          </div>
        </Overlay>
      )}
    </div>
  );
}
