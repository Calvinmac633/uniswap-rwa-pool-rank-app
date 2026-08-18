// Slow-tier endpoint: OHLCV-derived window volumes + realized volatility for a
// client-chosen set of pools. A POST (not GET) because the pool address list
// can be long enough to exceed a comfortable query-string length, and because
// this is a "do work" request, not an idempotent fetch — the client explicitly
// controls which pools to spend rate-limit budget on (see the UI's "load trend
// data" control), rather than the server unilaterally fetching everything.
import { NextResponse } from "next/server";
import { getSlowPoolData } from "@/lib/pools/candles";

const MAX_ADDRESSES_PER_REQUEST = 60; // ~2 GeckoTerminal calls each; keeps one request's wall time reasonable

export async function POST(request: Request) {
  let body: { addresses?: unknown; forceRefresh?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.addresses) || !body.addresses.every((a) => typeof a === "string")) {
    return NextResponse.json({ error: "`addresses` must be an array of strings." }, { status: 400 });
  }
  if (body.addresses.length === 0) {
    return NextResponse.json({ metrics: {}, errors: [] });
  }
  if (body.addresses.length > MAX_ADDRESSES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Request at most ${MAX_ADDRESSES_PER_REQUEST} pool addresses per call; split into multiple requests.` },
      { status: 400 }
    );
  }

  try {
    const { metrics, errors } = await getSlowPoolData(body.addresses as string[], body.forceRefresh === true);
    return NextResponse.json({ metrics: Object.fromEntries(metrics), errors });
  } catch (err) {
    return NextResponse.json({ error: `Failed to load candle data: ${(err as Error).message}` }, { status: 500 });
  }
}
