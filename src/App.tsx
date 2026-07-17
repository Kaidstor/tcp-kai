import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Database } from "lucide-react";
import { useEffect } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorSplit } from "./components/EditorSplit";
import { EnvConfigDialog } from "./components/EnvConfigDialog";
import { EnvSwitcher } from "./components/EnvSwitcher";
import { HistoryMenu } from "./components/HistoryMenu";
import { ImportContractDialog } from "./components/ImportContractDialog";
import { Palette } from "./components/Palette";
import { PromptDialog } from "./components/PromptDialog";
import { RequestBar } from "./components/RequestBar";
import { RunnerDialog } from "./components/RunnerDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";
import { UpdateToast } from "./components/UpdateToast";
import { WhatsNewDialog } from "./components/WhatsNewDialog";
import { Kbd, MenuButton } from "./components/ui";
import { api } from "./lib/api";
import { activeVars, currentCollection, useApp } from "./lib/store";
import { initUpdater, useUpdater } from "./lib/updater";

/** Variables worth showing in the titlebar — the address the request goes to. */
const PINNED_VARS = ["host", "port"];

function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const collection = useApp(currentCollection);
  const currentRequestId = useApp((s) => s.currentRequestId);
  const vars = useApp(activeVars);
  const setPalette = useApp((s) => s.setPalette);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => initUpdater(), []);

  // Перетащенный в окно .ts-файл — это контракт: открываем импорт с путём.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const s = useApp.getState();
      if (s.currentCollectionId === null) return;
      const path = event.payload.paths.find((p) => p.endsWith(".ts"));
      if (path) s.openImport(path);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Пункты нативного меню (см. set_app_menu в src-tauri/src/lib.rs).
  useEffect(() => {
    const unlisteners = [
      listen("menu://settings", () => useApp.getState().setSettingsOpen(true)),
      listen("menu://check-updates", () =>
        void useUpdater.getState().checkForUpdates(true),
      ),
      listen("menu://install-cli", async () => {
        const s = useApp.getState();
        try {
          const path = await api.installCli();
          s.showToast(
            `CLI установлен: ${path}\nОткройте новый терминал и проверьте: tcp-kai -V`,
            "success",
          );
        } catch (e) {
          const msg = String(e);
          if (msg.includes("cancelled")) return; // отменил диалог пароля
          s.showToast(`Не удалось установить CLI:\n${msg}`);
        }
      }),
    ];
    return () => {
      for (const p of unlisteners) void p.then((fn) => fn());
    };
  }, []);

  // App-wide hotkeys. Editor-local ones (⌘↵ to send) are bound in JsonEditor;
  // this handler is the fallback for everywhere else.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === "p" && !e.shiftKey) {
        e.preventDefault();
        setPalette(s.palette === "collections" ? null : "collections");
      } else if (key === "k" && !e.shiftKey) {
        // the palette handles its own ⌘K (drill into a collection's actions)
        if (s.palette) return;
        e.preventDefault();
        setPalette("requests");
      } else if (key === "e" && !e.shiftKey) {
        e.preventDefault();
        s.openEnvConfig();
      } else if (key === "," && !e.shiftKey) {
        e.preventDefault();
        s.setSettingsOpen(!s.settingsOpen);
      } else if (e.key === "Enter") {
        // ⌘↵ from outside the editors (e.g. the cmd field)
        if (!s.sendingId && s.currentRequestId !== null) {
          e.preventDefault();
          void s.send();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setPalette]);

  const pinned = vars.filter((v) => PINNED_VARS.includes(v.key.toLowerCase()));

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-[13px] text-zinc-200 antialiased">
      {/* Titlebar — pl-20 clears the macOS traffic lights (overlay style) */}
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 pr-2 pl-20"
      >
        <MenuButton
          onClick={() => setPalette("collections")}
          title="Коллекции (⌘P)"
        >
          <span className="max-w-[220px] truncate">
            {collection?.name ?? "Выберите коллекцию"}
          </span>
        </MenuButton>

        <div className="flex items-center gap-3">
          {pinned.length > 0 && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
              {pinned.map((v) => (
                <span key={v.key} title={`${v.key}=${v.value}`} className="truncate">
                  {v.key}=<span className="text-zinc-400">{v.value}</span>
                </span>
              ))}
            </div>
          )}
          <HistoryMenu />
          <EnvSwitcher />
        </div>
      </div>

      {/* Workspace */}
      {!ready ? (
        <div className="flex-1" />
      ) : !collection ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
          <Database size={44} className="text-zinc-700" />
          <p className="text-[15px]">Выберите или создайте коллекцию</p>
          <p className="flex items-center gap-1.5 text-[12px] text-zinc-600">
            <Kbd>⌘P</Kbd> — коллекции
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {currentRequestId === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
              <p className="text-[15px]">Выберите запрос</p>
              <p className="flex items-center gap-1.5 text-[12px] text-zinc-600">
                <Kbd>⌘K</Kbd> — найти или создать
              </p>
            </div>
          ) : (
            <main className="flex min-w-0 flex-1 flex-col">
              <RequestBar />
              <EditorSplit />
            </main>
          )}
        </div>
      )}

      <StatusBar />
      <Toast />
      <UpdateToast />
      <Palette />
      <EnvConfigDialog />
      <SettingsDialog />
      <ImportContractDialog />
      <RunnerDialog />
      <ConfirmDialog />
      <PromptDialog />
      <WhatsNewDialog />
    </div>
  );
}

export default App;
