import * as cheerio from "cheerio";
import type { ChordSource, ResolvedArtist, Song, SongEntry } from "../types.js";
import { fetchText, sleep } from "../http.js";
import { transliterateToSlug } from "../translit.js";
import { removeTabs, formatBody, detectKey } from "../textFormat.js";

const BASE_URL = "https://acordes.lacuerda.net";

// Испанские метки разделов, которых нет в стандартном (кириллическом) наборе.
const EXTRA_LABEL_WORDS = ["Estrofa", "Verso", "Coro", "Estribillo", "Puente", "Intro", "Outro", "Solo"];
const NUMBERED_LABEL_WORDS = ["Куплет", "Estrofa", "Verso"];

/**
 * lacuerda.net использует slug вида "manu_chao", "marco_a_solis" — латиница,
 * пробелы заменены на "_". Родной поиск сайта (/ARCH/busca-av.php) завязан
 * на POST с скрытыми полями, поэтому резолвим прямой транслитерацией
 * (тот же модуль, что и для amdm.ru/mytabs.ru — для латиницы транслитерация
 * не меняет буквы, только приводит к нижнему регистру и меняет разделитель).
 */
async function resolveArtist(query: string): Promise<ResolvedArtist | null> {
  const candidate = query.trim();
  const slug = /^[a-zA-Z0-9_-]+$/.test(candidate)
    ? candidate.toLowerCase().replace(/-/g, "_")
    : transliterateToSlug(candidate, "_");
  if (!slug) return null;

  const url = `${BASE_URL}/${slug}/`;
  const html = await fetchText(url);
  if (!html) return null;
  const $ = cheerio.load(html);
  // На странице исполнителя ссылки на песни — относительные пути без "/" внутри
  // (например href="dia_de_enero"), лежащие в основной колонке страницы.
  const hasSongs = $(`a[href]`)
    .toArray()
    .some((el) => {
      const href = $(el).attr("href") ?? "";
      return href && !href.includes("/") && !href.startsWith("javascript") && !href.startsWith("http");
    });
  if (!hasSongs) return null;

  return { id: slug, url, displayName: query };
}

async function listEntries(artist: ResolvedArtist): Promise<SongEntry[]> {
  const html = await fetchText(artist.url);
  if (!html) return [];
  const $ = cheerio.load(html);

  // Сайт не публикует счётчик просмотров/популярности на странице исполнителя,
  // поэтому в качестве приближения к "топ-N" используем порядок на странице
  // (первое упоминание каждой песни), а не реальный рейтинг.
  const seen = new Set<string>();
  const entries: SongEntry[] = [];
  let order = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.includes("/") || href.startsWith("javascript") || href.startsWith("http")) return;
    if (seen.has(href)) return;
    seen.add(href);
    order += 1;
    const title = $(el).text().trim();
    if (!title) return;
    entries.push({
      title,
      url: `${artist.url}${href}.shtml`,
      // Инвертированный порядковый номер — чтобы дедупликация/сортировка
      // по убыванию "views" в select.ts вела себя как "по порядку на странице".
      views: 1_000_000 - order,
    });
  });

  return entries;
}

async function fetchSong(url: string, fallbackArtist: string): Promise<Song | null> {
  await sleep(800);
  const html = await fetchText(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  // ВАЖНО: pre#tCode на странице есть, но он пустой (судя по всему, служебный
  // элемент, заполняемый JS на клиенте, — нам он не подходит). Реальный текст
  // с аккордами лежит в безымянном <pre> внутри <div id="t_body">. На случай
  // изменения разметки — запасной вариант: <pre> с наибольшим объёмом текста.
  let pre = $("#t_body pre").first();
  if (pre.length === 0 || pre.text().trim().length === 0) {
    const pres = $("pre").toArray();
    const longest = pres.reduce<{ el: (typeof pres)[number] | null; len: number }>(
      (acc, el) => {
        const len = $(el).text().trim().length;
        return len > acc.len ? { el, len } : acc;
      },
      { el: null, len: 0 },
    );
    pre = longest.el ? $(longest.el) : $();
  }
  if (pre.length === 0) return null;

  // На большинстве страниц это чистый текст без вложенных тегов, но на
  // всякий случай превращаем встречающиеся <br> в переносы строк перед
  // извлечением текста.
  pre.find("br").replaceWith("\n");
  let rawText = pre.text();

  rawText = removeTabs(rawText);
  const body = formatBody(rawText, { extraLabelWords: EXTRA_LABEL_WORDS, numberedLabelWords: NUMBERED_LABEL_WORDS });

  const h1 = $("h1").first();
  const h2 = $("h2").first();
  const title = h1.length > 0 ? h1.text().trim() : "Без названия";
  const artist = h2.length > 0 ? h2.text().trim() : fallbackArtist;

  // Некоторые песни на lacuerda.net используют сольфеджио (Do-Re-Mi) вместо
  // латинских букв — учитываем это только при определении тональности,
  // сами аккорды в тексте не трогаем (оставляем как в источнике).
  const key = detectKey(body, { withSolfege: true });

  return { title, artist, key, url, body };
}

export const lacuerdaSource: ChordSource = {
  id: "lacuerda",
  resolveArtist,
  listEntries,
  fetchSong,
};
