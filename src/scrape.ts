import type {
  ChordSource,
  ScrapeOptions,
  ScrapeResult,
  Song,
  SongEntry,
  ResolvedArtist,
  SourceId,
  ListSongsOptions,
  ListSongsResult,
} from "./types.js";
import { SOURCE_IDS } from "./types.js";
import { amdmSource } from "./sources/amdm.js";
import { mytabsSource } from "./sources/mytabs.js";
import { guitaretabSource } from "./sources/guitaretab.js";
import { lacuerdaSource } from "./sources/lacuerda.js";
import { selectTop, selectRequested, dedupeBestByTitle } from "./select.js";

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

interface Resolved {
  source: ChordSource;
  artist: ResolvedArtist;
  entries: SongEntry[];
}

async function tryResolveOnSource(
  source: ChordSource,
  artistQuery: string,
  onProgress?: (m: string) => void,
): Promise<Resolved | null> {
  const artist = await source.resolveArtist(artistQuery);
  if (!artist) return null;
  onProgress?.(`🔍 [${source.id}] Загружаю список песен: ${artist.url}`);
  const entries = await source.listEntries(artist);
  if (entries.length === 0) return null;
  return { source, artist, entries };
}

/** Находит исполнителя, перебирая источники по очереди (см. AUTO_ORDER),
 * или обращаясь только к форсированному через options.source. Общая часть
 * для scrapeArtist() и listSongs() — резолвинг и список песен исполнителя
 * не зависят от того, нужно ли дальше скачивать текст с аккордами. */
async function resolveAcrossSources(
  artistQuery: string,
  source: SourceId | undefined,
  onProgress?: (m: string) => void,
): Promise<Resolved> {
  if (source && !SOURCE_IDS.includes(source)) {
    // Защита от невалидного значения, если вызывающий код обошёл проверку
    // типов (например, CLI кастует сырую строку из argv).
    throw new Error(`Неизвестный источник «${source}». Допустимые значения: ${SOURCE_IDS.join(", ")}.`);
  }
  const candidateSources = source ? [SOURCES[source]] : AUTO_ORDER;

  for (const src of candidateSources) {
    const resolved = await tryResolveOnSource(src, artistQuery, onProgress);
    if (resolved) return resolved;
    onProgress?.(`⚠️ [${src.id}] Исполнитель «${artistQuery}» не найден или у него нет песен.`);
  }

  throw new Error(
    `Не удалось найти исполнителя «${artistQuery}» ни на одном источнике (${candidateSources.map((s) => s.id).join(", ")}).`,
  );
}

/**
 * Возвращает список песен исполнителя (название + ссылка + просмотры) без
 * скачивания текста/аккордов — быстрая операция (один запрос к странице
 * исполнителя), в отличие от scrapeArtist(). Дубликаты (один трек в
 * нескольких подборах от разных авторов) схлопнуты в один с наибольшим
 * числом просмотров; список отсортирован по убыванию просмотров.
 *
 * count не задан — вернутся все найденные песни исполнителя.
 *
 * ВАЖНО: на acordes.lacuerda.net у "просмотров" нет реального смысла —
 * сайт не публикует ни счётчик просмотров, ни рейтинг, поэтому там
 * views — это просто обратный порядковый номер на странице исполнителя
 * (см. lacuerda.ts). Сортировка по views на этом источнике даёт "как
 * перечислено на сайте", а не "от самой популярной".
 */
export async function listSongs(options: ListSongsOptions): Promise<ListSongsResult> {
  const { artist: artistQuery, count, source, onProgress } = options;

  const { source: chosenSource, entries } = await resolveAcrossSources(artistQuery, source, onProgress);

  const ranked = [...dedupeBestByTitle(entries).values()].sort((a, b) => b.views - a.views);
  const songs = count !== undefined ? ranked.slice(0, count) : ranked;

  songs.forEach((s, i) => onProgress?.(`  ${i + 1}. ${s.title} — ${s.views.toLocaleString("ru-RU")} просмотров`));
  onProgress?.(`✅ Найдено ${songs.length} уникальных песен.`);
  return { artist: artistQuery, source: chosenSource.id, songs };
}

export async function scrapeArtist(options: ScrapeOptions): Promise<ScrapeResult> {
  const { artist: artistQuery, count = 20, songs: requestedSongs, source, onProgress } = options;

  const { source: chosenSource, artist, entries } = await resolveAcrossSources(artistQuery, source, onProgress);

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
