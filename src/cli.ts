#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { scrapeArtist, listSongs } from "./scrape.js";
import { buildOutputFile } from "./index.js";
import { transliterateToSlug } from "./translit.js";
import { SOURCE_IDS, type SourceId } from "./types.js";

interface Args {
  artist: string;
  count?: number;
  songs?: string[];
  source?: SourceId;
  output?: string;
  stdout: boolean;
  list: boolean;
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { artist: "ДДТ", stdout: false, list: false };

  let i = 0;
  // Значение следующего аргумента для флага flag — с проверкой, что оно
  // вообще есть (иначе argv[++i] молча даёт undefined, и ошибка вылезет
  // непонятно где дальше по коду).
  const nextValue = (flag: string): string => {
    i += 1;
    const value = argv[i];
    if (value === undefined) fail(`Флаг ${flag} требует значение.`);
    return value;
  };

  for (; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-a":
      case "--artist":
        args.artist = nextValue(arg);
        break;
      case "-n":
      case "--count": {
        const raw = nextValue(arg);
        const count = Number.parseInt(raw, 10);
        if (!Number.isInteger(count) || count <= 0) {
          fail(`--count должен быть положительным целым числом, получено: "${raw}".`);
        }
        args.count = count;
        break;
      }
      case "-s":
      case "--songs": {
        const songs: string[] = [];
        while (argv[i + 1] && !argv[i + 1].startsWith("-")) songs.push(argv[++i]);
        if (songs.length === 0) fail(`Флаг ${arg} требует хотя бы одно название песни.`);
        args.songs = songs;
        break;
      }
      case "--source": {
        const raw = nextValue(arg);
        if (!SOURCE_IDS.includes(raw as SourceId)) {
          fail(`--source должен быть одним из: ${SOURCE_IDS.join(", ")}. Получено: "${raw}".`);
        }
        args.source = raw as SourceId;
        break;
      }
      case "-o":
      case "--output":
        args.output = nextValue(arg);
        break;
      case "--stdout":
        args.stdout = true;
        break;
      case "-l":
      case "--list":
        args.list = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        printHelp();
        fail(`Неизвестный аргумент: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Скачивает тексты и аккорды песен (amdm.ru, mytabs.ru, guitaretab.com, acordes.lacuerda.net).

Использование:
  lyrics-scraper [опции]

Опции:
  -a, --artist <имя>       Исполнитель: имя ("Земфира") или slug/путь сайта ("zemfira").
                            Для mytabs.ru с явным путём: "v-r/viktor-tsoj". По умолчанию: "ДДТ".
  -l, --list                Только вывести список песен исполнителя (название,
                            просмотры, ссылка) — без скачивания текста и аккордов.
                            С --count не задан — выводятся все найденные песни.
  -n, --count <число>       Сколько песен скачать (или вывести списком с --list).
                            По умолчанию: 20 при скачивании, все — с --list.
                            Игнорируется, если указан --songs.
  -s, --songs <названия...> Скачать конкретную песню или список песен по названию.
      --source <amdm|mytabs|guitaretab|lacuerda>
                            Форсировать конкретный источник вместо автоопределения.
                            По умолчанию источник ищется сам: amdm.ru → mytabs.ru →
                            guitaretab.com → acordes.lacuerda.net.
  -o, --output <файл>       Имя выходного файла. По умолчанию: <slug>_songs.txt
                            (с --list — список тоже сохраняется в файл, если указан).
      --stdout               Вывести текст в stdout вместо записи в файл (файл не
                            создаётся; прогресс уходит в stderr, чтобы stdout
                            содержал только чистый текст — удобно для пайпов).
  -h, --help                Показать эту справку.`);
}

function slugFor(artist: string): string {
  return transliterateToSlug(artist.split("/").pop() ?? artist, "_") || "artist";
}

async function runList(args: Args) {
  // Прогресс в listSongs() и есть сам список (по строке на песню) — просто
  // направляем его в нужный поток, отдельный "результат" собирать не нужно.
  const logProgress = args.stdout ? (m: string) => console.error(m) : (m: string) => console.log(m);

  const result = await listSongs({
    artist: args.artist,
    count: args.count,
    source: args.source,
    onProgress: logProgress,
  });

  if (result.songs.length === 0) {
    fail("Ничего не нашлось.");
  }

  if (args.stdout) {
    const lines = result.songs.map((s, i) => `${i + 1}. ${s.title} — ${s.views.toLocaleString("ru-RU")} просмотров`);
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  if (args.output) {
    const lines = result.songs.map(
      (s, i) => `${i + 1}. ${s.title} — ${s.views.toLocaleString("ru-RU")} просмотров\n   ${s.url}`,
    );
    await writeFile(args.output, lines.join("\n") + "\n", "utf-8");
    console.log(`\n💾 Список сохранён в файл: ${args.output} (источник: ${result.source})`);
  }
}

async function runDownload(args: Args) {
  // С --stdout прогресс уходит в stderr, чтобы в stdout попал только текст —
  // так результат можно пайпить дальше (`| pbcopy`, `> file` и т.п.).
  const logProgress = args.stdout ? (m: string) => console.error(m) : (m: string) => console.log(m);

  const result = await scrapeArtist({
    artist: args.artist,
    count: args.count ?? 20,
    songs: args.songs,
    source: args.source,
    onProgress: logProgress,
  });

  if (result.songs.length === 0) {
    fail("Нечего скачивать.");
  }

  const text = buildOutputFile(result.songs);

  if (args.stdout) {
    process.stdout.write(text);
    return;
  }

  const outputFile = args.output ?? `${slugFor(args.artist)}_songs.txt`;
  await writeFile(outputFile, text, "utf-8");

  console.log(`\n💾 Сохранено в файл: ${outputFile} (источник: ${result.source})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    await runList(args);
  } else {
    await runDownload(args);
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
