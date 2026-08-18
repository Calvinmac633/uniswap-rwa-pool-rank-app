import type { AbiEvent, GetLogsParameters, GetLogsReturnType } from "viem";
import { publicClient } from "./client";

const MIN_CHUNK_BLOCKS = 1_000n;
const RETRIES_PER_CHUNK = 2;

// The free Robinhood RPC intermittently rejects/times out wide-range eth_getLogs
// calls (this isn't a documented fixed limit — a sibling project on this same
// chain observed it inconsistently, e.g. a 500k-block range failing while a
// 20M-block range succeeded moments later). This chain also produces blocks
// every ~100ms, so it's already tens of millions of blocks tall a few weeks in
// — a small fixed initial chunk size would need hundreds of sequential round
// trips before ever finding out the RPC could have handled it in one call.
// So: always attempt the *entire* requested range first, and only shrink
// (down to a floor) if that specific range actually fails. For a sparse event
// (this is only ever used for v4's Initialize, of which there are a couple
// hundred total on this chain), the single full-range call almost always
// succeeds regardless of block span, since providers typically limit by
// result size, not range width.
export async function getLogsChunked<
  const TAbiEvent extends AbiEvent | undefined = undefined,
  const TAbiEvents extends readonly AbiEvent[] | readonly unknown[] | undefined = TAbiEvent extends AbiEvent
    ? [TAbiEvent]
    : undefined,
  TStrict extends boolean | undefined = undefined,
>(
  params: GetLogsParameters<TAbiEvent, TAbiEvents, TStrict> & { fromBlock: bigint; toBlock: bigint }
): Promise<GetLogsReturnType<TAbiEvent, TAbiEvents, TStrict>> {
  const results: GetLogsReturnType<TAbiEvent, TAbiEvents, TStrict> = [];
  let cursor = params.fromBlock;
  let chunkSize = params.toBlock - params.fromBlock + 1n; // irrelevant if toBlock < fromBlock — loop below never runs

  while (cursor <= params.toBlock) {
    const end = cursor + chunkSize - 1n > params.toBlock ? params.toBlock : cursor + chunkSize - 1n;
    let succeeded = false;

    for (let attempt = 0; attempt <= RETRIES_PER_CHUNK && !succeeded; attempt++) {
      try {
        const chunkLogs = await publicClient.getLogs({ ...params, fromBlock: cursor, toBlock: end });
        (results as unknown[]).push(...chunkLogs);
        cursor = end + 1n;
        succeeded = true;
      } catch {
        if (attempt < RETRIES_PER_CHUNK) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }

    if (!succeeded) {
      chunkSize = chunkSize / 2n;
      if (chunkSize < MIN_CHUNK_BLOCKS) {
        throw new Error(
          `getLogsChunked: range starting at block ${cursor} still failing at minimum chunk size (${MIN_CHUNK_BLOCKS} blocks)`
        );
      }
    }
  }

  return results;
}
