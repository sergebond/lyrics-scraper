# lyrics-scraper

Скачивает тексты песен с аккордами с [amdm.ru](https://amdm.ru),
[mytabs.ru](https://mytabs.ru) (русско-/украиноязычные исполнители),
[guitaretab.com](https://www.guitaretab.com) (англоязычные) и
[acordes.lacuerda.net](https://acordes.lacuerda.net) (испаноязычные), и
приводит их к единому текстовому формату (см. «Формат вывода» ниже).
Работает как библиотека, которую можно подключить в Next.js-проект
(Route Handler / Server Action), так и как самостоятельный CLI.

Требует Node.js 18+ (нужен встроенный `fetch`). Запросы делаются только на
сервере — модуль не предназначен для клиентских компонентов.

## Установка

```bash
npm install
```

## Использование как модуля (в Next.js)

Самый короткий путь — `getSongsText`: один вызов, сразу текст, ничего не
пишется на диск.

```ts
// app/api/songs/route.ts
import { getSongsText } from "lyrics-scraper";

export async function POST(req: Request) {
  const { artist, count } = await req.json();

  const text = await getSongsText({ artist, count }); // строка

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${artist}_songs.txt"`,
    },
  });
}
```

Если, помимо текста, нужны ещё и метаданные (какой источник реально
использовался, какие из `songs` не нашлись) — `getSongsText` это просто
`scrapeArtist` + `buildOutputFile`, можно вызвать их по отдельности:

```ts
import { scrapeArtist, buildOutputFile } from "lyrics-scraper";

const result = await scrapeArtist({ artist, count });
// result.source — какой сайт реально использовался ("amdm" | "mytabs" | "guitaretab" | "lacuerda")
// result.notFound — какие из songs не нашлись (если передавались songs)

