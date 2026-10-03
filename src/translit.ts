/**
 * Практическая транслитерация кириллицы в латиницу — совпадает со схемой,
 * которую amdm.ru и mytabs.ru используют для собственных slug'ов исполнителей
 * (проверено на ДДТ->ddt, Земфира->zemfira, Кино->kino, Король и Шут->korol_i_shut,
 * Наутилус Помпилиус->nautilus-pompilius и т.д.).
 */
const TRANSLIT_TABLE: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export function transliterateToSlug(text: string, separator: string, overrides: Record<string, string> = {}): string {
  const table = { ...TRANSLIT_TABLE, ...overrides };
  const chars: string[] = [];
  for (const ch of text.toLowerCase()) {
    if (ch in table) {
      chars.push(table[ch]);
    } else if (/[a-z0-9]/i.test(ch)) {
      chars.push(ch);
    } else {
      chars.push(" ");
    }
  }
  const collapsed = chars.join("").trim().replace(/\s+/g, separator);
  const re = new RegExp(`\\${separator}+`, "g");
  return collapsed.replace(re, separator).replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

/** Варианты slug'а для попытки: основная схема плюс известные вариации
 * (некоторые исполнители транслитерируют "ы" как "i", а не "y" —
 * "Океан Эльзи" вместо "Океан Эльзы") и, для имён из 2–3 слов, обратный
 * порядок слов: сайты нередко держат людей как "Фамилия Имя"
 * ("nikolskiy_konstantin"), а пользователь вводит "Имя Фамилия". Прямой
 * порядок всегда пробуется первым, чтобы не менять поведение там, где оно
 * уже работало. */
export function slugCandidates(text: string, separator: string): string[] {
  const variants: Record<string, string>[] = [{}, { ы: "i" }, { й: "i", ы: "i" }];
  const words = text.trim().split(/\s+/);
  const orders = [text];
  if (words.length >= 2 && words.length <= 3) orders.push([...words].reverse().join(" "));

  const seen: string[] = [];
  for (const order of orders) {
    for (const overrides of variants) {
      const slug = transliterateToSlug(order, separator, overrides);
      if (slug && !seen.includes(slug)) seen.push(slug);
    }
  }
  return seen;
}

/** Ключ имени, не зависящий от регистра и порядка слов — для сравнения
 * "Константин Никольский" и "Никольский Константин". */
export function nameKey(name: string): string {
  return name.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
}
