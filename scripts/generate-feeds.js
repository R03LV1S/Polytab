// Polytab feed generator — builds the RSS/geoRSS feeds that docs/index.html links to.
//
// Outputs (all static, zero cost, no backend):
//   docs/feed.xml        — RSS 2.0 mirror of the Projects (docs/feed.json)
//   docs/feeds/global.xml — geoRSS mirror; coordinates rounded to ~1 km (2 dp)
//   docs/feeds/audio.xml  — plain-language text feed for screen readers
//
// HONEST-ZERO: every number in the feeds comes straight from docs/feed.json.
// Nothing is invented here. At launch fundedUSD=0 and votesCount=0, and the
// feeds say so explicitly. No audio enclosures are emitted because no real
// recordings exist yet (placeholder audio would be fabricated).
//
// Run: node scripts/generate-feeds.js   (also runs during the Pages deploy)

const fs = require("fs");
const path = require("path");

const DOCS = path.join(__dirname, "..", "docs");
const SITE = "https://polytab.store";
const SHELF_PATH = path.join(DOCS, "feed.json");
const OUT_FEED = path.join(DOCS, "feed.xml");
const OUT_DIR = path.join(DOCS, "feeds");
const OUT_GLOBAL = path.join(OUT_DIR, "global.xml");
const OUT_AUDIO = path.join(OUT_DIR, "audio.xml");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toUTCString();
}

function absoluteUrl(url, fallback) {
  const s = String(url || "").trim();
  return /^https?:\/\//i.test(s) ? s : fallback;
}

function itemLink(item) {
  return absoluteUrl(item.url, SITE + "/#" + encodeURIComponent(String(item.id)));
}

function money(n) {
  return "$" + (Number(n) || 0).toFixed(2);
}

function metaOf(item) {
  return item._polytab || {};
}

// Human-readable, honest description shared by all three feeds.
function itemDescription(item) {
  const m = metaOf(item);
  const plain = String(m.plainSummary || item.content_text || m.summary || "").trim();
  const lines = [];
  if (plain) lines.push(plain);
  lines.push("");
  lines.push("Category: " + (m.category || "Uncategorized"));
  lines.push("Organization: " + (m.organization || "Verification pending"));
  lines.push("Location: " + (m.location || "Community"));
  lines.push("Vote price: " + money(m.votePriceUSD) + " · Target: " + money(m.targetUSD));
  lines.push(
    "Funded: " + money(m.fundedUSD) +
    " · Votes: " + (Number(m.votesCount) || 0) +
    " · Status: " + (m.status || "Active")
  );
  if (!Number(m.fundedUSD) && !Number(m.votesCount)) {
    lines.push("Honest-zero: no on-chain votes have been recorded for this action yet.");
  }
  const w = m.contract || m.wallet;
  if (w) {
    if (String(w).toLowerCase() === "0x1e89ff2c2922528c8ace8db07f73ef979ea76c08") {
      lines.push("Contributions: locked — org must verify (registry + DNS TXT) to unlock its page");
    } else {
      lines.push("Payout: " + w);
    }
  }
  if (m.website) lines.push("Website: " + m.website);
  return lines.join("\n");
}

function channelHeader({ title, link, description, self, extraNs, ttl }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"' + (extraNs ? " " + extraNs : "") + ">",
    "  <channel>",
    "    <title>" + esc(title) + "</title>",
    "    <link>" + esc(link) + "</link>",
    "    <description>" + esc(description) + "</description>",
    "    <language>en-us</language>",
    "    <lastBuildDate>" + new Date().toUTCString() + "</lastBuildDate>",
    "    <ttl>" + (ttl || 60) + "</ttl>",
    '    <atom:link href="' + esc(self) + '" rel="self" type="application/rss+xml" />'
  ];
}

