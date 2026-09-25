/**
 * Публичный API. Самый простой способ получить готовый текст одним вызовом,
 * без файлов на диске (Next.js Route Handler / Server Action):
 *
 *   import { getSongsText } from "lyrics-scraper";
 *
 *   export async function POST(req: Request) {
 *     const { artist, count } = await req.json();
 *     const text = await getSongsText({ artist, count }); // строка, ничего не пишется на диск
 *     return new Response(text, {
 *       headers: { "Content-Type": "text/plain; charset=utf-8" },
 *     });
 *   }
 *
 * Если нужны метаданные (какой источник использован, какие песни не нашлись
 * и т.п.), а не только текст — используйте scrapeArtist() + buildOutputFile()
 * по отдельности (getSongsText — просто их комбинация).
 *
 * Нужен только список песен исполнителя (названия), без текста и аккордов —
 * используйте listSongs(), она не скачивает страницы отдельных песен:
 *
 *   import { listSongs } from "lyrics-scraper";
 *   const { songs } = await listSongs({ artist: "ДДТ" }); // [{ title, url, views }, ...]
 *
 * Известно название песни (или его часть), но не исполнитель — используйте
 * findSong() (сразу скачивает) или searchSong() (только список совпадений,
 * без скачивания — быстрее, аналог listSongs() для поиска по названию):
 *
 *   import { findSong, searchSong } from "lyrics-scraper";
 *   const { songs } = await findSong({ title: "Шёлковое сердце" }); // Song[], обычно одна
 *   const { matches } = await searchSong({ title: "сердце" }); // { title, artist, url }[]
 *
 * Работает только на сервере (Route Handler, Server Action, Node-рантайм) —
 * делает исходящие HTTP-запросы и не предназначена для клиентских компонентов.
 * Ни scrapeArtist, ни buildOutputFile, ни getSongsText, ни listSongs не
 * пишут файлы — запись на диск (CLI, `-o/--output`) делается только в cli.ts.
 *
 * Основной контракт — четыре функции выше (getSongsText, listSongs,
 * scrapeArtist, buildOutputFile). Всё, что экспортируется ниже
 * (formatSongBlock, *Source, resolveMytabsArtistByPath) — служебный доступ
 * для редких случаев (например, принудительный source с ручным резолвингом
 * пути на mytabs.ru); в обычном использовании не нужно.
 */
export { scrapeArtist, listSongs, findSong, searchSong } from "./scrape.js";
export { formatSongBlock, formatOutputFile as buildOutputFileFromBlocks } from "./textFormat.js";
export { amdmSource } from "./sources/amdm.js";
export { mytabsSource, resolveArtistByPath as resolveMytabsArtistByPath } from "./sources/mytabs.js";
export { guitaretabSource } from "./sources/guitaretab.js";
export { lacuerdaSource } from "./sources/lacuerda.js";

export type {
  Song,
  SongEntry,
  ResolvedArtist,
  ChordSource,
  ScrapeOptions,
  ScrapeResult,
  ListSongsOptions,
  ListSongsResult,
  TitleMatch,
  FindSongOptions,
  FindSongResult,
  SearchSongResult,
} from "./types.js";

import type { Song, ScrapeOptions } from "./types.js";
import { formatSongBlock, formatOutputFile } from "./textFormat.js";
import { scrapeArtist } from "./scrape.js";

/** Собирает готовый текстовый файл (тот же формат, что у *.txt из CLI) из списка песен.
 * Только сборка строки в памяти — на диск ничего не пишет. */
export function buildOutputFile(songs: Song[]): string {
  return formatOutputFile(songs.map(formatSongBlock));
}

/**
 * Самый короткий путь к результату: скачивает песни и сразу возвращает
 * готовый текст (тот же формат, что у *.txt), одной строкой — без записи на
 * диск. Под капотом — просто scrapeArtist() + buildOutputFile().
 *
 * Если ничего не нашлось (исполнитель есть, но не найдено ни одной из
 * запрошенных песен), вернёт пустую строку "" — как buildOutputFile([]).
 * Если исполнителя не нашли нигде — бросит Error, как и scrapeArtist().
 */
export async function getSongsText(options: ScrapeOptions): Promise<string> {
  const result = await scrapeArtist(options);
  return buildOutputFile(result.songs);
}
