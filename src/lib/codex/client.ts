// Thin Codex (codex.io) GraphQL client. Codex is a pre-indexed data source
// (the API behind Defined.fi), so one filtered query replaces what used to be
// dozens of rate-limited GeckoTerminal page fetches. Free tier: 5 req/s,
// 10k req/month — callers should cache aggressively.
const CODEX_API_URL = "https://graph.codex.io/graphql";

// Stay under the 5 req/s free-tier limit even if several callers overlap.
const MIN_SPACING_MS = 250;
let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_SPACING_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export type CodexResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function codexQuery<T>(query: string, variables?: Record<string, unknown>): Promise<CodexResult<T>> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!apiKey) return { ok: false, error: "CODEX_API_KEY is not set — add it to .env." };

  await throttle();
  let res: Response;
  try {
    res = await fetch(CODEX_API_URL, {
      method: "POST",
      // Regular Codex API keys go in Authorization as-is — no "Bearer" prefix.
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, error: `Codex unreachable: ${(err as Error).message}` };
  }

  // GraphQL validation errors come back as HTTP 400 with an `errors` body.
  let body: { data?: T; errors?: Array<{ message: string }> };
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Codex HTTP ${res.status} (non-JSON body)` };
  }
  if (body.errors?.length) return { ok: false, error: body.errors.map((e) => e.message).join("; ") };
  if (!res.ok || body.data === undefined) return { ok: false, error: `Codex HTTP ${res.status}` };
  return { ok: true, data: body.data };
}
