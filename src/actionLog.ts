import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_LOG_RETENTION_DAYS = 5;

export type LoggedAction = "scrapeArtist" | "listSongs" | "findSong" | "searchSong";

export interface ActionLogConfig {
  /** Каталог для файлов лога (создаётся при первой записи). */
  dir: string;
  /** Сколько календарных дней хранить (включая сегодня). По умолчанию 5. */
  retentionDays?: number;
}

export interface ActionLogEntry {
  ts: string;
  action: LoggedAction;
  /** Что запросили (исполнитель/название/count/songs/source). */
  input: Record<string, unknown>;
  ok: boolean;
  /** Источник, давший результат. */
  source?: string;
  /** Сколько песен/совпадений вернулось. */
  resultCount?: number;
  /** Запрошенные песни, которые не нашлись. */
  notFound?: string[];
  /** Источники, перебранные впустую до успешного (или до полного провала). */
  missedSources?: string[];
  error?: string;
  durationMs: number;
}

/** Заполняется по ходу действия, чтобы в лог попал путь перебора источников. */
export interface Trace {
  missedSources: string[];
}

const LOG_FILE_RE = /^actions-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const MAX_STRING_LENGTH = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

// undefined — конфигурация ещё не задана явно, смотрим в переменные окружения;
// null — логирование явно выключено.
let configured: ActionLogConfig | null | undefined;
let lastPrunedDay: string | null = null;

/** Явно включает логирование (или выключает при null). Без вызова логирование
 * включается только если задан LYRICS_SCRAPER_LOG_DIR. */
export function configureActionLog(config: ActionLogConfig | null): void {
  configured = config;
  lastPrunedDay = null;
}

function activeConfig(): { dir: string; retentionDays: number } | null {
  let cfg = configured;
  if (cfg === undefined) {
    const dir = process.env.LYRICS_SCRAPER_LOG_DIR;
    const days = Number.parseInt(process.env.LYRICS_SCRAPER_LOG_RETENTION_DAYS ?? "", 10);
    cfg = dir ? { dir, retentionDays: days > 0 ? days : undefined } : null;
  }
  if (!cfg) return null;
  const retentionDays =
    Number.isInteger(cfg.retentionDays) && (cfg.retentionDays as number) > 0
      ? (cfg.retentionDays as number)
      : DEFAULT_LOG_RETENTION_DAYS;
  return { dir: cfg.dir, retentionDays };
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Удаляет файлы лога старше retentionDays календарных дней (сегодняшний
 * день считается): при 5 хранятся сегодня и предыдущие 4 дня. */
export async function pruneActionLogs(dir: string, retentionDays: number, now = new Date()): Promise<void> {
  const cutoff = dayStamp(new Date(now.getTime() - retentionDays * DAY_MS));
  for (const name of await readdir(dir)) {
    const match = LOG_FILE_RE.exec(name);
    if (match && match[1] <= cutoff) {
      await unlink(join(dir, name)).catch(() => {});
    }
  }
}

/** Запись в лог никогда не бросает исключение: логирование не должно ломать поиск. */
async function writeActionLog(entry: Omit<ActionLogEntry, "ts">): Promise<void> {
  try {
    const cfg = activeConfig();
    if (!cfg) return;

    const now = new Date();
    const day = dayStamp(now);
    await mkdir(cfg.dir, { recursive: true });
    if (lastPrunedDay !== day) {
      lastPrunedDay = day;
      await pruneActionLogs(cfg.dir, cfg.retentionDays, now);
    }
    const line = JSON.stringify({ ts: now.toISOString(), ...entry }, (_key, value) =>
      typeof value === "string" && value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + "…" : value,
    );
    await appendFile(join(cfg.dir, `actions-${day}.jsonl`), line + "\n", "utf-8");
  } catch {
    // намеренно игнорируем
  }
}

/** Выполняет действие и пишет в лог краткий итог (успех или ошибку). Тексты
 * песен в лог не попадают — только счётчики и метаданные. */
export async function withActionLog<T>(
  action: LoggedAction,
  input: Record<string, unknown>,
  run: (trace: Trace) => Promise<T>,
  summarize: (result: T) => { source: string; resultCount: number; notFound?: string[] },
): Promise<T> {
  const started = Date.now();
  const trace: Trace = { missedSources: [] };
  const missedSources = () => (trace.missedSources.length > 0 ? trace.missedSources : undefined);
  try {
    const result = await run(trace);
    const summary = summarize(result);
    await writeActionLog({
      action,
      input,
      ok: true,
      source: summary.source,
      resultCount: summary.resultCount,
      notFound: summary.notFound && summary.notFound.length > 0 ? summary.notFound : undefined,
      missedSources: missedSources(),
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    await writeActionLog({
      action,
      input,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      missedSources: missedSources(),
      durationMs: Date.now() - started,
    });
    throw err;
  }
}
