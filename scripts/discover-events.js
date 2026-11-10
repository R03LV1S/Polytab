// GitHub Action script: Polytab Event Radar — "voting potentials" discovery
//
// Scans FREE public feeds for current events that could become fundable civic
// actions (disabled community, sick children, orphans, cancer, leukemia,
// pediatric health), then writes candidate blocks in the EXACT Polytab block
// format (15 fields, bullet plainSummary, 0x71E wallet series) to
// docs/data/event-queue.json.
//
// VERIFIED FREE SOURCES (no API keys, no accounts, no cost):
//   1. GDELT DOC 2.0 API   — global news, programmatic use allowed
//   2. CDC Newsroom RSS    — US public-health announcements (public domain)
//   3. GDACS RSS           — global disaster alerts (EU JRC, public domain)
//   4. USGS GeoJSON        — significant earthquakes (public domain)
//   (WHO RSS feed moved 404; ReliefWeb v1 API retired 410 — both dropped)
//
// CURRENT-EVENTS ONLY: items older than MAX_EVENT_AGE_DAYS are discarded, so
// archival feeds (CDC keeps years of releases) cannot flood the queue.
//
// HONEST-ZERO RULES (never fabricated, ever):
//   fundedUSD: 0, votesCount: 0, status: "Proposed", lat/lng: null.
//   "Proposed" (not "Active") because a radar-surfaced event has NOT yet passed
//   organization pairing + governance verification. Promoting a queue item into
//   feed.json (Action Shelf) is NEVER automatic.
//
// No coordinates are ever written (lat/lng stay null): event locations are
// kept as public place-name strings only (anti-doxing).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const QUEUE_PATH = path.join(__dirname, "..", "docs", "data", "event-queue.json");
const FEED_PATH = path.join(__dirname, "..", "docs", "feed.json");

const ID_START = 601;              // event-radar blocks use 601+ (501+ = org-discovery, 1-420 curated)
const MAX_QUEUE_ITEMS = 60;
const MAX_NEW_PER_RUN = 25;        // keep each run reviewable by a human
const MAX_EVENT_AGE_DAYS = 21;     // "current events" means current — not a news archive
const MAX_PROCESSED_HASHES = 2000;
const FETCH_TIMEOUT_MS = 15000;
const GDELT_PAUSE_MS = 4000;       // be a polite API citizen (shared CI IPs get 429s)
const GDELT_ATTEMPTS = 2;          // one retry; long retry loops only stall the run
const GDELT_QUERIES_PER_RUN = 2;   // rotate so each run hits few queries per IP budget
const UA = "PolytabEventRadar/1.0 (+https://polytab.store)";

// Mission-specific focus: disabled community, sick children, orphans, cancer,
// leukemia, pediatric health, rare disease, hospice care.
// NOTE: broad words like "care"/"support" are deliberately excluded — they
// match almost any article and flood the queue with irrelevant noise.
const MISSION_FOCUS = [
  "disability", "disabled", "accessibility", "assistive", "wheelchair",
  "cancer", "leukemia", "oncology", "pediatric", "children", "child",
  "hospital", "rehabilitation", "therapy",
  "blind", "deaf", "autism", "autistic", "cerebral palsy", "amputee", "prosthetic",
  "orphan", "orphanage", "foster", "special needs", "rare disease", "chronic illness",
  "service dog", "guide dog", "mobility", "hearing loss", "vision impairment",
  "sick", "illness", "hospice", "palliative", "neonatal", "infant"
];

// Disaster / public-health emergencies that can become civic actions
const HAZARD_FOCUS = [
  "earthquake", "flood", "flooding", "hurricane", "wildfire", "typhoon", "cyclone",
  "drought", "landslide", "volcano", "tsunami", "storm", "famine", "disaster",
  "outbreak", "epidemic", "pandemic", "measles", "polio", "malaria", "cholera",
  "ebola", "dengue", "vaccination", "clinic", "fire", "tornado", "chemical", "biological",
  "emergency", "aid", "relief"
];

// Union kept for the offline tests / downstream consumers
const FOCUS_KEYWORDS = MISSION_FOCUS.concat(HAZARD_FOCUS);

