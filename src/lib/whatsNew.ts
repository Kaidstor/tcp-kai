// «Что нового» после обновления приложения.
//
// Основной путь: перед установкой апдейта updater.ts кладёт {version, notes}
// в localStorage (notes = поле notes из latest.json — changelog релиза);
// после перезапуска уже новая версия находит запись и показывает диалог.
// Fallback — публичный GitLab API релизов: покрывает ручную установку dmg
// и апдейт с версии, которая ещё не умела откладывать заметки.
import { getVersion } from "@tauri-apps/api/app";

const PENDING_KEY = "tcp.pendingWhatsNew";
const SEEN_KEY = "tcp.lastSeenVersion";
/** URL-encoded путь проекта — тот же, куда смотрит updater endpoint. */
const GITLAB_PROJECT = "kaidstor%2Ftcp_client_tauri";

export interface ReleaseNote {
  version: string;
  notes: string;
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

/** Релизы (seen, current] из GitLab — свежие первыми. */
async function fetchReleaseNotes(
  seen: string,
  current: string,
): Promise<ReleaseNote[]> {
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
    .filter((r) => cmp(r.version, seen) > 0 && cmp(r.version, current) <= 0)
    .sort((a, b) => cmp(b.version, a.version))
    .slice(0, 10);
}

/**
 * Заметки релизов, которые пользователь ещё не видел (пусто, если версия не
 * менялась). Вызывать один раз на старте: помечает текущую версию просмотренной.
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

    if (pending && pending.version === current && pending.notes.trim()) {
      return [pending];
    }
    return await fetchReleaseNotes(seen, current);
  } catch {
    // без сети / кривой ответ — просто не показываем диалог
    return [];
  }
}
