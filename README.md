# lyrics-scraper

Downloads song lyrics with chords from [amdm.ru](https://amdm.ru),
[mytabs.ru](https://mytabs.ru) (Russian-/Ukrainian-language artists),
[guitaretab.com](https://www.guitaretab.com) (English-language) and
[acordes.lacuerda.net](https://acordes.lacuerda.net) (Spanish-language), and
converts them to a single unified text format (see "Output format" below).
Works both as a library you can plug into a Next.js project (Route Handler /
Server Action) and as a standalone CLI.

Requires Node.js 18+ (needs the built-in `fetch`). Requests are made
server-side only — the module is not meant for client components.

## Install

```bash
npm install
```

## Using it as a module (in Next.js)

The shortest path is `getSongsText`: one call, text right away, nothing
written to disk.

```ts
// app/api/songs/route.ts
import { getSongsText } from "lyrics-scraper";

export async function POST(req: Request) {
  const { artist, count } = await req.json();

  const text = await getSongsText({ artist, count }); // a string

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${artist}_songs.txt"`,
    },
  });
}
```

If you also need metadata (which source was actually used, which of the
`songs` weren't found) — `getSongsText` is just `scrapeArtist` +
`buildOutputFile`, you can call them separately:

```ts
import { scrapeArtist, buildOutputFile } from "lyrics-scraper";

const result = await scrapeArtist({ artist, count });
// result.source — which site was actually used ("amdm" | "mytabs" | "guitaretab" | "lacuerda")
// result.notFound — which of songs weren't found (if songs was passed)

const text = buildOutputFile(result.songs); // same as what getSongsText would return
```

Neither `getSongsText`, `scrapeArtist`, nor `buildOutputFile` write files —
disk writes only happen in the CLI (`-o/--output`, see below).

`scrapeArtist` figures out on its own where to download from: it tries
sources in order — **amdm.ru → mytabs.ru → guitaretab.com →
acordes.lacuerda.net** — and stops at the first one where the artist is
found and has songs. So, for example, for "ДДТ" the result comes from
amdm.ru, for "Кино" (whose entire catalog was removed from amdm.ru at the
rightsholder's request) — from mytabs.ru (if you pass the exact path, see
below), and for "Metallica" — from whichever source responds first (usually
amdm.ru in this case — it also carries a lot of foreign rock). You can force
a specific source via `source` if needed.

### `scrapeArtist` options

| Field        | Type                        | Default | Description |
|--------------|-----------------------------|---------|--------------|
| `artist`     | `string`                    | —       | Artist name (any language) or a site slug/path |
| `count`      | `number`                    | `20`    | How many of the most popular songs to fetch. Ignored if `songs` is set |
| `songs`      | `string[]`                  | —       | A specific song / list of songs by title, instead of top-N |
| `source`     | `"amdm" \| "mytabs" \| "guitaretab" \| "lacuerda"` | auto (tries all four) | Force a specific source instead of auto-detection |
| `onProgress` | `(message: string) => void` | —       | Progress callback — handy for streaming to a UI |

### Special cases in artist resolution

- **amdm.ru**: the name is transliterated into a slug (a few scheme
  variants are tried, including "ы" → "i"), and on failure it's looked up
  via the site's `/search/`.
- **mytabs.ru**: transliterated the same way (hyphen-joined), but some
  artists are catalogued there under a person's name rather than the stage
  name — for example "Кино" lives at `viktor-tsoj`. For such cases pass
  `artist` as a path with `/`, e.g.:

  ```ts
  await scrapeArtist({ artist: "v-r/viktor-tsoj", source: "mytabs", count: 20 });
  ```

  (the letter-range folder prefix in the mytabs.ru path isn't actually
  checked by the server — any value works; use the real one if you know it,
  otherwise just `x/slug`).

- **guitaretab.com**: resolved through the site's built-in search
  (`/fetch/?type=tab&query=...`), because the artist's letter-path doesn't
  always match the first letter of their name (e.g. "The Beatles" lives at
  `/b/beatles/`, dropping "The"). Only entries suffixed "chords" are taken
  (not "tab"/"bass"/"drum" — those have no song lyrics). Popularity is the
  rating count (`gt-rating__counter`); the site doesn't publish a direct
  view counter.
- **lacuerda.net**: slug is Latin-script/transliterated with "_" (same as
  amdm.ru/mytabs.ru). The site **publishes neither a view counter nor a
  rating** on the artist page, so "top-N" here really means the first N
  songs in the order they're listed on the artist page (not actual
  popularity). Some songs use solfège notation (Do-Re-Mi-Fa-Sol-La-Si)
  instead of Latin letters — chords in the text are left untouched (kept as
  in the source), but solfège is recognized separately for determining
  "Тональность:" (key).

### English and Spanish section labels

For guitaretab.com/lacuerda.net, `formatBody` gets its own set of labels
(`Verse`/`Chorus`/`Bridge`/... and `Estrofa`/`Coro`/`Puente`/... respectively)
via `FormatBodyOptions.extraLabelWords`, and numbering ("Verse 1:", "Verse
2:", ...) via `numberedLabelWords`. Behavior for amdm.ru/mytabs.ru is
unchanged (only "Куплет" is numbered, as before).

## Using it as a CLI

```bash
npx tsx src/cli.ts --artist ДДТ --count 20
npx tsx src/cli.ts --artist "Земфира" --count 10
npx tsx src/cli.ts --artist ddt --songs "Дождь" "Метель" "Осень"
npx tsx src/cli.ts --artist "v-r/viktor-tsoj" --source mytabs --count 20
npx tsx src/cli.ts --artist Radiohead --source guitaretab --count 20
npx tsx src/cli.ts --artist Shakira --source lacuerda --count 10
npx tsx src/cli.ts --artist ddt --count 5 --output my_file.txt
npx tsx src/cli.ts --artist ddt --count 5 --stdout          # text to stdout, no file created
```

| Flag                    | Description |
|--------------------------|----------|
| `-a, --artist <name>`     | Artist (see above) |
| `-n, --count <number>`    | How many of the most popular songs to download (default 20) |
| `-s, --songs <titles>` | One or more specific songs instead of top-N |
| `--source <amdm\|mytabs\|guitaretab\|lacuerda>` | Force a source instead of auto-detection |
| `-o, --output <file>`    | Output file name (default `<slug>_songs.txt`) |
| `--stdout`               | Print text to stdout instead of writing a file (progress goes to stderr) |

## Output format

```
Название: Sample song
Исполнитель: Sample artist
Тональность: Am
Источник: https://example.com/sample

