import * as cheerio from "cheerio";
import type { ChordSource, ResolvedArtist, Song, SongEntry } from "../types.js";
import { fetchText, sleep } from "../http.js";
import { slugCandidates } from "../translit.js";
import { removeTabs, formatBody, detectKey } from "../textFormat.js";

const BASE_URL = "https://amdm.ru";

async function artistPageHasSongs(url: string): Promise<boolean> {
  const html = await fetchText(url);
  if (!html) return false;
  const $ = cheerio.load(html);
  return $("table tr a.g-link").length > 0;
}

async function searchArtistSlug(name: string): Promise<string | null> {
  const html = await fetchText(`${BASE_URL}/search/`, { params: { q: name } });
  if (!html) return null;
  const $ = cheerio.load(html);
  const pattern = new RegExp(`^${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/akkordi/([a-z0-9_]+)/$`);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? "";
    const m = pattern.exec(href);
    if (m && $(el).text().trim().toLowerCase() === name.trim().toLowerCase()) {
      found = m[1];
    }
  });
  return found;
}

async function resolveArtist(query: string): Promise<ResolvedArtist | null> {
  const candidate = query.trim();
  const candidates = /^[a-zA-Z0-9_]+$/.test(candidate)
    ? [candidate.toLowerCase()]
    : slugCandidates(candidate, "_");

  for (const slug of candidates) {
    const url = `${BASE_URL}/akkordi/${slug}/`;
    if (await artistPageHasSongs(url)) {
      return { id: slug, url, displayName: query };
    }
  }

  const foundSlug = await searchArtistSlug(candidate);
  if (foundSlug) {
    const url = `${BASE_URL}/akkordi/${foundSlug}/`;
    if (await artistPageHasSongs(url)) {
      return { id: foundSlug, url, displayName: query };
    }
  }

  return null;
}

async function listEntries(artist: ResolvedArtist): Promise<SongEntry[]> {
  const html = await fetchText(artist.url);
  if (!html) return [];
  const $ = cheerio.load(html);

  const entries: SongEntry[] = [];
  const needle = `/akkordi/${artist.id}/`;
  $("table tr").each((_, row) => {
    const $row = $(row);
    const link = $row.find("a.g-link[href]").first();
    if (link.length === 0) return;
    const href = link.attr("href") ?? "";
    if (!href.includes(needle)) return;

    const cells = $row.find("td");
    if (cells.length === 0) return;
    const viewsText = $(cells[cells.length - 1]).text().trim();
    const views = parseInt(viewsText.replace(/[^0-9]/g, ""), 10) || 0;
    const fullUrl = href.startsWith("/") ? BASE_URL + href : href;

    entries.push({ title: link.text().trim(), url: fullUrl, views });
  });

  return entries;
}

async function fetchSong(url: string, fallbackArtist: string): Promise<Song | null> {
  await sleep(800); // не перегружаем сайт
  const html = await fetchText(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const pre = $("pre.b-podbor__text").first().length > 0 ? $("pre.b-podbor__text").first() : $("pre").first();
  if (pre.length === 0) return null;

  let rawText = pre.text();
  rawText = removeTabs(rawText);
  const body = formatBody(rawText);

  const h1 = $("h1").first();
  const artistTag = h1.find('[itemprop="byArtist"]').first();
  const nameTag = h1.find('[itemprop="name"]').first();
  const artist = artistTag.length > 0 ? artistTag.text().trim() : fallbackArtist;
  const title = nameTag.length > 0 ? nameTag.text().trim() : "Без названия";

  const key = detectKey(body);

  return { title, artist, key, url, body };
}

export const amdmSource: ChordSource = {
  id: "amdm",
  resolveArtist,
  listEntries,
  fetchSong,
};
