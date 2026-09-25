import * as cheerio from "cheerio";
import type { ChordSource, ResolvedArtist, Song, SongEntry } from "../types.js";
import { fetchText, sleep } from "../http.js";
import { removeTabs, formatBody, detectKey } from "../textFormat.js";

const BASE_URL = "https://www.guitaretab.com";

// Английские метки разделов, которых нет в стандартном (кириллическом) наборе.
const EXTRA_LABEL_WORDS = ["Verse", "Chorus", "Pre-Chorus", "Bridge", "Intro", "Outro", "Interlude", "Solo"];
const NUMBERED_LABEL_WORDS = ["Куплет", "Verse"];

/**
 * guitaretab.com индексирует исполнителей по пути вида /<буква>/<slug>/, где
 * буква — не просто первая буква имени (например "The Beatles" лежит под
 * /b/beatles/, отбрасывая "The"), поэтому угадать путь напрямую нельзя.
 * Резолвим через встроенный поиск сайта (/fetch/?type=tab&query=...) и берём
 * первую ссылку вида "/<буква>/<slug>/" (корень исполнителя, без ID песни).
 */
async function resolveArtist(query: string): Promise<ResolvedArtist | null> {
  const html = await fetchText(`${BASE_URL}/fetch/`, { params: { type: "tab", query } });
  if (!html) return null;
  const $ = cheerio.load(html);

  const artistRootRe = /^\/([a-z0-9])\/([a-z0-9-]+)\/$/;
  const hrefs = $("a[href]")
    .toArray()
    .map((el) => $(el).attr("href") ?? "");
  const foundHref = hrefs.find((href) => artistRootRe.test(href));
  if (!foundHref) return null;

  return { id: foundHref, url: `${BASE_URL}${foundHref}`, displayName: query };
}

async function listEntries(artist: ResolvedArtist): Promise<SongEntry[]> {
  // Артист-страница показывает только часть песен — полный список на .../all.htm
  const allUrl = artist.url.endsWith("/") ? `${artist.url}all.htm` : `${artist.url}/all.htm`;
  const html = await fetchText(allUrl);
  if (!html) return [];
  const $ = cheerio.load(html);

  const entries: SongEntry[] = [];
  $(".gt-list__row").each((_, row) => {
    const $row = $(row);
    const link = $row.find("a[href]").first();
    if (link.length === 0) return;

    const title = link.text().trim();
    // Берём только варианты "... chords" — они содержат текст+аккорды.
    // Варианты "tab"/"bass"/"drum"/"ukulele" — чистая табулатура без текста песни.
    if (!/\bchords\b/i.test(title)) return;

    const href = link.attr("href") ?? "";
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    // Число оценок (gt-rating__counter) используем как прокси популярности —
    // сайт не публикует прямой счётчик просмотров.
    const ratingText = $row.find(".gt-rating__counter").first().text().trim();
    const views = parseInt(ratingText.replace(/[^0-9]/g, ""), 10) || 0;

    entries.push({ title: title.replace(/\s*chords\s*$/i, "").trim(), url, views });
  });

  return entries;
}

async function fetchSong(url: string, fallbackArtist: string): Promise<Song | null> {
  await sleep(800);
  const html = await fetchText(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const pre = $("pre.js-tab-fit-to-screen").first();
  if (pre.length === 0) return null;

  // Каждая строка — отдельный .js-tab-row (аккорды и текст в одной строке
  // размечены как span'ы внутри неё, без явных переносов строк в разметке).
  // Восстанавливаем текст построчно в порядке DOM, а не через pre.text(),
  // который слил бы все строки в одну.
  const lines: string[] = [];
  pre.find(".js-tab-row").each((_, row) => {
    lines.push($(row).text());
  });
  let rawText = lines.join("\n");

  rawText = removeTabs(rawText);
  const body = formatBody(rawText, { extraLabelWords: EXTRA_LABEL_WORDS, numberedLabelWords: NUMBERED_LABEL_WORDS });

  const titleFull = $("title").text();
  // "<Song> chords [with lyrics] by <Artist> for guitar [and ukulele] @ Guitaretab"
  // — если формат не совпал, используем fallback.
  const m = /^(.+?)\s+chords(?:\s+with\s+lyrics)?\s+by\s+(.+?)\s+for guitar/i.exec(titleFull);
  const title = m ? m[1].trim() : "Без названия";
  const artist = m ? m[2].trim() : fallbackArtist;

  const key = detectKey(body);

  return { title, artist, key, url, body };
}

export const guitaretabSource: ChordSource = {
  id: "guitaretab",
  resolveArtist,
  listEntries,
  fetchSong,
};
