// ⌘P — collections, ⌘K — requests of the open collection. Built on the
// sql-kai palette (fuzzy scoring + highlighted runs) rather than the bits-ui
// Command component the Svelte build used.
//
// Typing a name that doesn't exist offers to create it, so "new collection" /
// "new request" need no separate dialogs. ⌘K on a highlighted collection
// drills into its actions (open / env / rename / delete).
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ChevronLeft,
  Copy,
  CopyPlus,
  Database,
  FileInput,
  ListChecks,
  Pencil,
  Plus,
  Send,
  Settings,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { fuzzyScore, highlightRuns } from "../lib/fuzzy";
import { currentCollection, useApp } from "../lib/store";
import { Kbd, Overlay, cn } from "./ui";

/** Text with the fuzzy-matched characters highlighted. */
function Hl({ query, text }: { query: string; text: string }) {
  const runs = useMemo(() => highlightRuns(query, text), [query, text]);
  return (
    <>
      {runs.map((r, i) =>
        r.hit ? (
          <span key={i} className="text-sky-400">
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

interface Item {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  hint?: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  danger?: boolean;
  /** Fuzzy haystack; falls back to the title. */
  keywords?: string;
  /** Skips filtering — "create X" rows must stay visible as you type. */
  always?: boolean;
  action: () => void;
}

function Modal({
  placeholder,
  items,
  query,
  onQuery,
  onClose,
  /** ⌘K on the highlighted row (collections palette only). */
  onDrill,
}: {
  placeholder: string;
  items: Item[];
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  onDrill?: (id: string) => void;
}) {
  const [sel, setSel] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items;
    const scored = items
      .filter((i) => !i.always)
      .map((item) => ({
        item,
        score: fuzzyScore(q, item.keywords ?? item.title),
      }))
      .filter((x): x is { item: Item; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    return [...scored, ...items.filter((i) => i.always)];
  }, [query, items]);

  useEffect(() => setSel(0), [query, items.length]);

  const run = (item?: Item) => {
    const target = item ?? filtered[sel];
    if (!target) return;
    target.action();
  };

  return (
    <Overlay onClose={onClose} className="items-start bg-black/50 pt-[14vh]">
      <div className="w-[30rem] max-w-[92vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <input
          autoFocus
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run();
            } else if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
              // ⌘K drills into the highlighted collection's actions
              const target = filtered[sel];
              if (onDrill && target) {
                e.preventDefault();
                e.stopPropagation();
                onDrill(target.id);
              }
            }
          }}
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => run(item)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2",
                  i === sel && "bg-zinc-800",
                )}
              >
                <Icon
                  size={14}
                  className={cn(
                    "shrink-0",
                    item.danger ? "text-red-400" : "text-zinc-500",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "flex items-center gap-2 text-[13px]",
                      item.danger ? "text-red-400" : "text-zinc-100",
                    )}
                  >
                    <span className="truncate">
                      <Hl query={query} text={item.title} />
                    </span>
                    {item.badge && (
                      <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.subtitle && (
                    <div className="truncate font-mono text-[11px] text-zinc-500">
                      <Hl query={query} text={item.subtitle} />
                    </div>
                  )}
                </div>
                {item.hint && (
                  <Kbd className="shrink-0">{item.hint}</Kbd>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-zinc-600">
              ничего не найдено
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

export function Palette() {
  const palette = useApp((s) => s.palette);
  const setPalette = useApp((s) => s.setPalette);
  const collections = useApp((s) => s.collections);
  const currentCollectionId = useApp((s) => s.currentCollectionId);
  const requests = useApp((s) => s.requests);
  const currentRequestId = useApp((s) => s.currentRequestId);
  const selectCollection = useApp((s) => s.selectCollection);
  const createCollection = useApp((s) => s.createCollection);
  const renameCollection = useApp((s) => s.renameCollection);
  const deleteCollection = useApp((s) => s.deleteCollection);
  const selectRequest = useApp((s) => s.selectRequest);
  const createRequest = useApp((s) => s.createRequest);
  const openEnvConfig = useApp((s) => s.openEnvConfig);
  const promptDialog = useApp((s) => s.promptDialog);
  const confirmDialog = useApp((s) => s.confirmDialog);

  const renameRequest = useApp((s) => s.renameRequest);
  const duplicateRequest = useApp((s) => s.duplicateRequest);
  const deleteRequest = useApp((s) => s.deleteRequest);
  const openImport = useApp((s) => s.openImport);
  const setRunnerOpen = useApp((s) => s.setRunnerOpen);
  const collection0 = useApp(currentCollection);
  const showToast = useApp((s) => s.showToast);

  const [query, setQuery] = useState("");
  /** Collection whose action list is open (⌘K drill-in). */
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  /** Request whose action list is open (⌘K drill-in in the requests palette). */
  const [requestActionsFor, setRequestActionsFor] = useState<number | null>(null);

  // every open starts clean
  useEffect(() => {
    if (!palette) {
      setQuery("");
      setActionsFor(null);
      setRequestActionsFor(null);
    }
  }, [palette]);

  if (!palette) return null;
  const close = () => setPalette(null);

  // — collection actions (⌘K on a collection) —
  // Derived, not asserted: if the drilled-into collection is gone (deleted
  // from elsewhere), this falls back to the list instead of updating state
  // mid-render.
  const collection =
    actionsFor === null
      ? null
      : (collections.find((c) => c.id === actionsFor) ?? null);

  if (palette === "collections" && collection) {
    const items: Item[] = [
      {
        id: "open",
        title: "Открыть коллекцию",
        icon: Database,
        hint: "↵",
        action: () => {
          void selectCollection(collection.id);
          close();
        },
      },
      ...(collection.id === currentCollectionId
        ? [
            {
              id: "env",
              title: "Настроить переменные окружения",
              icon: Settings,
              hint: "⌘E",
              action: () => {
                openEnvConfig();
                close();
              },
            } satisfies Item,
            {
              id: "import",
              title: "Импортировать контракт (*.contract.ts)…",
              icon: FileInput,
              action: () => {
                openImport();
                close();
              },
            } satisfies Item,
            {
              id: "runner",
              title: "Прогнать запросы (smoke)…",
              icon: ListChecks,
              action: () => {
                setRunnerOpen(true);
                close();
              },
            } satisfies Item,
          ]
        : []),
      {
        id: "rename",
        title: "Переименовать",
        icon: Pencil,
        action: () => {
          close();
          void (async () => {
            const name = await promptDialog({
              title: "Переименовать коллекцию",
              label: "Название",
              initialValue: collection.name,
              confirmLabel: "Сохранить",
            });
            if (name) await renameCollection(collection.id, name);
          })();
        },
      },
      {
        id: "delete",
        title: "Удалить коллекцию",
        icon: Trash2,
        danger: true,
        action: () => {
          close();
          void (async () => {
            const ok = await confirmDialog({
              title: "Удаление коллекции",
              message: `Коллекция "${collection.name}", все её запросы и история будут удалены без возможности восстановления.`,
              danger: true,
            });
            if (ok) await deleteCollection(collection.id);
          })();
        },
      },
      {
        id: "back",
        title: "Назад",
        icon: ChevronLeft,
        hint: "esc",
        action: () => {
          setActionsFor(null);
          setQuery("");
        },
      },
    ];
    return (
      <Modal
        placeholder={`${collection.name} — действие…`}
        items={items}
        query={query}
        onQuery={setQuery}
        onClose={() => {
          setActionsFor(null);
          setQuery("");
        }}
      />
    );
  }

  // — collections —
  if (palette === "collections") {
    const typed = query.trim();
    const exists = collections.some(
      (c) => c.name.toLowerCase() === typed.toLowerCase(),
    );
    const items: Item[] = [
      ...collections.map(
        (c): Item => ({
          id: String(c.id),
          title: c.name,
          icon: Database,
          badge: c.id === currentCollectionId ? "текущая" : undefined,
          hint: "⌘K",
          action: () => {
            void selectCollection(c.id);
            close();
          },
        }),
      ),
      ...(typed && !exists
        ? [
            {
              id: "create",
              title: `Создать коллекцию "${typed}"`,
              icon: Plus,
              always: true,
              action: () => {
                void createCollection(typed);
                close();
              },
            } satisfies Item,
          ]
        : []),
    ];
    return (
      <Modal
        placeholder="Коллекция…"
        items={items}
        query={query}
        onQuery={setQuery}
        onClose={close}
        onDrill={(id) => {
          const collectionId = Number(id);
          if (collections.some((c) => c.id === collectionId)) {
            setActionsFor(collectionId);
            setQuery("");
          }
        }}
      />
    );
  }

  // — request actions (⌘K on a request) —
  const request =
    requestActionsFor === null
      ? null
      : (requests.find((r) => r.id === requestActionsFor) ?? null);

  if (palette === "requests" && request) {
    const copyCli = () => {
      // применённый в GUI пак — дефолт CLI, флаг -e не нужен
      const quote = (s: string) => (/[\s"']/.test(s) ? JSON.stringify(s) : s);
      const cmd = `tcp-kai ${quote(collection0?.name ?? "")} ${quote(request.name)}`;
      void writeText(cmd)
        .then(() => showToast(`${cmd} — в буфере`, "success"))
        .catch((e: unknown) => showToast(String(e)));
    };

    const items: Item[] = [
      {
        id: "open",
        title: "Открыть запрос",
        icon: Send,
        hint: "↵",
        action: () => {
          void selectRequest(request.id);
          close();
        },
      },
      {
        id: "rename",
        title: "Переименовать",
        icon: Pencil,
        action: () => {
          close();
          void (async () => {
            const name = await promptDialog({
              title: "Переименовать запрос",
              label: "Название",
              initialValue: request.name,
              confirmLabel: "Сохранить",
            });
            if (name) await renameRequest(request.id, name);
          })();
        },
      },
      {
        id: "duplicate",
        title: "Дублировать",
        icon: CopyPlus,
        action: () => {
          void duplicateRequest(request.id);
          close();
        },
      },
      {
        id: "copy-cli",
        title: "Скопировать CLI-команду",
        subtitle: `tcp-kai ${collection0?.name ?? ""} ${request.name}`,
        icon: Copy,
        action: () => {
          copyCli();
          close();
        },
      },
      {
        id: "delete",
        title: "Удалить запрос",
        icon: Trash2,
        danger: true,
        action: () => {
          close();
          void (async () => {
            const ok = await confirmDialog({
              title: "Удаление запроса",
              message: `Запрос "${request.name}" и вся его история будут удалены без возможности восстановления.`,
              danger: true,
            });
            if (ok) await deleteRequest(request.id);
          })();
        },
      },
      {
        id: "back",
        title: "Назад",
        icon: ChevronLeft,
        hint: "esc",
        action: () => {
          setRequestActionsFor(null);
          setQuery("");
        },
      },
    ];
    return (
      <Modal
        placeholder={`${request.name} — действие…`}
        items={items}
        query={query}
        onQuery={setQuery}
        onClose={() => {
          setRequestActionsFor(null);
          setQuery("");
        }}
      />
    );
  }

  // — requests —
  const typed = query.trim();
  const exists = requests.some((r) => r.name.toLowerCase() === typed.toLowerCase());
  const items: Item[] = [
    ...requests.map(
      (r): Item => ({
        id: String(r.id),
        title: r.name,
        subtitle: r.cmd !== r.name ? r.cmd : undefined,
        icon: r.emit === 1 ? Zap : Send,
        badge: r.id === currentRequestId ? "текущий" : undefined,
        hint: "⌘K",
        keywords: `${r.name} ${r.cmd}`,
        action: () => {
          void selectRequest(r.id);
          close();
        },
      }),
    ),
    ...(typed && !exists && currentCollectionId !== null
      ? [
          {
            id: "create",
            title: `Создать команду "${typed}"`,
            icon: Plus,
            always: true,
            action: () => {
              void createRequest(typed);
              close();
            },
          } satisfies Item,
        ]
      : []),
  ];
  return (
    <Modal
      placeholder="Запрос (cmd)…"
      items={items}
      query={query}
      onQuery={setQuery}
      onClose={close}
      onDrill={(id) => {
        const requestId = Number(id);
        if (requests.some((r) => r.id === requestId)) {
          setRequestActionsFor(requestId);
          setQuery("");
        }
      }}
    />
  );
}
