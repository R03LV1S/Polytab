// Cloudflare Worker: Organization Discovery & Verification
// Focus: Disabled community, sick children, cancer, leukemia, pediatric health
// Runs on free tier (100k req/day) — zero cost
// Triggered by GitHub Action cron or manual webhook

const FOCUS_CATEGORIES = [
  "disability", "disabled", "accessibility", "assistive", "wheelchair",
  "cancer", "leukemia", "oncology", "pediatric", "children", "child",
  "hospital", "medical", "health", "rehabilitation", "therapy", "therapy",
  "blind", "deaf", "autism", "cerebral palsy", "amputee", "prosthetic",
  "orphan", "foster", "special needs", "rare disease", "chronic illness",
  "service dog", "guide dog", "mobility", "hearing loss", "vision impairment"
];

const VERIFIED_SOURCES = [
  "https://api.charitynavigator.org/v2/Organizations",
  "https://www.givewell.org/charities/top-charities"
];

const MIN_RATING = 3;
const REQUIRE_990 = true;
const REQUIRE_CRYPTO = true;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/discover") {
      const newOrgs = await discoverOrgs(env);
      return new Response(JSON.stringify({ discovered: newOrgs.length, orgs: newOrgs }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname === "/verify") {
      const name = url.searchParams.get("name");
      const result = await verifyOrg(name);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname === "/categories") {
      return new Response(JSON.stringify({ focus: FOCUS_CATEGORIES }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response("Polytab Org Discovery Worker. Focus: disabled community, sick children, cancer, leukemia. Endpoints: /discover, /verify?name=..., /categories", { status: 200 });
  }
};

async function discoverOrgs(env) {
  const orgs = [];
  // Query Charity Navigator API filtered by focus categories
  // Cross-reference with IRS 990 filings
  // Verify crypto acceptance via Giving Block directory
  // Filter by: rating >= 3, crypto accepted, overhead <= 25%
  return orgs;
}

async function verifyOrg(name) {
  const lower = (name || "").toLowerCase();
  const isFocus = FOCUS_CATEGORIES.some(cat => lower.includes(cat));
  return { name, focusMatch: isFocus, verified: false, reason: "API integration pending" };
}
