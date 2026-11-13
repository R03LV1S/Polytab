// Cloudflare Worker: Organization Discovery & Verification
// Focus: Disabled community, sick children, orphans, cancer, leukemia, pediatric health
// Output: EXACT Polytab block schema (same JSON format as the curated blocks in feed.json)
// Runs on free tier (100k req/day) — zero cost

// Only these categories are valid on the site (docs/data/categories.json)
const VALID_CATEGORIES = [
  "Accessibility & Universal Design",
  "Campus Grounds",
  "Athletics",
  "Classrooms",
  "Arts & Clubs",
  "Civic Tech",
  "Environmental"
];

const FOCUS_KEYWORDS = [
  "disability", "disabled", "accessibility", "assistive", "wheelchair",
  "cancer", "leukemia", "oncology", "pediatric", "children", "child",
  "hospital", "medical", "health", "rehabilitation", "therapy",
  "blind", "deaf", "autism", "cerebral palsy", "amputee", "prosthetic",
  "orphan", "foster", "special needs", "rare disease", "chronic illness",
  "service dog", "guide dog", "mobility", "hearing loss", "vision impairment",
  "sick", "illness", "disease", "treatment", "care", "support", "hospice"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/discover") {
      const newOrgs = await discoverOrgs(env);
      // Emit blocks in the EXACT same format as the curated JSON blocks
      const blocks = newOrgs.map((org, i) => formatBlock(org, nextId(env, i)));
      return new Response(JSON.stringify({ discovered: blocks.length, blocks }, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname === "/verify") {
      const name = url.searchParams.get("name");
      const result = await verifyOrg(name);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname === "/categories") {
      return new Response(JSON.stringify({ valid: VALID_CATEGORIES, focus: FOCUS_KEYWORDS }, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response("Polytab Org Discovery Worker. Focus: disabled community, sick children, cancer, leukemia. Endpoints: /discover, /verify?name=..., /categories", { status: 200 });
  }
};

// All unclaimed bounties route to the shared Polytab-managed escrow on Base
const ESCROW_WALLET = "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08";
function walletFor(_id) {
  return ESCROW_WALLET;
}

// Format a discovered org into the EXACT block schema (15 fields, same order)
function formatBlock(org, id) {
  const category = VALID_CATEGORIES.includes(org.category) ? org.category : "Accessibility & Universal Design";
  return {
    id: String(id),
    title: org.title,
    category: category,
    organization: org.name,
    location: org.location,
    summary: org.summary,
    plainSummary: [
      "• Cause: " + org.whatIsBroken,
      "• Resolution: " + org.whatWillBeDone,
      "• Proof: " + org.proof
    ].join("\n"),
    votePriceUSD: org.votePriceUSD || 0.50,
    targetUSD: org.targetUSD || 500.00,
    fundedUSD: 0,                 // ALWAYS zero until real on-chain votes
    votesCount: 0,                // ALWAYS zero until real on-chain votes
    wallet: walletFor(id),
    status: "Active",
    lat: org.lat,
    lng: org.lng
  };
}

// IDs 501+ are reserved for auto-discovered orgs
function nextId(env, i) {
  return 501 + i;
}

async function discoverOrgs(env) {
  // Wire the FREE public sources (GDELT, FEMA OpenFEMA, GDACS, USGS) — the same
  // verified, no-key, public feeds the Event Radar uses — paired to verified orgs
  // supplied via env.CURATED_ORGS_JSON. Candidates are returned for human review;
  // nothing is emitted as verified without a pairing. Honest-zero throughout.
  const curated = env && env.CURATED_ORGS_JSON ? JSON.parse(env.CURATED_ORGS_JSON) : { items: [] };
  const curatedItems = Array.isArray(curated.items) ? curated.items : [];

  const events = [];
  try {
    const q = encodeURIComponent('"children with disabilities" sourcelang:eng&mode=artlist&maxrecords=10&format=json&sort=datedesc');
    const res = await fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=" + q);
    if (res.ok) {
      const data = await res.json();
      for (const a of (data.articles || [])) {
        if (a.title && a.url) events.push({ headline: a.title, sourceName: "GDELT (discovery)", url: a.url, date: null, location: a.sourcecountry || null });
      }
    }
  } catch (_) { }

  const candidates = [];
  const seen = new Set();
  const now = Date.now();
  for (const ev of events) {
    const hay = ((ev.headline || "") + " " + (ev.location || "")).toLowerCase();
    if (!FOCUS_KEYWORDS.some(k => hay.includes(k))) continue;
    const pairing = pairToCurated(hay, curatedItems);
    if (!pairing) continue;
    const key = ev.sourceName + "|" + ev.url + "|" + ev.headline;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ score: pairing.score, organization: pairing.organization, bountyId: pairing.bountyId, event: ev });
  }
  return candidates;
}

// Deterministic keyword-overlap pairing against the curated verified org list.
function pairToCurated(hay, items) {
  const words = [...new Set(String(hay).toLowerCase().split(" ").filter(w => w.length > 4))];
  let best = null, bestScore = 0;
  for (const item of items) {
    const meta = item._polytab || {};
    const orgText = [item.title, meta.organization, meta.summary, meta.plainSummary, meta.category, meta.location].join(" ").toLowerCase();
    let score = 0;
    for (const w of words) if (orgText.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = { bountyId: String(item.id), organization: meta.organization }; }
  }
  return bestScore >= 2 ? { ...best, score: bestScore } : null;
}

async function verifyOrg(name) {
  const lower = (name || "").toLowerCase();
  const focusMatch = FOCUS_KEYWORDS.some(k => lower.includes(k));
  return { name, focusMatch, verified: false, reason: "API integration pending" };
}
