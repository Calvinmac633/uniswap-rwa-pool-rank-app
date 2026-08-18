// Thin GeckoTerminal API client: a rate limiter (free tier is ~30 calls/min,
// shared across this whole app since it's a single personal deployment), plus
// 429 backoff. Every call returns a Result instead of throwing, so callers can
// render partial results with a clear "incomplete" banner instead of a full
// page crash — per the "never render a half-loaded table as if complete" rule,
// the caller (not this module) is responsible for surfacing that banner.
const BASE_URL = "https://api.geckoterminal.com/api/v2";

// Real limit is ~30/min; target 28/min to leave a little headroom for other
// traffic hitting the same public IP without throttling harder than needed.
const MAX_CALLS_PER_MINUTE = 28;
const WINDOW_MS = 60_000;
const callTimestamps: number[] = [];

async function throttle(): Promise<void> {
  while (true) {
    const now = Date.now();
    while (callTimestamps.length > 0 && now - callTimestamps[0]! > WINDOW_MS) {
      callTimestamps.shift();
    }
    if (callTimestamps.length < MAX_CALLS_PER_MINUTE) {
      callTimestamps.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - callTimestamps[0]!) + 50;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export type GeckoResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; rateLimited: boolean };

const MAX_429_RETRIES = 3;

export async function geckoGet<T>(path: string, searchParams?: Record<string, string | number>): Promise<GeckoResult<T>> {
  const url = new URL(`${BASE_URL}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, String(value));
    }
  }

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    await throttle();

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message, rateLimited: false };
    }

    if (res.status === 429) {
      if (attempt < MAX_429_RETRIES) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }
      return { ok: false, status: 429, error: "Rate limited by GeckoTerminal after retries", rateLimited: true };
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = JSON.stringify(body);
      } catch {
        // ignore — not all error bodies are JSON
      }
      return { ok: false, status: res.status, error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`, rateLimited: false };
    }

    const data = (await res.json()) as T;
    return { ok: true, data };
  }

  // Unreachable, but keeps TypeScript happy.
  return { ok: false, status: 429, error: "Rate limited", rateLimited: true };
}
