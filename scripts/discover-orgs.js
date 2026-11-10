// GitHub Action script: discover and verify orgs focused on
// disabled community, sick children, cancer, leukemia, pediatric health
// Runs on free tier (unlimited minutes on public repos)

const fs = require("fs");

const FOCUS_CATEGORIES = [
  "disability", "disabled", "accessibility", "assistive", "wheelchair",
  "cancer", "leukemia", "oncology", "pediatric", "children", "child",
  "hospital", "medical", "health", "rehabilitation", "therapy",
  "blind", "deaf", "autism", "cerebral palsy", "amputee", "prosthetic",
  "orphan", "foster", "special needs", "rare disease", "chronic illness",
  "service dog", "guide dog", "mobility", "hearing loss", "vision impairment",
  "sick", "illness", "disease", "treatment", "care", "support"
];

const CRITERIA = {
  minCharityNavRating: 3,
  require990Filing: true,
  requireCryptoAcceptance: true,
  maxOverheadRatio: 0.25,
  minProgramRatio: 0.70,
  focusCategories: FOCUS_CATEGORIES
};

async function main() {
  console.log("Org discovery script — focus: disabled community, sick children, cancer, leukemia");
  console.log("In production, this would:");
  console.log("1. Query Charity Navigator API filtered by focus categories");
  console.log("2. Cross-reference with IRS Form 990 filings");
  console.log("3. Verify crypto acceptance via Giving Block directory");
  console.log("4. Check overhead ratio <= 25%");
  console.log("5. Add verified orgs to docs/data/proposals.json and feed.json");
  console.log("6. Commit and push changes");
  console.log("");
  console.log("Focus categories:", FOCUS_CATEGORIES.join(", "));
  console.log("Criteria:", JSON.stringify(CRITERIA, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
