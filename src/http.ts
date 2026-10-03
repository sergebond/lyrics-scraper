export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET-запрос с общими заголовками и таймаутом. Возвращает текст и итоговый
 * URL (после редиректов), либо null при ошибке сети/статусе. */
export async function fetchPage(
  url: string,
  init: { timeoutMs?: number; params?: Record<string, string> } = {},
): Promise<{ text: string; finalUrl: string } | null> {
  const { timeoutMs = 10_000, params } = init;
  const target = params ? `${url}?${new URLSearchParams(params).toString()}` : url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { headers: HEADERS, signal: controller.signal });
    if (!response.ok) return null;
    return { text: await response.text(), finalUrl: response.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Как fetchPage, но возвращает только текст. */
export async function fetchText(
  url: string,
  init: { timeoutMs?: number; params?: Record<string, string> } = {},
): Promise<string | null> {
  return (await fetchPage(url, init))?.text ?? null;
}
