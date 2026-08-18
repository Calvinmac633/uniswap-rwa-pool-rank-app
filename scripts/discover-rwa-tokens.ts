// Standalone checkpoint script for Step 1/2 of the build: run real pool
// discovery + RWA classification against the live chain and API, and print the
// result for human review before building anything further on top of it.
//
// Run with: npm run discover-tokens
import { discoverUniswapPools } from "../src/lib/gecko/discovery";
import { classifyTokens } from "../src/lib/rwa/classify";

async function main() {
  console.log("Scanning Uniswap v2/v3/v4 pools on Robinhood Chain via GeckoTerminal...\n");
  const discovery = await discoverUniswapPools();

  console.log(`Pools found: ${discovery.pools.length}`);
  console.log(`  v2: ${discovery.pools.filter((p) => p.version === "v2").length}`);
  console.log(`  v3: ${discovery.pools.filter((p) => p.version === "v3").length}`);
  console.log(`  v4: ${discovery.pools.filter((p) => p.version === "v4").length}`);
  console.log(`Unique candidate tokens: ${discovery.candidateTokens.size}`);
  if (discovery.errors.length > 0) {
    console.log(`\nDiscovery errors (${discovery.errors.length}):`);
    for (const e of discovery.errors) console.log(`  - ${e}`);
  }
  if (discovery.hitSafetyCap.length > 0) {
    console.log(`\nWARNING: pagination safety cap hit for: ${discovery.hitSafetyCap.join(", ")} (results may be incomplete)`);
  }

  console.log("\nClassifying candidate tokens (Robinhood registry + on-chain uiMultiplier() probe)...\n");
  const classification = await classifyTokens(discovery.candidateTokens);

  if (classification.registryError) {
    console.log(`WARNING: Robinhood registry fetch failed: ${classification.registryError}`);
    console.log("(classification will rely on uiMultiplier() alone until this is fixed)\n");
  }

  const rwaTokens = [...classification.tokens.values()].filter((t) => t.isRwa);
  const nonRwaCandidates = [...classification.tokens.values()].filter((t) => !t.isRwa);
  const warnings = [...classification.tokens.values()].filter((t) => t.warning);

  console.log(`RWA tokens confirmed (uiMultiplier() succeeded): ${rwaTokens.length}`);
  console.log("=".repeat(100));
  console.log(
    ["Symbol".padEnd(10), "Name".padEnd(30), "Address".padEnd(44), "Decimals".padEnd(9), "Registry".padEnd(9), "ISIN"].join(" | ")
  );
  console.log("-".repeat(100));
  for (const t of rwaTokens.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    console.log(
      [
        t.symbol.padEnd(10),
        t.name.slice(0, 30).padEnd(30),
        t.address.padEnd(44),
        String(t.decimals).padEnd(9),
        (t.inRegistry ? "yes" : "NO").padEnd(9),
        t.isin ?? "",
      ].join(" | ")
    );
  }

  console.log(`\nNon-RWA candidate tokens seen in pools (excluded): ${nonRwaCandidates.length}`);
  console.log(
    nonRwaCandidates
      .map((t) => t.symbol)
      .sort()
      .join(", ")
  );

  if (warnings.length > 0) {
    console.log(`\nDISAGREEMENTS / WARNINGS (${warnings.length}) — registry vs on-chain probe did not agree:`);
    console.log("=".repeat(100));
    for (const t of warnings) {
      console.log(`  [${t.symbol}] ${t.warning}`);
    }
  } else {
    console.log("\nNo disagreements between the registry and the on-chain uiMultiplier() probe.");
  }

  console.log("\n--- STOP: review the RWA token list above before continuing the build. ---");
}

main().catch((err) => {
  console.error("discover-rwa-tokens failed:", err);
  process.exit(1);
});