Куплет 1:
Am          C
First line of text
F           G
Second line of text

Припев:
Am F
C  G
========================================
Название: Second song
...
```

- UTF-8, LF line endings, no tabs or trailing whitespace.
- Exactly 40 `=` characters between songs, no separator before the first one.
- Section labels with no square brackets; chords on their own line above
  the text, preserving horizontal alignment.
- Alternate chords in parentheses are spread out with a space (`Am (A7)` →
  `Am A7`); explanatory comments in parentheses are removed.
- Guitar tab notation is stripped — only lyrics and chords remain.

(Field names in the output — `Название`, `Исполнитель`, `Тональность`,
`Источник`, and the section labels — stay in Russian; that's the fixed
output format's contract, not a translation artifact.)

## Structure

```
src/
  types.ts        — shared types (Song, ChordSource, ScrapeOptions, ...)
  textFormat.ts    — text-formatting core (shared across all sources)
  translit.ts      — Cyrillic-to-Latin slug transliteration
  select.ts        — dedup/selection of top-N or specific songs
  http.ts          — shared fetch with headers and timeout
  sources/
    amdm.ts        — amdm.ru adapter
    mytabs.ts      — mytabs.ru adapter
    guitaretab.ts  — guitaretab.com adapter
    lacuerda.ts    — acordes.lacuerda.net adapter
  scrape.ts        — orchestrator: source fallthrough, selection, fetching
  index.ts         — the module's public API
  cli.ts           — standalone entry point
```

To add a new source site, implement the `ChordSource` interface
(`resolveArtist`, `listEntries`, `fetchSong`) in `src/sources/` and add it
to `AUTO_ORDER` in `scrape.ts`.
