// GitHub Action script: market resolution checks (3-tier oracle)
// Free tier (unlimited minutes on public repos) — zero cost
//
// Tier 1 — deterministic: fetch public data feeds, SHA-256 verify, auto-settle
// Tier 2 — community dispute window via GitHub Issues
// Tier 3 — 2-of-3 multi-sig final call
//
// Adversarial "Civic Short" markets (named officials/corporations) are
// SHELVED pending legal review. Only futarchy policy markets ship.

const fs = require("fs");
const path = require("path");

const MARKETS_PATH = path.join(__dirname, "..", "docs", "data", "markets.json");

async function main() {
  const data = JSON.parse(fs.readFileSync(MARKETS_PATH, "utf8"));
  const markets = data.markets || [];
  const marketsFile = data;

  for (const m of markets) {
    const deadline = m.oracle && m.oracle.resolutionDeadline;
    const overdue = deadline ? new Date(deadline) < new Date() : false;
    console.log(`${m.id} [${m.status}] method=${(m.oracle && m.oracle.method) || "unknown"} deadline=${deadline || "none"} overdue=${overdue}`);

    if (m.status === "Open" && overdue) {
      console.log(`  -> Resolution due. Tier: ${m.oracle.method}`);
      if (m.oracle.method === "deterministic-public-data") {
        // TODO (production):
        //  1. fetch(m.oracle.source), SHA-256 hash the body
        //  2. apply m.resolutionRule against the parsed data
        //  3. if unambiguous, write status "Resolved (pending dispute window)" to markets.json
        console.log("  -> deterministic fetch/settle integration pending");
      } else {
        // TODO (production): open a GitHub Issue titled "[Market Resolution]: <id>"
        // with evidence template, apply dispute-window label, notify multi-sig council
        console.log("  -> dispute-window issue creation integration pending");
      }
    }
    // Honest-zero guard: never write nonzero totals/splits unless verified on-chain
    if (m.totalVolumeUSD !== 0 || m.forecastSplit !== null) {
      throw new Error(`${m.id} has fabricated metrics (funded total / forecast split must stay zero until on-chain verification)`);
    }
    // Funding policy guard: 100% must reach the project. No fee, no staker payout.
    const policy = marketsFile.fundingPolicy;
    if (!policy || policy.projectEscrowPct !== 100 || policy.protocolFeePct !== 0 || policy.stakerPayoutPct !== 0) {
      throw new Error(`${m.id} funding policy must be 100% project escrow, 0% protocol fee, 0% staker payout`);
    }
  }
  console.log(`Checked ${markets.length} markets. All metrics honest-zero.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
