// Cloudflare Worker: Polytab Event Radar — current-events voting potential discovery
//
// Surfaces "voting potentials" (candidate civic-action blocks) from FREE public
// feeds: Google News RSS, WHO Disease Outbreak News, USGS earthquakes GeoJSON,
// ReliefWeb disasters API. No API keys, no accounts, no cost.
//
// HONEST-ZERO CONTRACT (same as the rest of Polytab):
//   - fundedUSD: 0, votesCount: 0, status: "Proposed", lat/lng: null
//   - "Proposed" ≠ "Active": radar items have NOT passed governance verification
//   - The worker NEVER promotes items into feed.json — promotion is manual,
//     verified, and requires an approved 501(c)(3) organization pairing
//   - No fabricated metrics, ever. No coordinates stored (anti-doxing).
//
// Heavy scanning runs in the GitHub Action (scripts/discover-events.js) so the
// Worker stays read-only/queue-serve duty on the free tier.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve the current radar queue (read-only view of docs/data/event-queue.json)
    if (url.pathname === "/queue") {
      const queue = await readQueue(env);
      return jsonResponse({
        description: queue.description,
        items: queue.items.map((b) => ({
          id: b.id,
          title: b.title,
          category: b.category,
          organization: b.organization,
          location: b.location,
          status: b.status,
          votePriceUSD: b.votePriceUSD,
          targetUSD: b.targetUSD,
          fundedUSD: b.fundedUSD,
          votesCount: b.votesCount,
          sourceFeed: b.radar && b.radar.sourceFeed,
          sourceUrl: b.radar && b.radar.sourceUrl,
          publishedAt: b.radar && b.radar.publishedAt,
          proposedPairing: b.radar && b.radar.proposedPairing
        }))
      });
    }

    // Focus + source configuration (what the scanner looks for)
    if (url.pathname === "/config") {
      return jsonResponse({
        focus: [
          "disabled community", "sick children", "orphans", "cancer", "leukemia",
          "pediatric health", "hospital-bound", "rare disease", "chronic illness",
          "disaster response affecting children/disability communities"
        ],
        freeSources: [
          "GDELT DOC 2.0 API (global news)",
          "CDC Online Newsroom RSS (US public health)",
          "USGS Significant Earthquakes GeoJSON"
        ],
        idSeries: "601+",
        walletSeries: "shared Polytab escrow (Base)",
        status: "Proposed (never auto-promoted to Projects)",
        honestZero: { fundedUSD: 0, votesCount: 0, odds: null, coordinates: null }
      });
    }

    // Verify whether a headline is a focus match (pre-submission check for humans)
    if (url.pathname === "/focus-check") {
      const text = (url.searchParams.get("q") || "").toLowerCase();
      const FOCUS = ["disability", "disabled", "wheelchair", "cancer", "leukemia", "pediatric",
        "children", "child", "hospital", "orphan", "foster", "autism", "blind", "deaf",
        "prosthetic", "amputee", "sick", "illness", "disease", "outbreak", "therapy"];
      const hits = FOCUS.filter((k) => text.includes(k));
      return jsonResponse({ query: url.searchParams.get("q") || "", focusMatch: hits.length > 0, matchedKeywords: hits });
    }

    return new Response(
      "Polytab Event Radar. Free-feed scanner (GDELT, CDC Newsroom, USGS) for global voting potentials. Endpoints: /queue, /config, /focus-check?q=... . Honest-zero: all metrics zero, status Proposed, manual promotion only.",
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

async function readQueue(env) {
  try {
    const res = await fetch("https://r03lv1s.github.io/Polytab/data/event-queue.json");
    if (!res.ok) return { description: "Queue unavailable (scanner has not run yet).", items: [] };
    const data = await res.json();
    if (!Array.isArray(data.items)) return { description: data.description || "", items: [] };
    return data;
  } catch (_) {
    return { description: "Queue unavailable.", items: [] };
  }
}
