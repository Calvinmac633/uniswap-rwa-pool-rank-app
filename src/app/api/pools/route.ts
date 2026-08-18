// Fast-tier endpoint: pool discovery (cached ~30min) + live TVL/volume/tick
// state (cached ~90s). Called on page load and on manual refresh.
import { NextResponse } from "next/server";
import { getFastPoolData } from "@/lib/pools/aggregate";
import { serializePoolRow } from "../serialize";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const forceRescan = searchParams.get("rescan") === "1";

  try {
    const { rows, meta } = await getFastPoolData({ forceRefresh, forceRescan });
    return NextResponse.json({ rows: rows.map(serializePoolRow), meta });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load pool data: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
