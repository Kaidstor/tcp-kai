// «Что нового» после обновления приложения.
//
// Триггер — смена версии с прошлого запуска. Содержимое — последние релизы
// из публичного GitLab API (минимум HISTORY штук, все непросмотренные — с
// пометкой fresh). Офлайн-fallback: заметки, отложенные апдейтером перед
// перезапуском ({version, notes} в localStorage, см. updater.ts).
import { getVersion } from "@tauri-apps/api/app";

const PENDING_KEY = "tcp.pendingWhatsNew";
const SEEN_KEY = "tcp.lastSeenVersion";
/** URL-encoded путь проекта — тот же, куда смотрит updater endpoint. */
const GITLAB_PROJECT = "kaidstor%2Ftcp_client_tauri";

/** Страница всех релизов — для перехода из диалога. */
export const RELEASES_PAGE_URL =
  "https://gitlab.com/kaidstor/tcp_client_tauri/-/releases";

/** Сколько версий показывать в диалоге, даже если новых меньше. */
const HISTORY = 3;

export interface ReleaseNote {
  version: string;
  notes: string;
  /** Вышла после версии, которую пользователь запускал в прошлый раз. */
  fresh?: boolean;
}

/** Откладывает заметки устанавливаемого апдейта до перезапуска. */
export function stashPendingNotes(version: string, notes?: string) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ version, notes: notes ?? "" }),
    );
  } catch {
    // best-effort
  }
}

/** "1.2.3" → сравнение по числовым компонентам; пререлизы не используются. */
const cmp = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** Релизы ≤ current из GitLab, свежие первыми. */
async function fetchReleases(current: string): Promise<ReleaseNote[]> {
  const res = await fetch(
    `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT}/releases?per_page=20`,
  );
  if (!res.ok) return [];
  const releases: { tag_name: string; description?: string }[] =
    await res.json();
  return releases
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ""),
      notes: r.description ?? "",
    }))
    .filter((r) => cmp(r.version, current) <= 0)
    .sort((a, b) => cmp(b.version, a.version));
}

/**
 * Релизы для диалога «Что нового» (пусто — не показывать). Вызывать один раз
 * на старте: помечает текущую версию просмотренной.
 */
export async function collectWhatsNew(): Promise<ReleaseNote[]> {
  try {
    const current = await getVersion();
    const seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, current);

    let pending: ReleaseNote | null = null;
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) {
      localStorage.removeItem(PENDING_KEY);
      pending = JSON.parse(raw) as ReleaseNote;
    }

    // Первый запуск (свежая установка) — нечего рассказывать.
    if (!seen || seen === current) return [];

    const history = await fetchReleases(current).catch(() => []);
    if (history.length > 0) {
      const isFresh = (v: string) => cmp(v, seen) > 0;
      const freshCount = history.filter((r) => isFresh(r.version)).length;
      return history
        .slice(0, Math.max(HISTORY, freshCount))
        .map((r) => ({ ...r, fresh: isFresh(r.version) }));
    }

    // Без сети: хотя бы отложенные заметки только что вставшей версии.
    if (pending && pending.version === current && pending.notes.trim()) {
      return [{ ...pending, fresh: true }];
    }
    return [];
  } catch {
    return [];
  }
}
