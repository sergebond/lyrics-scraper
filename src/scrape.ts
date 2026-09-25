import type { ChordSource, ScrapeOptions, ScrapeResult, Song, SongEntry, ResolvedArtist, SourceId } from "./types.js";
import { SOURCE_IDS } from "./types.js";
import { amdmSource } from "./sources/amdm.js";
import { mytabsSource } from "./sources/mytabs.js";
import { guitaretabSource } from "./sources/guitaretab.js";
import { lacuerdaSource } from "./sources/lacuerda.js";
import { selectTop, selectRequested } from "./select.js";

const SOURCES: Record<SourceId, ChordSource> = {
  amdm: amdmSource,
  mytabs: mytabsSource,
  guitaretab: guitaretabSource,
  lacuerda: lacuerdaSource,
};

/** Порядок перебора источников в автоматическом режиме — скрипт сам решает,
 * откуда качать, пробуя источники по очереди, пока не найдёт исполнителя
 * с непустым списком песен:
 *   1. amdm.ru — основной каталог для русскоязычных/украинских исполнителей;
 *   2. mytabs.ru — часть исполнителей удалена с amdm.ru по требованию
 *      правообладателей (Кино, Наутилус Помпилиус, Агата Кристи, Зиверт и др.);
 *   3. guitaretab.com — англоязычные;
 *   4. acordes.lacuerda.net — испаноязычные.
 * Явно форсировать источник по-прежнему можно через { source: "amdm" | ... }. */
const AUTO_ORDER: ChordSource[] = [amdmSource, mytabsSource, guitaretabSource, lacuerdaSource];

async function tryResolveOnSource(
  source: ChordSource,
  artistQuery: string,
  onProgress?: (m: string) => void,
): Promise<{ source: ChordSource; artist: ResolvedArtist; entries: SongEntry[] } | null> {
  const artist = await source.resolveArtist(artistQuery);
  if (!artist) return null;
  onProgress?.(`🔍 [${source.id}] Загружаю список песен: ${artist.url}`);
  const entries = await source.listEntries(artist);
  if (entries.length === 0) return null;
  return { source, artist, entries };
}

export async function scrapeArtist(options: ScrapeOptions): Promise<ScrapeResult> {
  const { artist: artistQuery, count = 20, songs: requestedSongs, source, onProgress } = options;

  if (source && !SOURCE_IDS.includes(source)) {
    // Защита от невалидного значения, если вызывающий код обошёл проверку
    // типов (например, CLI кастует сырую строку из argv).
    throw new Error(`Неизвестный источник «${source}». Допустимые значения: ${SOURCE_IDS.join(", ")}.`);
  }
  const candidateSources = source ? [SOURCES[source]] : AUTO_ORDER;

  let resolved: { source: ChordSource; artist: ResolvedArtist; entries: SongEntry[] } | null = null;
  for (const src of candidateSources) {
    resolved = await tryResolveOnSource(src, artistQuery, onProgress);
    if (resolved) break;
    onProgress?.(`⚠️ [${src.id}] Исполнитель «${artistQuery}» не найден или у него нет песен.`);
  }

  if (!resolved) {
    throw new Error(
      `Не удалось найти исполнителя «${artistQuery}» ни на одном источнике (${candidateSources.map((s) => s.id).join(", ")}).`,
    );
  }

  const { source: chosenSource, artist, entries } = resolved;

  let selectedEntries: SongEntry[];
  let notFound: string[] = [];
  if (requestedSongs && requestedSongs.length > 0) {
    const result = selectRequested(entries, requestedSongs, onProgress);
    selectedEntries = result.found;
    notFound = result.notFound;
  } else {
    selectedEntries = selectTop(entries, count, onProgress);
  }

  if (selectedEntries.length === 0) {
    return { artist: artistQuery, source: chosenSource.id, songs: [], notFound };
  }

  onProgress?.(`\n📥 Начинаю загрузку ${selectedEntries.length} песен...`);
  const songs: Song[] = [];
  for (const [i, entry] of selectedEntries.entries()) {
    onProgress?.(`  [${i + 1}/${selectedEntries.length}] Загрузка: ${entry.url}`);
    const song = await chosenSource.fetchSong(entry.url, artist.displayName);
    if (song) {
      songs.push(song);
    } else {
      onProgress?.(`  ⚠️ Пропущено: ${entry.url}`);
    }
  }

  onProgress?.(`\n🎉 Готово! Загружено песен: ${songs.length}.`);
  return { artist: artistQuery, source: chosenSource.id, songs, notFound };
}
