// Cloudflare Worker: Organization Discovery & Verification
// Runs on free tier (100k req/day) — zero cost
// Triggered by GitHub Action cron or manual webhook
// Discovers audited 501(c)(3) orgs from free public APIs

const VERIFIED_SOURCES = [
  "https://api.charitynavigator.org/v2/Organizations", // free tier
  "https://www.givewell.org/charities/top-charities"  // public list
];

// Minimum verification thresholds
const MIN_RATING = 3; // Charity Navigator 3+ stars
const REQUIRE_990 = true; // Must have filed IRS Form 990
const REQUIRE_CRYPTO = true; // Must accept crypto donations

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/discover") {
      // Trigger org discovery from free public sources
      const newOrgs = await discoverOrgs(env);
      return new Response(JSON.stringify({ discovered: newOrgs.length, orgs: newOrgs }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname === "/verify") {
      // Verify a single org by EIN or name
      const name = url.searchParams.get("name");
      const result = await verifyOrg(name);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response("Polytab Org Discovery Worker. Endpoints: /discover, /verify?name=...", { status: 200 });
  }
};

async function discoverOrgs(env) {
  const orgs = [];
  // In production: query Charity Navigator API, filter by rating >= 3,
  // check IRS 990 filing, verify crypto acceptance via Giving Block directory
  // For now: return empty (populated by GitHub Action with curated data)
  return orgs;
}

async function verifyOrg(name) {
  // Placeholder: check Charity Navigator API for rating
  return { name, verified: false, reason: "API integration pending" };
}
