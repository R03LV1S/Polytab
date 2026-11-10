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

// Wallet matching the existing pattern: 0x71C + zero padding + ID suffix
// e.g. id "501" -> 0x71C0000000000000000000000000000000000501 (40 hex chars)
function walletFor(id) {
  const body = "0".repeat(40 - 3 - String(id).length) + String(id);
  return "0x71C" + body;
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
      "• What is broken: " + org.whatIsBroken,
      "• What will be done: " + org.whatWillBeDone,
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
  // Query free public sources (Charity Navigator API with env.CHARITY_NAV_API_KEY,
  // IRS 990 records, Giving Block crypto directory), filter by FOCUS_KEYWORDS,
  // enforce rating >= 3 stars + 990 filing + crypto acceptance + <= 25% overhead.
  // Each result must provide: name, title, category, location, summary,
  // whatIsBroken, whatWillBeDone, proof, targetUSD, lat, lng.
  return [];
}

async function verifyOrg(name) {
  const lower = (name || "").toLowerCase();
  const focusMatch = FOCUS_KEYWORDS.some(k => lower.includes(k));
  return { name, focusMatch, verified: false, reason: "API integration pending" };
}