function itemBlock(item, opts) {
  const m = metaOf(item);
  const link = itemLink(item);
  const pub = rfc822(item.date_published);
  const lines = ["  <item>"];
  lines.push("    <title>" + esc(item.title || "Untitled civic action") + "</title>");
  lines.push("    <link>" + esc(link) + "</link>");
  lines.push('    <guid isPermaLink="false">polytab:shelf:' + esc(String(item.id)) + "</guid>");
  lines.push("    <description>" + esc(itemDescription(item)) + "</description>");
  if (m.category) lines.push("    <category>" + esc(m.category) + "</category>");
  if (pub) lines.push("    <pubDate>" + pub + "</pubDate>");
  if (opts && opts.geo && Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng))) {
    // Round to 2 decimals (~1 km) — never publish precise home-level coordinates.
    lines.push("    <georss:point>" + Number(m.lat).toFixed(2) + " " + Number(m.lng).toFixed(2) + "</georss:point>");
  }
  lines.push("  </item>");
  return lines.join("\n");
}

function main() {
  const shelf = JSON.parse(fs.readFileSync(SHELF_PATH, "utf8"));
  const items = Array.isArray(shelf.items) ? shelf.items : [];
  if (items.length === 0) throw new Error("feed.json has no items — refusing to publish an empty shelf feed");

  // Sanity: every item needs an id + title, and metrics must be real numbers.
  for (const item of items) {
    if (!item.id || !item.title) throw new Error("feed.json item missing id/title: " + JSON.stringify(item).slice(0, 120));
    const m = metaOf(item);
    for (const key of ["fundedUSD", "votesCount", "targetUSD", "votePriceUSD"]) {
      if (m[key] !== undefined && (typeof m[key] !== "number" || Number.isNaN(m[key]) || m[key] < 0)) {
        throw new Error("feed.json item " + item.id + " has invalid " + key);
      }
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) Main RSS feed (Projects)
  const feed = channelHeader({
    title: "Polytab — Projects",
    link: SITE,
    description:
      "The store where you buy civic outcomes, not junk. Every verified civic action, mirrored from feed.json. " +
      "Funding and vote counts are honest-zero until real on-chain votes are recorded — no fabricated metrics.",
    self: SITE + "/feed.xml"
  });
  items.forEach((item) => feed.push(itemBlock(item, { geo: false })));
  feed.push("  </channel>", "</rss>", "");
  fs.writeFileSync(OUT_FEED, feed.join("\n"), "utf8");

  // 2) geoRSS mirror — only items with coordinates, rounded to ~1 km
  const geoItems = items.filter((item) => {
    const m = metaOf(item);
    return Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng));
  });
  const geo = channelHeader({
    title: "Polytab — Global Civic Action Map (geoRSS)",
    link: SITE + "/#map",
    description:
      "geoRSS mirror of the Polytab Projects. " + geoItems.length + " of " + items.length +
      " actions publish organization coordinates, rounded to two decimal places (~1 km, neighborhood-level) " +
      "to prevent PII/doxing. Organizations without a public location are listed in feed.xml only.",
    self: SITE + "/feeds/global.xml",
    extraNs: 'xmlns:georss="http://www.georss.org/georss"'
  });
  geoItems.forEach((item) => geo.push(itemBlock(item, { geo: true })));
  geo.push("  </channel>", "</rss>", "");
  fs.writeFileSync(OUT_GLOBAL, geo.join("\n"), "utf8");

  // 3) Plain-language text feed for screen readers (no placeholder audio)
  const audio = channelHeader({
    title: "Polytab — Plain-Language Action Feed",
    link: SITE + "/#shelf",
    description:
      "Plain-language descriptions of every civic action, written for screen readers and low-bandwidth readers. " +
      "No audio enclosures are attached: recordings are published only when a real recording exists. " +
      "Funding and vote counts are honest-zero until real on-chain votes are recorded.",
    self: SITE + "/feeds/audio.xml"
  });
  items.forEach((item) => audio.push(itemBlock(item, { geo: false })));
  audio.push("  </channel>", "</rss>", "");
  fs.writeFileSync(OUT_AUDIO, audio.join("\n"), "utf8");

  console.log("feeds: " + items.length + " shelf items, " + geoItems.length + " geotagged");
  console.log("wrote docs/feed.xml, docs/feeds/global.xml, docs/feeds/audio.xml");
  console.log("metrics mirrored from feed.json as-is (honest-zero at launch).");
}

if (require.main === module) {
  main();
}

module.exports = { esc, rfc822, absoluteUrl, itemDescription, itemBlock, main };
