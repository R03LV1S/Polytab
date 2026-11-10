// GitHub Action script: discover and verify new organizations
// Runs on free tier (unlimited minutes on public repos)
// Uses free public APIs: Charity Navigator, IRS 990, Giving Block directory

const fs = require("fs");

// Free public data sources
const SOURCES = {
  // GiveWell top charities (public, no API key needed)
  givewell: "https://www.givewell.org/charities/top-charities",
  // Charity Navigator search (free API, requires key in secrets)
  charityNav: "https://api.charitynavigator.org/v2/Organizations",
  // The Giving Block directory (public)
  givingBlock: "https://thegivingblock.com/donate/"
};

// Verification criteria
const CRITERIA = {
  minCharityNavRating: 3,       // 3+ stars
  require990Filing: true,        // Must have filed IRS Form 990
  requireCryptoAcceptance: true,  // Must accept crypto
  maxOverheadRatio: 0.25,        // Max 25% overhead
  minProgramRatio: 0.70          // Min 70% program spending
};

async function main() {
  console.log("Org discovery script — placeholder");
  console.log("In production, this would:");
  console.log("1. Query Charity Navigator API for orgs with rating >= 3");
  console.log("2. Cross-reference with IRS Form 990 filings");
  console.log("3. Verify crypto acceptance via Giving Block directory");
  console.log("4. Check overhead ratio <= 25%");
  console.log("5. Add verified orgs to docs/data/proposals.json and feed.json");
  console.log("6. Commit and push changes");
  console.log("");
  console.log("Criteria:", JSON.stringify(CRITERIA, null, 2));
  console.log("Free sources:", Object.keys(SOURCES));
}

main().catch(e => { console.error(e); process.exit(1); });