const CATEGORY_RULES = [
  {
    category: "Accessibility & Universal Design",
    keywords: ["disability", "disabled", "wheelchair", "blind", "deaf", "autism", "autistic",
      "cerebral palsy", "prosthetic", "amputee", "accessible", "accessibility", "special needs",
      "cancer", "leukemia", "chemotherapy", "surgery", "illness", "disease", "medical",
      "hospital", "sick", "therapy", "rehabilitation", "pediatric", "infant"]
  },
  {
    category: "Environmental",
    keywords: ["earthquake", "flood", "hurricane", "wildfire", "typhoon", "drought",
      "landslide", "volcano", "cyclone", "storm", "tsunami", "famine", "disaster"]
  },
  {
    category: "Classrooms",
    keywords: ["school", "student", "teacher", "classroom", "orphan", "orphanage"]
  },
  {
    category: "Civic Tech",
    keywords: ["outbreak", "epidemic", "vaccination", "measles", "polio", "malaria",
      "cholera", "ebola", "clinic", "screening"]
  }
];

// GDELT queries — quoted phrases + OR groups, English sources
const GDELT_QUERIES = [
  '"children with disabilities"',
  '"disabled children"',
  '(pediatric OR childhood) (cancer OR leukemia)',
  '"children\'s hospital"',
  '(orphan OR orphanage) children',
  '"rare disease" children'
];

const CDC_RSS = "https://tools.cdc.gov/api/v2/resources/media/132608.rss";
const GDACS_RSS = "https://www.gdacs.org/xml/rss.xml";
const USGS_GEOJSON = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson";

