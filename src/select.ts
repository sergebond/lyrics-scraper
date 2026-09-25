import type { SongEntry } from "./types.js";

/**
 * Из всех подборов оставляет по одному на песню — с наибольшим числом
 * просмотров (один и тот же трек часто представлен несколькими подборами
 * от разных авторов). Ключ — нормализованное название.
 */
export function dedupeBestByTitle(entries: SongEntry[]): Map<string, SongEntry> {
  const best = new Map<string, SongEntry>();
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase();
    const existing = best.get(key);
    if (!existing || entry.views > existing.views) {
      best.set(key, entry);
    }
  }
  return best;
}

export function selectTop(
  entries: SongEntry[],
  count: number,
  onProgress?: (message: string) => void,
): SongEntry[] {
  const best = [...dedupeBestByTitle(entries).values()].sort((a, b) => b.views - a.views);
  const top = best.slice(0, count);
  top.forEach((e, i) => onProgress?.(`  ${i + 1}. ${e.title} — ${e.views.toLocaleString("ru-RU")} просмотров`));
  onProgress?.(`✅ Отобрано ${top.length} самых популярных уникальных песен.`);
  return top;
}

export function selectRequested(
  entries: SongEntry[],
  requestedTitles: string[],
  onProgress?: (message: string) => void,
): { found: SongEntry[]; notFound: string[] } {
  const best = dedupeBestByTitle(entries);
  const found: SongEntry[] = [];
  const notFound: string[] = [];

  for (const wanted of requestedTitles) {
    const wantedKey = wanted.trim().toLowerCase();
    const exact = best.get(wantedKey);
    if (exact) {
      found.push(exact);
      onProgress?.(`  ✓ ${exact.title} — ${exact.views.toLocaleString("ru-RU")} просмотров`);
      continue;
    }

    const candidates = [...best.entries()]
      .filter(([k]) => k.includes(wantedKey) || wantedKey.includes(k))
      .map(([, v]) => v);
    if (candidates.length > 0) {
      const bestMatch = candidates.reduce((a, b) => (b.views > a.views ? b : a));
      found.push(bestMatch);
      onProgress?.(`  ~ «${wanted}» распознано как «${bestMatch.title}» — ${bestMatch.views.toLocaleString("ru-RU")} просмотров`);
    } else {
      notFound.push(wanted);
      onProgress?.(`  ✗ Песня «${wanted}» не найдена у исполнителя`);
    }
  }

  onProgress?.(`✅ Отобрано ${found.length} из ${requestedTitles.length} запрошенных песен.`);
  return { found, notFound };
}
