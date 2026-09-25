#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { scrapeArtist } from "./scrape.js";
import { buildOutputFile } from "./index.js";
import { transliterateToSlug } from "./translit.js";
import { SOURCE_IDS, type SourceId } from "./types.js";

interface Args {
  artist: string;
  count: number;
  songs?: string[];
  source?: SourceId;
  output?: string;
  stdout: boolean;
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { artist: "ДДТ", count: 20, stdout: false };

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
  -n, --count <число>       Сколько самых популярных песен скачать. По умолчанию: 20.
                            Игнорируется, если указан --songs.
  -s, --songs <названия...> Скачать конкретную песню или список песен по названию.
      --source <amdm|mytabs|guitaretab|lacuerda>
                            Форсировать конкретный источник вместо автоопределения.
                            По умолчанию источник ищется сам: amdm.ru → mytabs.ru →
                            guitaretab.com → acordes.lacuerda.net.
  -o, --output <файл>       Имя выходного файла. По умолчанию: <slug>_songs.txt.
      --stdout               Вывести текст в stdout вместо записи в файл (файл не
                            создаётся; прогресс уходит в stderr, чтобы stdout
                            содержал только чистый текст — удобно для пайпов).
  -h, --help                Показать эту справку.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // С --stdout прогресс уходит в stderr, чтобы в stdout попал только текст —
  // так результат можно пайпить дальше (`| pbcopy`, `> file` и т.п.).
  const logProgress = args.stdout ? (m: string) => console.error(m) : (m: string) => console.log(m);

  const result = await scrapeArtist({
    artist: args.artist,
    count: args.count,
    songs: args.songs,
    source: args.source,
    onProgress: logProgress,
  });

  if (result.songs.length === 0) {
    console.error("❌ Нечего скачивать.");
    process.exit(1);
  }

  const text = buildOutputFile(result.songs);

  if (args.stdout) {
    process.stdout.write(text);
    return;
  }

  const slug = transliterateToSlug(args.artist.split("/").pop() ?? args.artist, "_") || "artist";
  const outputFile = args.output ?? `${slug}_songs.txt`;
  await writeFile(outputFile, text, "utf-8");

  console.log(`\n💾 Сохранено в файл: ${outputFile} (источник: ${result.source})`);
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
