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
  FindSongOptions,
  FindSongResult,
  SearchSongResult,
  TitleMatch,
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

/** Источники, форсированные или перебираемые по очереди, у которых вообще
 * есть сайтовый поиск по названию песни (см. ChordSource.searchByTitle). */
function titleSearchCandidates(source: SourceId | undefined): ChordSource[] {
  if (source && !SOURCE_IDS.includes(source)) {
    throw new Error(`Неизвестный источник «${source}». Допустимые значения: ${SOURCE_IDS.join(", ")}.`);
  }
  if (source && !SOURCES[source].searchByTitle) {
    throw new Error(`Источник «${source}» не поддерживает поиск по названию песни.`);
  }
  const candidates = (source ? [SOURCES[source]] : AUTO_ORDER).filter((s) => s.searchByTitle);
  if (candidates.length === 0) {
    throw new Error("Ни один из источников не поддерживает поиск по названию песни.");
  }
  return candidates;
}

/** Схлопывает повторные записи одной и той же пары исполнитель+название
 * (перезалитые копии/варианты аранжировки одной песни на сайте) в одну —
 * остаётся первая по релевантности сайтового поиска. */
function dedupeTitleMatches(matches: TitleMatch[]): TitleMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.artist.toLowerCase()}|||${m.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Общая часть searchSong()/findSong(): перебирает источники с поддержкой
 * поиска по названию, пока не найдёт непустой результат, и возвращает
 * уже дедуплицированные совпадения вместе с источником, который их дал. */
async function searchTitleAcrossSources(
  title: string,
  source: SourceId | undefined,
  onProgress?: (m: string) => void,
): Promise<{ source: ChordSource; matches: TitleMatch[] }> {
  const candidateSources = titleSearchCandidates(source);

  for (const src of candidateSources) {
    onProgress?.(`🔍 [${src.id}] Ищу песню по названию: «${title}»`);
    const rawMatches = await src.searchByTitle!(title);
    if (rawMatches.length === 0) {
      onProgress?.(`⚠️ [${src.id}] Ничего не нашлось по названию «${title}».`);
      continue;
    }
    return { source: src, matches: dedupeTitleMatches(rawMatches) };
  }

  throw new Error(`Песня «${title}» не найдена ни на одном источнике, поддерживающем поиск по названию.`);
}

/**
 * Ищет совпадения по названию песни (или его части), без знания
 * исполнителя — через сайтовый поиск источника, без скачивания текста и
 * аккордов (быстрая операция, как listSongs() для исполнителя). Поддерживают
 * не все источники (см. ChordSource.searchByTitle); при автопереборе
 * источники без такого поиска просто пропускаются.
 */
export async function searchSong(options: FindSongOptions): Promise<SearchSongResult> {
  const { title, source, onProgress } = options;

  const { source: chosenSource, matches } = await searchTitleAcrossSources(title, source, onProgress);

  matches.forEach((m, i) => onProgress?.(`  ${i + 1}. ${m.artist} — ${m.title}`));
  onProgress?.(`✅ Найдено ${matches.length} совпадений.`);
  return { title, source: chosenSource.id, matches };
}

/**
 * Ищет песню по названию, без знания исполнителя (в отличие от
 * scrapeArtist/listSongs, где артист обязателен) — через сайтовый поиск
 * источника, и сразу скачивает текст+аккорды каждого найденного совпадения.
 * Поддерживают не все источники (см. ChordSource.searchByTitle); при
 * автопереборе источники без поиска по названию просто пропускаются.
 *
 * Нужен только список совпадений (исполнитель + название), без скачивания —
 * используйте searchSong() вместо findSong().
 */
export async function findSong(options: FindSongOptions): Promise<FindSongResult> {
  const { title, onProgress } = options;

  const { source: chosenSource, matches } = await searchTitleAcrossSources(title, options.source, onProgress);

  matches.forEach((m, i) => onProgress?.(`  ${i + 1}. ${m.artist} — ${m.title}`));
  onProgress?.(`\n📥 Загружаю ${matches.length} найденных песен...`);

  const songs: Song[] = [];
  for (const m of matches) {
    const song = await chosenSource.fetchSong(m.url, m.artist);
    if (song) songs.push(song);
  }

  onProgress?.(`\n🎉 Готово! Загружено песен: ${songs.length}.`);
  return { title, source: chosenSource.id, songs };
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