// ---------- helpers ----------

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function stripTags(s) {
  // Decode entities FIRST (so &lt;em&gt; becomes a real tag), then strip tags.
  return decodeEntities(String(s || "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Word-boundary keyword match ("sick" must NOT match "sickens")
function keywordMatch(hay, kw) {
  const escaped = String(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "\\b", "i").test(String(hay || ""));
}

function parseRssItems(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = stripTags((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = decodeEntities((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "").trim();
    const pubRaw = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]
      || (b.match(/<published>([\s\S]*?)<\/published>/i) || [])[1]
      || (b.match(/<updated>([\s\S]*?)<\/updated>/i) || [])[1];
    const d = pubRaw ? new Date(decodeEntities(pubRaw)) : null;
    // GDACS carries an explicit alert level (Green/Orange/Red)
    const alertLevel = stripTags((b.match(/<gdacs:alertlevel>([\s\S]*?)<\/gdacs:alertlevel>/i) || [])[1]);
    if (title && link) {
      items.push({
        title,
        link,
        date: d && !isNaN(d.getTime()) ? d.toISOString() : null,
        alertLevel: alertLevel || null
      });
    }
  }
  return items;
}

// GDELT seendate format: "20260908T184500Z"
function parseGdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithTimeout(url, accept, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": UA, "Accept": accept || "*/*" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

// GDELT throttles shared CI egress IPs with 429s; retry with backoff.
async function fetchJsonWithRetry(url, accept, attempts) {
  const max = attempts || GDELT_ATTEMPTS;
  let lastError = null;
  for (let i = 0; i < max; i++) {
    try {
      const txt = await fetchWithTimeout(url, accept);
      return JSON.parse(txt);
    } catch (e) {
      lastError = e;
      if (i < max - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastError;
}

function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

function normalizeTitle(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryFor(text) {
  const hay = String(text || "");
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(k => keywordMatch(hay, k))) return rule.category;
  }
  return "Accessibility & Universal Design"; // mission default
}

// Mission or hazard relevance, using whole-word matching.
function isFocus(text) {
  return FOCUS_KEYWORDS.some(k => keywordMatch(text, k));
}

// "Current events" guard: strict feeds keep years of archives (CDC), so an
// item with no date, or a date older than MAX_EVENT_AGE_DAYS, is not news.
function isRecent(dateIso, nowMs, maxAgeDays) {
  if (!dateIso) return false;
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return false;
  const days = maxAgeDays === undefined ? MAX_EVENT_AGE_DAYS : maxAgeDays;
  const ageMs = (nowMs === undefined ? Date.now() : nowMs) - t;
  return ageMs >= -86400000 && ageMs <= days * 86400000; // allow 1 day clock skew
}

// Wallet series for event-radar blocks: 0x71E + zero padding + ID (40 hex chars)
function walletFor(id) {
  const body = "0".repeat(40 - 3 - String(id).length) + String(id);
  return "0x71E" + body;
}

// Propose (never assert) a pairing with one of the 100 VERIFIED orgs already
// in feed.json, by deterministic keyword overlap. Marked "proposed" so a human
// verifies before promotion — we never claim an org is responding to an event.
function proposePairing(eventText, feed) {
  if (!feed) return null;
  const words = [...new Set(normalizeTitle(eventText).split(" ").filter(w => w.length > 4))];
  let best = null, bestScore = 0;
  for (const item of feed.items) {
    const meta = item._polytab || {};
    const orgText = normalizeTitle(
      [item.title, meta.organization, meta.summary, meta.plainSummary, meta.category, meta.location].join(" ")
    );
    let score = 0;
    for (const w of words) if (orgText.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = { bountyId: String(item.id), organization: meta.organization }; }
  }
  return bestScore >= 2 ? { ...best, score: bestScore } : null;
}

function truncate(s, n) {
  const str = String(s || "").replace(/\s+/g, " ").trim();
  return str.length <= n ? str : str.slice(0, n - 1).trimEnd() + "…";
}

// Build a queue block in the EXACT Polytab block format (plus radar provenance)
function toQueueBlock(ev, id) {
  const pairing = ev.pairing;
  return {
    id: String(id),
    title: truncate(ev.headline, 120),
    category: ev.category || categoryFor(ev.headline + " " + (ev.location || "")),
    organization: pairing ? pairing.organization : "Verification Pending",
    location: ev.location || "Global",
    summary: truncate(
      "Community Radar current event: \"" + ev.headline + "\" (" + ev.sourceName + (ev.date ? ", " + ev.date.slice(0, 10) : "") + "). " +
      (pairing
        ? "Proposed pairing with verified organization " + pairing.organization + " (Action Shelf bounty #" + pairing.bountyId + ") — pending governance verification."
        : "Awaiting a verified 501(c)(3) partner pairing before Action Shelf listing."),
      600
    ),
    plainSummary: [
      "• What is broken: " + ev.headline,
      "• What will be done: A verified organization pairing converts this event into a fundable, escrowed civic outcome.",
      "• Proof: " + ev.url + " (public reporting; verification trail in docs/data/event-queue.json)"
    ].join("\n"),
    votePriceUSD: 0.50,
    targetUSD: 500.00,
    fundedUSD: 0,      // ALWAYS zero until real on-chain votes
    votesCount: 0,     // ALWAYS zero until real on-chain votes
    wallet: walletFor(id),
    status: "Proposed",
    lat: null,
    lng: null,
    radar: {
      sourceFeed: ev.sourceName,
      sourceUrl: ev.url,
      publishedAt: ev.date || null,
      discoveredAt: new Date().toISOString(),
      proposedPairing: pairing ? { bountyId: pairing.bountyId, organization: pairing.organization, keywordMatches: pairing.score } : null,
      dedupeHash: ev.hash
    }
  };
}

// ---------- source adapters ----------

// GDELT throttles shared CI egress IPs hard with 429s, so each run only samples
// a rotating subset of queries; over three runs (18h window) every query gets
// its own budget without tripping the shared-IP throttle.
function gdeltQueriesForRun(nowMs, perRun) {
  const per = perRun === undefined ? GDELT_QUERIES_PER_RUN : perRun;
  const n = GDELT_QUERIES.length;
  const count = Math.min(Math.max(1, per), n);
  const t = nowMs === undefined ? Date.now() : nowMs;
  const startIdx = Math.floor(t / (6 * 3600 * 1000)) * count;
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(GDELT_QUERIES[(startIdx + i) % n]);
  return picked;
}

async function collectGdelt() {
  const events = [];
  for (const q of gdeltQueriesForRun(Date.now())) {
    const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(q + " sourcelang:eng")
      + "&mode=artlist&maxrecords=15&format=json&sort=datedesc";
    try {
      const data = await fetchJsonWithRetry(url);
      for (const a of (data.articles || [])) {
        if (!a.title || !a.url) continue;
        events.push({
          headline: stripTags(a.title),
          sourceName: "GDELT (" + (a.domain || "news") + ")",
          url: a.url,
          date: parseGdeltDate(a.seendate),
          location: a.sourcecountry || null
        });
      }
    } catch (e) { console.log("  gdelt query failed [" + q + "]: " + e.message); }
    await sleep(GDELT_PAUSE_MS);
  }
  return events;
}

async function collectCdc() {
  const xml = await fetchWithTimeout(CDC_RSS);
  return parseRssItems(xml).map(it => ({
    headline: it.title,
    sourceName: "CDC Online Newsroom",
    url: it.link,
    date: it.date,
    location: "United States"
  }));
}

// GDACS titles embed the place: "… in Japan 09/11/2026 …" or "… in South Sudan".
function gdacsLocation(title) {
  const s = String(title || "");
  const withDate = /\bin\s+([A-Z][^,]{2,60}?)\s+\d{1,2}\/\d{1,2}\/\d{4}/.exec(s);
  if (withDate) return withDate[1].trim();
  const atEnd = /\bin\s+([A-Z][A-Za-z .'()\-]{2,60})\s*$/.exec(s);
  return atEnd ? atEnd[1].trim() : null;
}

async function collectGdacs() {
  const xml = await fetchWithTimeout(GDACS_RSS);
  return parseRssItems(xml)
    // Green = minor; Orange/Red carry real humanitarian potential
    .filter(it => !it.alertLevel || /orange|red/i.test(it.alertLevel))
    .map(it => ({
      headline: it.title,
      sourceName: "GDACS (EU JRC)",
      url: it.link,
      date: it.date,
      location: gdacsLocation(it.title)
    }));
}

async function collectUsgs() {
  const txt = await fetchWithTimeout(USGS_GEOJSON, "application/geo+json");
  const data = JSON.parse(txt);
  const events = [];
  for (const f of (data.features || [])) {
    const p = f.properties || {};
    if (Number(p.mag) < 5.5) continue;
    events.push({
      headline: "Magnitude " + p.mag + " earthquake — " + (p.place || "unspecified region"),
      sourceName: "USGS Significant Earthquakes",
      url: p.url || USGS_GEOJSON,
      date: p.time ? new Date(p.time).toISOString() : null,
      location: p.place || null
    });
  }
  return events;
}

// FEMA OpenFEMA (public domain, US gov, no key) — current federal disaster
// declarations. Rows repeat per designated county, so dedupe by disasterNumber.
const FEMA_API = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=100&$orderby=declarationDate%20desc&$select=disasterNumber,declarationType,declarationDate,state,incidentType,declarationTitle,designatedArea";

function femaRowsToEvents(rows) {
  const events = [];
  const seen = new Set();
  for (const r of rows || []) {
    const key = String(r.disasterNumber || r.femaDeclarationString || r.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const headline = [String(r.incidentType || "").replace(/\s+/g, " ").trim(), String(r.declarationTitle || "").trim(), "(" + String(r.femaDeclarationString || "DR") + ")"]
      .filter(Boolean).join(" — ");
    events.push({
      headline: truncate(headline, 140),
      sourceName: "FEMA OpenFEMA (public domain)",
      url: "https://www.fema.gov/disaster/" + String(r.disasterNumber || ""),
      date: r.declarationDate || null,
      location: (r.state || "") + (r.designatedArea ? " — " + r.designatedArea : "") || null,
      hazardType: String(r.incidentType || "")
    });
  }
  return events;
}

async function collectFema() {
  const since = new Date(Date.now() - MAX_EVENT_AGE_DAYS * 86400000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const url = FEMA_API + "&$filter=" + encodeURIComponent("declarationDate ge '" + since + "'");
  const data = await fetchJsonWithRetry(url, "application/json", 2);
  return femaRowsToEvents(data.DisasterDeclarationsSummaries);
}

// ---------- main ----------

async function main() {
  // Load or seed the queue
  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  } catch (_) {
    queue = { version: 1, description: "", items: [], processedHashes: [], nextId: ID_START };
  }
  if (!Array.isArray(queue.items)) queue.items = [];
  if (!Array.isArray(queue.processedHashes)) queue.processedHashes = [];

  // Load verified feed for org pairing proposals
  let feed = null;
  try { feed = JSON.parse(fs.readFileSync(FEED_PATH, "utf8")); } catch (_) { console.log("feed.json unavailable — pairing skipped"); }

  const processed = new Set(queue.processedHashes);
  const queuedHashes = new Set(queue.items.map(i => i.radar && i.radar.dedupeHash).filter(Boolean));
  const feedIds = feed ? new Set(feed.items.map(i => String(i.id))) : new Set();

  console.log("Scanning free public feeds (GDELT, CDC Newsroom, GDACS, USGS, FEMA OpenFEMA)…");
  const collectors = [
    ["GDELT", collectGdelt],
    ["CDC Newsroom", () => collectCdc()],
    ["GDACS", () => collectGdacs()],
    ["USGS", () => collectUsgs()],
    ["FEMA OpenFEMA", collectFema]
  ];
  const allEvents = [];
  for (const [name, fn] of collectors) {
    try {
      const evs = await fn();
      console.log("  " + name + ": " + evs.length + " items");
      allEvents.push(...evs);
    } catch (e) { console.log("  " + name + " failed: " + e.message); }
  }

  // Filter: focus keywords, current-events recency, real headlines, dedupe
  const candidates = [];
  const seenNow = new Set();
  const now = Date.now();
  for (const ev of allEvents) {
    const headline = String(ev.headline || "").trim();
    if (headline.length < 25) continue;
    const focusText = headline + " " + (ev.location || "");
    if (!isFocus(focusText)) continue;
    if (!isRecent(ev.date, now)) continue; // drop undated + archival items
    const hash = sha256(normalizeTitle(headline) + "|" + normalizeTitle(ev.location || ""));
    if (processed.has(hash) || queuedHashes.has(hash) || seenNow.has(hash)) continue;
    seenNow.add(hash);
    candidates.push({ ...ev, headline, category: categoryFor(focusText), hash });
  }
  // Newest first, then cap so each run stays human-reviewable.
  candidates.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const accepted = candidates.slice(0, MAX_NEW_PER_RUN);
  console.log("Focus-matched new current events: " + candidates.length + " (queueing " + accepted.length + ")");

  // Next ID from the 601+ series (never collides with curated 1-420 / org-discovery 501+).
  // queue.nextId is monotonic so a trimmed-off ID is never reused by a different event
  // (escrow wallet addresses must not be recycled).
  let nextId = Math.max(
    ID_START,
    Number(queue.nextId) || 0,
    ...queue.items.map(i => (parseInt(i.id) || 0) + 1)
  );
  const newBlocks = accepted.map(ev => {
    const pairing = feed ? proposePairing(ev.headline + " " + (ev.location || ""), feed) : null;
    if (pairing && !feedIds.has(pairing.bountyId)) return null; // only pair with orgs actually in the feed
    return toQueueBlock({ ...ev, pairing }, nextId++);
  }).filter(Boolean);

  // Prepend newest first, cap the queue
  queue.items = newBlocks.concat(queue.items).slice(0, MAX_QUEUE_ITEMS);
  queue.nextId = nextId; // monotonic; survives trimming

  // Persist dedupe hashes (rotating cap)
  for (const b of newBlocks) processed.add(b.radar.dedupeHash);
  queue.processedHashes = [...processed].slice(-MAX_PROCESSED_HASHES);

  queue.version = 1;
  queue.description = "Polytab Event Radar queue. Current events (last 21 days) surfaced from free public feeds (GDELT, CDC Newsroom, GDACS, USGS) as candidate civic-action blocks in the exact Polytab block format. All metrics are honest-zero (fundedUSD=0, votesCount=0). Items are PROPOSED — promotion to the Action Shelf (feed.json) requires a verified organization pairing and governance sign-off, never automatic. Wallet series: 0x71E + ID (601+). No coordinates are stored (lat/lng null); locations are public place-name strings only.";

  // HONEST-ZERO GUARD: hard fail if any fabricated metric sneaks in
  const validCategories = CATEGORY_RULES.map(r => r.category);
  for (const b of queue.items) {
    if (b.fundedUSD !== 0 || b.votesCount !== 0 || b.status !== "Proposed" || b.lat !== null || b.lng !== null) {
      throw new Error("Honest-zero violation in " + b.id + " (metrics/coords/status must be zero/null/Proposed)");
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(b.wallet)) throw new Error("Invalid wallet in " + b.id);
    if (!validCategories.includes(b.category)) throw new Error("Invalid category in " + b.id);
  }

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
  console.log("Queue updated: " + queue.items.length + " items (" + newBlocks.length + " new). Processed hashes: " + queue.processedHashes.length);
  console.log("All metrics honest-zero. Promotion to feed.json remains manual + verified.");
  process.exit(0); // aborted sockets can keep the event loop alive on some platforms
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

// Exported for offline fixture tests (tests/event-radar.test.js)
module.exports = {
  decodeEntities, stripTags, parseRssItems, parseGdeltDate, normalizeTitle,
  keywordMatch, categoryFor, isFocus, isRecent, gdacsLocation, walletFor,
  proposePairing, truncate, toQueueBlock, sha256,
  FOCUS_KEYWORDS, MISSION_FOCUS, HAZARD_FOCUS, CATEGORY_RULES, GDELT_QUERIES,
  MAX_EVENT_AGE_DAYS, MAX_NEW_PER_RUN, GDELT_QUERIES_PER_RUN, gdeltQueriesForRun,
  femaRowsToEvents, collectFema,
};
