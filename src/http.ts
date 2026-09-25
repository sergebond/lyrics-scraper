export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET-запрос с общими заголовками и таймаутом. Возвращает null при ошибке сети/статусе. */
export async function fetchText(
  url: string,
  init: { timeoutMs?: number; params?: Record<string, string> } = {},
): Promise<string | null> {
  const { timeoutMs = 10_000, params } = init;
  const target = params ? `${url}?${new URLSearchParams(params).toString()}` : url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { headers: HEADERS, signal: controller.signal });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