const text = buildOutputFile(result.songs); // то же самое, что вернул бы getSongsText
```

Ни `getSongsText`, ни `scrapeArtist`, ни `buildOutputFile` не пишут файлы —
запись на диск есть только в CLI (`-o/--output`, см. ниже).

`scrapeArtist` сама определяет, откуда качать: перебирает источники по
очереди — **amdm.ru → mytabs.ru → guitaretab.com → acordes.lacuerda.net** —
и останавливается на первом, где исполнитель нашёлся и у него есть песни.
Так, например, для «ДДТ» результат придёт с amdm.ru, для «Кино» (все подборы
которого удалены с amdm.ru по требованию правообладателя) — с mytabs.ru
(если передать точный путь, см. ниже), а для «Metallica» — с того источника,
что откликнется первым (в данном случае обычно amdm.ru — там тоже есть
зарубежный рок). При необходимости источник можно форсировать через
`source`.

### Опции `scrapeArtist`

| Поле         | Тип                        | По умолчанию | Описание |
|--------------|-----------------------------|--------------|----------|
| `artist`     | `string`                    | —            | Имя исполнителя (любым языком) или slug/путь сайта |
| `count`      | `number`                    | `20`         | Сколько самых популярных песен взять. Игнорируется при `songs` |
| `songs`      | `string[]`                  | —            | Конкретная песня/список песен по названию вместо топ-N |
| `source`     | `"amdm" \| "mytabs" \| "guitaretab" \| "lacuerda"` | автоперебор всех четырёх | Форсировать конкретный источник вместо автоопределения |
| `onProgress` | `(message: string) => void` | —            | Коллбек прогресса — удобно стримить в UI |

### Особые случаи резолвинга исполнителя

- **amdm.ru**: имя транслитерируется в slug (несколько вариантов схемы, включая
  случай "ы" → "i"), а при неудаче — ищется через `/search/` сайта.
- **mytabs.ru**: аналогично транслитерируется (через дефис), но часть
  исполнителей каталогизирована там под именем человека, а не сценическим
  названием — например «Кино» лежит под `viktor-tsoj`. Для таких случаев
  передавайте `artist` как путь с `/`, например:

  ```ts
  await scrapeArtist({ artist: "v-r/viktor-tsoj", source: "mytabs", count: 20 });
  ```

  (буквенный префикс папки на mytabs.ru сервер не проверяет — подойдёт
  любой; используйте реальный, если он вам известен, иначе просто `x/slug`).

- **guitaretab.com**: резолвится через встроенный поиск сайта
  (`/fetch/?type=tab&query=...`), потому что буквенный путь исполнителя не
  всегда совпадает с первой буквой имени (например "The Beatles" лежит под
  `/b/beatles/`, отбрасывая "The"). Берутся только подборы с суффиксом
  "chords" (не "tab"/"bass"/"drum" — те без текста песни). Популярность —
  число оценок (`gt-rating__counter`), сайт не публикует прямой счётчик
  просмотров.
- **lacuerda.net**: slug — латиница/транслитерация с "_" (как и у
  amdm.ru/mytabs.ru). Сайт **не публикует ни счётчик просмотров, ни
  рейтинг** на странице исполнителя, поэтому "топ-N" здесь на самом деле —
  первые N песен в порядке, в котором они перечислены на странице
  исполнителя (не настоящая популярность). Часть песен использует
  сольфеджио (Do-Re-Mi-Fa-Sol-La-Si) вместо латинских букв — аккорды в
  тексте не трогаются (остаются как в источнике), но для определения
  «Тональность:» сольфеджио распознаётся отдельно.

### Английские и испанские метки разделов

Для guitaretab.com/lacuerda.net `formatBody` получает свои наборы меток
(`Verse`/`Chorus`/`Bridge`/... и `Estrofa`/`Coro`/`Puente`/... соответственно)
через `FormatBodyOptions.extraLabelWords`, а нумеруются («Verse 1:», «Verse
2:», ...) — через `numberedLabelWords`. Для amdm.ru/mytabs.ru поведение не
меняется (нумеруется только «Куплет», как и раньше).

## Использование как CLI

```bash
npx tsx src/cli.ts --artist ДДТ --count 20
npx tsx src/cli.ts --artist "Земфира" --count 10
npx tsx src/cli.ts --artist ddt --songs "Дождь" "Метель" "Осень"
npx tsx src/cli.ts --artist "v-r/viktor-tsoj" --source mytabs --count 20
npx tsx src/cli.ts --artist Radiohead --source guitaretab --count 20
npx tsx src/cli.ts --artist Shakira --source lacuerda --count 10
npx tsx src/cli.ts --artist ddt --count 5 --output my_file.txt
npx tsx src/cli.ts --artist ddt --count 5 --stdout          # текст в stdout, файл не создаётся
```

| Флаг                    | Описание |
|--------------------------|----------|
| `-a, --artist <имя>`     | Исполнитель (см. выше) |
| `-n, --count <число>`    | Сколько самых популярных песен скачать (по умолчанию 20) |
| `-s, --songs <названия>` | Одна или несколько конкретных песен вместо топ-N |
| `--source <amdm\|mytabs\|guitaretab\|lacuerda>` | Форсировать источник вместо автоопределения |
| `-o, --output <файл>`    | Имя выходного файла (по умолчанию `<slug>_songs.txt`) |
| `--stdout`               | Вывести текст в stdout вместо записи в файл (прогресс уходит в stderr) |

## Формат вывода

```
Название: Пример песни
Исполнитель: Пример исполнителя
Тональность: Am
Источник: https://example.com/primer

Куплет 1:
Am          C
Первая строка текста
F           G
Вторая строка текста

Припев:
Am F
C  G
========================================
Название: Вторая песня
...
```

- UTF-8, переводы строк LF, без табов и висячих пробелов.
- Ровно 40 знаков `=` между песнями, без разделителя перед первой.
- Метки разделов без квадратных скобок, аккорды — отдельной строкой над
  текстом, с сохранением горизонтального выравнивания.
- Альтернативные аккорды в скобках разносятся через пробел (`Am (A7)` →
  `Am A7`), пояснительные комментарии в скобках убираются.
- Гитарная табулатура убирается — остаются только текст и аккорды.

## Структура

```
src/
  types.ts        — общие типы (Song, ChordSource, ScrapeOptions, ...)
  textFormat.ts    — ядро форматирования текста (общее для всех источников)
  translit.ts      — транслитерация кириллицы в slug
  select.ts        — дедупликация/выбор топ-N или конкретных песен
  http.ts          — общий fetch с заголовками и таймаутом
  sources/
    amdm.ts        — адаптер amdm.ru
    mytabs.ts      — адаптер mytabs.ru
    guitaretab.ts  — адаптер guitaretab.com
    lacuerda.ts    — адаптер acordes.lacuerda.net
  scrape.ts        — оркестратор: перебор источников, выбор, загрузка
  index.ts         — публичный API модуля
  cli.ts           — точка входа для автономного запуска
```

Добавить новый сайт-источник — значит реализовать интерфейс `ChordSource`
(`resolveArtist`, `listEntries`, `fetchSong`) в `src/sources/` и добавить его
в `AUTO_ORDER` в `scrape.ts`.
