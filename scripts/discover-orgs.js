// GitHub Action script: discover and verify orgs focused on
// disabled community, sick children, orphans, cancer, leukemia, pediatric health.
// Emits blocks in the EXACT same JSON format as the curated blocks,
// then merges them into docs/feed.json as JSON Feed items with _polytab.
// Runs on free tier (unlimited minutes on public repos) — zero cost.

const fs = require("fs");
const path = require("path");

const FEED_PATH = path.join(__dirname, "..", "docs", "feed.json");
const SITE_URL = "https://polytab.store";

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

const CRITERIA = {
  minCharityNavRating: 3,        // 3+ stars
  require990Filing: true,        // must have filed IRS Form 990
  requireCryptoAcceptance: true, // must accept crypto payouts
  maxOverheadRatio: 0.25,        // max 25% overhead
  minProgramRatio: 0.70          // min 70% program spending
};

// Wallet matching existing pattern: 0x71C + zero padding + ID (40 hex chars)
function walletFor(id) {
  const body = "0".repeat(40 - 3 - String(id).length) + String(id);
  return "0x71C" + body;
}

// Convert a discovered org into the EXACT block schema (15 fields, same order as curated blocks)
function toBlock(org, id) {
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
    fundedUSD: 0,   // ALWAYS zero until real on-chain votes
    votesCount: 0,  // ALWAYS zero until real on-chain votes
    wallet: walletFor(id),
    status: "Active",
    lat: org.lat,
    lng: org.lng
  };
}

// Convert a block into the exact JSON Feed item shape used by docs/feed.json
function toFeedItem(block) {
  return {
    id: block.id,
    title: block.title,
    content_html: "<p>" + block.summary + "</p>",
    url: SITE_URL + "/#" + block.id,
    date_published: new Date().toISOString(),
    _polytab: {
      category: block.category,
      organization: block.organization,
      location: block.location,
      summary: block.summary,
      plainSummary: block.plainSummary,
      votePriceUSD: block.votePriceUSD,
      targetUSD: block.targetUSD,
      fundedUSD: 0,
      votesCount: 0,
      contract: block.wallet,
      status: "Active",
      lat: block.lat,
      lng: block.lng
    }
  };
}

async function discoverOrgs() {
  // TODO (free sources only):
  // 1. Charity Navigator API (secrets.CHARITY_NAV_API_KEY) — filter rating >= 3 stars
  // 2. IRS Form 990 records (public bulk data) — require current filing
  // 3. The Giving Block directory — require crypto acceptance
  // 4. Filter by FOCUS_KEYWORDS, overhead <= 25%, program ratio >= 70%
  // Each result must provide: name, title, category, location, summary,
  // whatIsBroken, whatWillBeDone, proof, targetUSD, lat, lng.
  console.log("Discovery source integration pending — no orgs fetched this run.");
  return [];
}

async function main() {
  const feed = JSON.parse(fs.readFileSync(FEED_PATH, "utf8"));
  const existingIds = new Set(feed.items.map(i => String(i.id)));

  const discovered = await discoverOrgs();
  const focusMatches = discovered.filter(o => {
    const hay = (o.name + " " + o.title + " " + o.summary).toLowerCase();
    return FOCUS_KEYWORDS.some(k => hay.includes(k));
  });

  // Auto-discovered orgs get IDs starting at 501 (curated blocks use 1-420)
  let next = 501;
  const newBlocks = [];
  for (const org of focusMatches) {
    while (existingIds.has(String(next))) next++;
    const block = toBlock(org, next);
    existingIds.add(block.id);
    newBlocks.push(block);
    next++;
  }

  if (newBlocks.length > 0) {
    feed.items = feed.items.concat(newBlocks.map(toFeedItem));
    fs.writeFileSync(FEED_PATH, JSON.stringify(feed, null, 2));
    console.log("Added " + newBlocks.length + " blocks. Total items: " + feed.items.length);
  } else {
    console.log("No new verified focus-area orgs found.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
