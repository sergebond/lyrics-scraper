/**
 * Общее ядро форматирования текста песни в целевой формат:
 * - UTF-8, LF, без табов;
 * - метки разделов без квадратных скобок, с двоеточием ("Куплет 1:", "Припев:", ...);
 * - аккорды на отдельной строке над текстом, с сохранением горизонтального выравнивания;
 * - альтернативные аккорды в скобках разносятся через пробел ("Am (A7)" -> "Am A7");
 * - пояснительные комментарии в скобках убираются;
 * - гитарная табулатура убирается — остаются только текст и аккорды;
 * - не более одной пустой строки между разделами.
 *
 * Логика перенесена без изменений из ddt_scraper.py (сайт amdm.ru) и дополнена
 * метками "Соло"/"Под припев" и поддержкой меток без двоеточия — это нужно
 * для mytabs.ru, где встречаются такие варианты разметки.
 */

const DEFAULT_LABEL_WORDS = [
  "Вступление",
  "Вcтупление", // опечатка с латинской "c", встречается на amdm.ru
  "Куплет",
  "Припев",
  "Проигрыш",
  "Кода",
  "Перебор",
  "Соло",
  "Под припев",
] as const;

// Аккорд латиницей: A-H, диезы/бемоли, минор/септаккорды/сложные надстройки,
// бас через косую черту (Am7/G).
const CHORD_TOKEN_RE = /^[A-H](#|b)?(maj7|sus4|add9|dim|m|7|9|6)*(\/[A-H](#|b)?\d*)?$/;

function isTabLine(line: string): boolean {
  const stripped = line.trim();
  if (!stripped) return false;
  // Строка табулатуры, начинающаяся с названия струны: e|, E|, B||, G|, D|, A|
  if (/^[eEBGDA]{1,2}\|/.test(stripped)) return true;
  // Строка-аннотация табулатуры из одних служебных символов (продолжения
  // линий струн, метки позиций и т.п.), без единой буквы.
  if (/^[-|/\\~x0-9hpb\s]+$/.test(stripped) && /[-|]/.test(stripped)) return true;
  return false;
}

// Пробел в конце строки: помимо стандартного \s (который в JS не включает
// NEL/LS/PS) — эти символы изредка встречаются на некоторых сайтах как
// артефакт кодировки внутри текстовых узлов.
const TRAILING_WS_RE = new RegExp("[\\s\\u0085\\u2028\\u2029]+$");

/** Убирает гитарную табулатуру, оставляя только текст песни и аккорды. */
export function removeTabs(text: string): string {
  const result: string[] = [];
  for (let line of text.split("\n")) {
    // Первая строка табулатуры иногда слита с меткой раздела в одну строку
    // без переноса, например "[Вступление]:E|----...". Обрезаем всё начиная
    // с названия струны, оставляя только метку.
    line = line.replace(/[eEBGDA]{1,2}\|(?=[-\d]).*$/, "").replace(TRAILING_WS_RE, "");
    if (isTabLine(line)) continue;
    // Обрезаем висящий "хвост" из позиционных символов табулатуры
    // (например, комментарий "Момент в соло ... ||  ||  ||").
    line = line.replace(/(?:\s+[|/\\-]+)+$/, "");
    result.push(line);
  }
  return result.join("\n");
}

/** Схлопывает несколько пустых строк подряд в одну, убирает пустые строки по краям. */
export function collapseBlankLines(text: string): string {
  const lines = text.split("\n").map((l) => l.replace(TRAILING_WS_RE, ""));
  const out: string[] = [];
  let prevEmpty = false;
  for (const line of lines) {
    if (line) {
      out.push(line);
      prevEmpty = false;
    } else if (!prevEmpty) {
      out.push("");
      prevEmpty = true;
    }
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface FormatBodyOptions {
  /** Дополнительные метки разделов сверх набора по умолчанию. */
  extraLabelWords?: string[];
  /** Метки, которые нужно нумеровать по числу вхождений в песне
   * ("Куплет 1:", "Куплет 2:", ...; для англоязычных источников — "Verse").
   * По умолчанию нумеруется только "Куплет" (поведение amdm.ru/mytabs.ru
   * не меняется, если явно не передать другой список). */
  numberedLabelWords?: string[];
}

/** Заменяет содержимое круглых скобок: альтернативный аккорд разносится через
 * пробел без скобок, пояснительный комментарий (в т.ч. многострочный)
 * стирается с сохранением переносов строк (не сдвигает выравнивание дальше). */
function cleanParens(text: string): string {
  return text.replace(/\(([^()]+)\)/gs, (whole, inner: string) => {
    const trimmed = inner.trim();
    if (CHORD_TOKEN_RE.test(trimmed) && !whole.includes("\n")) {
      return trimmed;
    }
    return whole.replace(/[^\n]/g, " ");
  });
}

export function formatBody(rawText: string, options: FormatBodyOptions = {}): string {
  const labelWords = [...DEFAULT_LABEL_WORDS, ...(options.extraLabelWords ?? [])];
  const numberedWords = new Set(options.numberedLabelWords ?? ["Куплет"]);
  const labelAlt = labelWords.map(escapeRe).join("|");
  const labelRe = new RegExp(
    `^\\s*\\[?\\s*(${labelAlt})(\\s*\\d+)?[^\\]:]*\\]?:\\s*(.*)$`,
  );
  const bareLabelRe = new RegExp(`^\\s*(${labelAlt})(\\s*\\d+)?\\s*$`);
  // Строка-сноска вида "E * (для последней строчки первого куплета)": после
  // удаления пояснительного комментария от неё останется голый аккорд без
  // текста под ним — такая строка не несёт содержания, убираем целиком.
  const footnoteRe = /^\s*[A-H][^()]*\*\s*$/;

  let text = rawText.replace(/\t/g, " ").replace(/ /g, " ");
  // Скобки убираем на уровне всего текста, а не отдельной строки: комментарий
  // иногда разбит на две строки (например, описание боя).
  text = cleanParens(text);

  const outLines: string[] = [];
  const verseCounters = new Map<string, number>();

  const makeLabelText = (word: string, num: string | undefined): string => {
    const normalizedWord = word === "Вcтупление" ? "Вступление" : word;
    if (numberedWords.has(normalizedWord)) {
      const n = (verseCounters.get(normalizedWord) ?? 0) + 1;
      verseCounters.set(normalizedWord, n);
      return `${normalizedWord} ${n}:`;
    }
    if (normalizedWord === "Перебор") {
      const n = (num ?? "").trim();
      return n ? `Перебор ${n}:` : "Перебор:";
    }
    return `${normalizedWord}:`;
  };

  for (const line of text.split("\n")) {
    if (footnoteRe.test(line)) continue;

    const m = labelRe.exec(line);
    if (m) {
      const [, word, num, rest] = m;
      const labelText = makeLabelText(word, num);
      if (outLines.length === 0 || outLines[outLines.length - 1] !== labelText) {
        outLines.push(labelText);
      }
      const restTrimmed = rest.replace(TRAILING_WS_RE, "");
      if (restTrimmed.trim()) {
        const prefixLen = line.length - rest.length;
        outLines.push(" ".repeat(prefixLen) + restTrimmed);
      }
      continue;
    }

    const bare = bareLabelRe.exec(line);
    if (bare) {
      const [, word, num] = bare;
      const labelText = makeLabelText(word, num);
      if (outLines.length === 0 || outLines[outLines.length - 1] !== labelText) {
        outLines.push(labelText);
      }
      continue;
    }

    let cleaned = line.replace(TRAILING_WS_RE, "");
    cleaned = cleaned.replace(/[[\]]/g, "");
    outLines.push(cleaned);
  }

  return collapseBlankLines(outLines.join("\n"));
}

/** Аккорд в сольфеджио (Do-Re-Mi-Fa-Sol-La-Si) — используется на некоторых
 * испаноязычных сайтах наравне с латинскими буквами (A-H). Не входит в
 * основной CHORD_TOKEN_RE, чтобы не расширять поведение для amdm.ru/mytabs.ru,
 * где эта нотация не встречается — но detectKey() принимает её опционально. */
const SOLFEGE_CHORD_RE = /^(Do|Re|Mi|Fa|Sol|La|Si)(#|b)?(maj7|sus4|add9|dim|m|7|9|6)*(\/(Do|Re|Mi|Fa|Sol|La|Si)(#|b)?)?$/i;

/** Определяет тональность как первый аккорд, встречающийся в тексте.
 * withSolfege включает распознавание нотации Do-Re-Mi (для lacuerda.net). */
export function detectKey(bodyText: string, options: { withSolfege?: boolean } = {}): string {
  for (const line of bodyText.split("\n")) {
    for (const token of line.split(/\s+/)) {
      if (!token) continue;
      if (CHORD_TOKEN_RE.test(token)) return token;
      if (options.withSolfege && SOLFEGE_CHORD_RE.test(token)) return token;
    }
  }
  return "";
}

export function formatSongBlock(song: { title: string; artist: string; key: string; url: string; body: string }): string {
  const header =
    `Название: ${song.title}\n` +
    `Исполнитель: ${song.artist}\n` +
    `Тональность:${song.key ? " " + song.key : ""}\n` +
    `Источник: ${song.url}`;
  return `${header}\n\n${song.body}`;
}

export const SEPARATOR = "=".repeat(40);

export function formatOutputFile(songBlocks: string[]): string {
  return songBlocks.join(`\n${SEPARATOR}\n`) + "\n";
}
