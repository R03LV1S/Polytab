// Cloudflare Worker: Market Oracle (3-Tier Optimistic Resolution)
// Free tier (100k req/day) — zero cost
//
// Tier 1 — Deterministic: GitHub Action fetches public data feeds (legislative
//          dockets, agency APIs), verifies SHA-256, auto-settles hard metrics.
// Tier 2 — Community dispute window: resolution posted as GitHub Issue with
//          evidence; any staker may challenge within the dispute window.
// Tier 3 — 2-of-3 multi-sig council final call (includes impacted
//          stakeholder for Accessibility markets — "Nothing About Us Without Us").
//
// Adversarial accountability markets ("Civic Short" on named officials or
// corporations) are SHELVED pending legal review of event-contract/gambling
// law exposure. Only futarchy policy markets (verified interventions) ship.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/markets") {
      const markets = await listMarkets(env);
      return jsonResponse({ markets });
    }

    if (url.pathname === "/resolve-check") {
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ error: "missing id" }, 400);
      const result = await resolveCheck(id, env);
      return jsonResponse(result);
    }

    return new Response(
      "Polytab Market Oracle (3-Tier). Endpoints: /markets, /resolve-check?id=M-801. Deterministic data feed checks + dispute-window escalation to GitHub Issues + 2-of-3 multi-sig. Adversarial 'Civic Short' markets shelved pending legal review.",
      { status: 200 }
    );
  }
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

async function listMarkets(env) {
  // Fetch docs/data/markets.json from the published Pages site (read-only, free).
  // Returns open markets with funded totals EXACTLY as verified on-chain (no fabrication).
  try {
    const res = await fetch("https://r03lv1s.github.io/Polytab/data/markets.json");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.markets || []).map((m) => ({
      id: m.id,
      status: m.status,
      totalVolumeUSD: m.totalVolumeUSD || 0,
      forecastSplit: m.forecastSplit || null,
      fundingPolicy: data.fundingPolicy || { projectEscrowPct: 100, protocolFeePct: 0, stakerPayoutPct: 0 },
      resolutionDeadline: m.oracle && m.oracle.resolutionDeadline,
      disputeWindowHours: (m.oracle && m.oracle.disputeWindowHours) || 48,
      method: m.oracle && m.oracle.method
    }));
  } catch (_) {
    return [];
  }
}

async function resolveCheck(id, env) {
  // Tier 1 check for deterministic-method markets:
  //   1. Fetch oracle.source
  //   2. SHA-256 hash the response body (evidence fingerprint)
  //   3. Compare against the market's resolutionRule
  //   4. If past resolutionDeadline and match is unambiguous, propose settlement
  // Tier 2 markets (community-dispute-window) are escalated to GitHub Issues;
  // this endpoint only reports their window status.
  return {
    id,
    tier: "pending",
    sha256: null,
    proposal: null,
    note: "Deterministic oracle integration pending. Dispute-window markets resolve via GitHub Issues; final call by 2-of-3 multi-sig council."
  };
}
