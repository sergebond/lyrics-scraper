import * as cheerio from "cheerio";
import type { ChordSource, ResolvedArtist, Song, SongEntry } from "../types.js";
import { fetchText, sleep } from "../http.js";
import { slugCandidates } from "../translit.js";
import { removeTabs, formatBody, detectKey } from "../textFormat.js";

const BASE_URL = "https://mytabs.ru";

/**
 * mytabs.ru группирует исполнителей по буквенным диапазонам в пути
 * (например /akkordy/v-r/viktor-tsoj), но фактически сервер эту часть пути
 * не проверяет — подставляем "x" как нейтральную заглушку, чтобы не гадать
 * правильный диапазон.
 */
function candidateUrl(slug: string): string {
  return `${BASE_URL}/akkordy/x/${slug}`;
}

async function artistPageHasSongs(url: string): Promise<boolean> {
  const html = await fetchText(url);
  if (!html) return false;
  const $ = cheerio.load(html);
  return $("table tr div.list-views").length > 0;
}

/**
 * Известные исключения, которые обычная транслитерация не решает:
 * либо mytabs.ru каталогизирует исполнителя под именем человека, а не
 * сценическим названием ("Кино" -> "viktor-tsoj"), либо схема
 * транслитерации даёт слаг, отличный от реального ("Цой" транслитерируется
 * как "coy"/"coi", а не "tsoj"). Ключи — в нижнем регистре.
 */
const KNOWN_ARTIST_PATHS: Record<string, string> = {
  "кино": "v-r/viktor-tsoj",
  "виктор цой": "v-r/viktor-tsoj",
};

async function resolveArtist(query: string): Promise<ResolvedArtist | null> {
  const candidate = query.trim();

  // Явный путь вида "v-r/viktor-tsoj" — прямой обход резолвинга по имени.
  if (candidate.includes("/")) {
    return resolveArtistByPath(candidate);
  }

  const knownPath = KNOWN_ARTIST_PATHS[candidate.toLowerCase()];
  if (knownPath) {
    const resolved = await resolveArtistByPath(knownPath);
    return resolved ? { ...resolved, displayName: query } : null;
  }

  const candidates = /^[a-zA-Z0-9_-]+$/.test(candidate)
    ? [candidate.toLowerCase()]
    : slugCandidates(candidate, "-");

  for (const slug of candidates) {
    const url = candidateUrl(slug);
    if (await artistPageHasSongs(url)) {
      return { id: slug, url, displayName: query };
    }
  }
  return null;
}

/** Резолвинг по уже известному пути вида "v-r/viktor-tsoj" или простому slug'у. */
export async function resolveArtistByPath(artistPath: string): Promise<ResolvedArtist | null> {
  const trimmed = artistPath.replace(/^\/+|\/+$/g, "");
  const url = `${BASE_URL}/akkordy/${trimmed}`;
  if (await artistPageHasSongs(url)) {
    return { id: trimmed, url, displayName: trimmed.split("/").pop() ?? trimmed };
  }
  return null;
}

async function listEntries(artist: ResolvedArtist): Promise<SongEntry[]> {
  const html = await fetchText(artist.url);
  if (!html) return [];
  const $ = cheerio.load(html);

  // Часть пути после последнего "/" — это slug исполнителя, ссылки на песни
  // всегда содержат "/<slug>/<song>.html".
  const slug = artist.id.split("/").pop() ?? artist.id;
  const needle = `/${slug}/`;

  const entries: SongEntry[] = [];
  $("table tr").each((_, row) => {
    const $row = $(row);
    const link = $row.find("a[href]").first();
    if (link.length === 0) return;
    const href = link.attr("href") ?? "";
    if (!href.includes(needle)) return;

    const viewsDiv = $row.find("div.list-views").first();
    if (viewsDiv.length === 0) return;
    const views = parseInt(viewsDiv.text().replace(/[^0-9]/g, ""), 10) || 0;

    entries.push({ title: link.text().trim(), url: href, views });
  });

  return entries;
}

async function fetchSong(url: string, fallbackArtist: string): Promise<Song | null> {
  await sleep(800);
  const html = await fetchText(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const pre = $("pre").first();
  if (pre.length === 0) return null;

  let rawText = pre.text();
  rawText = removeTabs(rawText);
  const body = formatBody(rawText);

  // Хлебные крошки: Главная / Аккорды / <буква> / <Исполнитель> / <Название>
  // — исполнитель и название всегда предпоследний и последний пункты.
  const crumbs = $('span[itemprop="name"]')
    .map((_, el) => $(el).text().trim())
    .get();
  const artist = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : fallbackArtist;
  const title = crumbs.length >= 1 ? crumbs[crumbs.length - 1] : "Без названия";

  const key = detectKey(body);

  return { title, artist, key, url, body };
}

export const mytabsSource: ChordSource = {
  id: "mytabs",
  resolveArtist,
  listEntries,
  fetchSong,
};
