// Offline fixture tests for the Event Radar scanner (no network needed).
// Fixtures below are real structures captured from the live feeds:
// CDC Newsroom RSS, GDELT DOC API JSON, USGS GeoJSON.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  stripTags, parseRssItems, parseGdeltDate, categoryFor, walletFor,
  proposePairing, toQueueBlock, normalizeTitle,
  isFocus, isRecent, gdacsLocation, MAX_EVENT_AGE_DAYS
} = require(path.join(__dirname, "..", "scripts", "discover-events.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n      " + e.message); }
}

// --- Fixture 1: CDC Newsroom RSS item (real structure, entities + <em> tags) ---
const CDC_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"><channel><title>CDC Online Newsroom</title>
<item>
<title>UPDATE - Ongoing &lt;em&gt;Salmonella &lt;/em&gt;outbreaks linked to backyard poultry sickens 150 more people with over a quarter of cases in children under 5 years old</title>
<link>https://tools.cdc.gov/api/embed/downloader/download.asp?m=132608&amp;c=765550</link>
<pubDate>Thu, 14 May 2026 19:59:00 GMT</pubDate>
<description>Investigation notice</description>
</item>
<item>
<title>CDC Statement on Ebola Outbreak in the Democratic Republic of Congo and Uganda: 7/10/26</title>
<link>https://tools.cdc.gov/api/embed/downloader/download.asp?m=132608&amp;c=765993</link>
<pubDate>Fri, 10 Jul 2026 08:00:00 GMT</pubDate>
</item>
</channel></rss>`;

test("CDC RSS: parses items, strips tags/entities, decodes dates", () => {
  const items = parseRssItems(CDC_XML);
  assert.strictEqual(items.length, 2);
  assert.ok(items[0].title.startsWith("UPDATE - Ongoing Salmonella outbreaks"));
  assert.ok(!items[0].title.includes("<em>"), "em tag must be stripped");
  assert.ok(items[0].title.includes("children under 5"));
  assert.ok(items[0].link.startsWith("https://tools.cdc.gov/"));
  assert.strictEqual(items[0].date, "2026-05-14T19:59:00.000Z");
});

// --- Fixture 2: GDELT article JSON (real structure) ---
test("GDELT date: parses 20260908T184500Z", () => {
  assert.strictEqual(parseGdeltDate("20260908T184500Z"), "2026-09-08T18:45:00.000Z");
});
test("GDELT date: returns null on garbage", () => {
  assert.strictEqual(parseGdeltDate("not-a-date"), null);
  assert.strictEqual(parseGdeltDate(""), null);
});

// --- Fixture 3: USGS GeoJSON (real structure from live feed) ---
const USGS_JSON = JSON.stringify({
  type: "FeatureCollection",
  features: [{
    properties: { mag: 6.4, place: "30 km WSW of Lata, Solomon Islands", time: 1794195299466, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tx16" }
  }, {
    properties: { mag: 4.2, place: "Small quake should be filtered", time: 1794195299466, url: "https://example.com" }
  }]
});
test("USGS: mag filter + headline + ISO date", () => {
  const data = JSON.parse(USGS_JSON);
  const events = data.features.filter(f => Number(f.properties.mag) >= 5.5).map(f => {
    const p = f.properties;
    return {
      headline: "Magnitude " + p.mag + " earthquake — " + p.place,
      date: new Date(p.time).toISOString(),
      location: p.place, url: p.url
    };
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].headline, "Magnitude 6.4 earthquake — 30 km WSW of Lata, Solomon Islands");
  assert.strictEqual(events[0].date, "2026-11-09T03:34:59.466Z");
  assert.strictEqual(events[0].location, "30 km WSW of Lata, Solomon Islands");
});

// --- Categories ---
test("categoryFor: earthquake -> Environmental", () => {
  assert.strictEqual(categoryFor("Magnitude 6.4 earthquake — Solomon Islands"), "Environmental");
});
test("categoryFor: salmonella outbreak -> Civic Tech", () => {
  assert.strictEqual(categoryFor("Salmonella outbreak sickens children under 5 in 13 states"), "Civic Tech");
});
test("categoryFor: children's hospital -> Accessibility & Universal Design", () => {
  assert.strictEqual(categoryFor("Johns Hopkins All Children's Hospital reopens after bomb threat"), "Accessibility & Universal Design");
});
test("categoryFor: school/orphan -> Classrooms", () => {
  assert.strictEqual(categoryFor("Rural orphanage school repaired for foster children"), "Classrooms");
});
test("keywordMatch: 'sick' must not match 'sickens'", () => {
  const { keywordMatch } = require(path.join(__dirname, "..", "scripts", "discover-events.js"));
  assert.strictEqual(keywordMatch("Salmonella sickens children", "sick"), false);
  assert.strictEqual(keywordMatch("Sick children need care", "sick"), true);
});

// --- Wallet series ---
test("walletFor(601) -> 0x71E + zeros + 601, 40 hex chars", () => {
  const w = walletFor(601);
  assert.strictEqual(w, "0x71E" + "0".repeat(34) + "601");
  assert.strictEqual(w.length, 42);
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(w));
});
test("walletFor(999) stays 42 chars", () => {
  const w = walletFor(999);
  assert.strictEqual(w.length, 42);
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(w));
});

// --- Pairing against the REAL feed.json (100 verified orgs) ---
const feed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "feed.json"), "utf8"));
test("proposePairing: leukemia/cancer event pairs with a real cancer org", () => {
  const p = proposePairing("childhood leukemia cancer treatment hospital patients", feed);
  assert.ok(p, "expected a pairing");
  assert.ok(p.score >= 2);
  assert.ok(feed.items.some(i => String(i.id) === p.bountyId));
});
test("proposePairing: irrelevant text returns null", () => {
  assert.strictEqual(proposePairing("quarterly earnings report semiconductor", feed), null);
});

// --- Full block construction: exact format + honest-zero ---
test("toQueueBlock: exact 15-field block, bullets, honest-zero, radar provenance", () => {
  const b = toQueueBlock({
    headline: "Salmonella outbreak sickens children under 5 across 13 states",
    sourceName: "CDC Online Newsroom",
    url: "https://tools.cdc.gov/api/embed/downloader/download.asp?m=132608&c=765550",
    date: "2026-05-14T19:59:00.000Z",
    location: "United States",
    category: categoryFor("Salmonella outbreak sickens children under 5"),
    pairing: { bountyId: "215", organization: "St. Jude Children's Research Hospital", score: 3 },
    hash: "abc123"
  }, 601);
  // Exact block field set and order
  assert.deepStrictEqual(Object.keys(b).slice(0, 15),
    ["id","title","category","organization","location","summary","plainSummary","votePriceUSD","targetUSD","fundedUSD","votesCount","wallet","status","lat","lng"]);
  // Honest-zero
  assert.strictEqual(b.fundedUSD, 0);
  assert.strictEqual(b.votesCount, 0);
  assert.strictEqual(b.status, "Proposed");
  assert.strictEqual(b.lat, null);
  assert.strictEqual(b.lng, null);
  // Bullets format
  assert.ok(b.plainSummary.startsWith("• What is broken: "));
  assert.ok(b.plainSummary.includes("\n• What will be done: "));
  assert.ok(b.plainSummary.includes("\n• Proof: "));
  // Wallet + provenance
  assert.ok(/^0x71E[0]{34}601$/.test(b.wallet));
  assert.strictEqual(b.radar.sourceFeed, "CDC Online Newsroom");
  assert.strictEqual(b.radar.proposedPairing.bountyId, "215");
  assert.strictEqual(b.radar.dedupeHash, "abc123");
});

// --- Dedupe stability ---
test("normalizeTitle: stable hash input", () => {
  assert.strictEqual(normalizeTitle("Salmonella  Outbreak!! sickens children"), normalizeTitle("salmonella outbreak sickens children"));
});

// --- Focus keyword coverage of real headlines ---
test("focus keywords catch the real CDC headline", () => {
  const FOCUS = ["disability","disabled","children","child","hospital","cancer","leukemia","outbreak","infant","toddler","sick","disease"];
  const headline = "Ongoing Salmonella outbreaks linked to backyard poultry sickens 150 more people with over a quarter of cases in children under 5 years old";
  assert.ok(FOCUS.some(k => headline.toLowerCase().includes(k)));
});

// --- Focus relevance: broad filler words must not qualify ---
test("isFocus: mission and hazard headlines qualify", () => {
  assert.strictEqual(isFocus("Childhood leukemia trial expands to three hospitals"), true);
  assert.strictEqual(isFocus("Magnitude 6.4 earthquake strikes Solomon Islands"), true);
  assert.strictEqual(isFocus("Wheelchair ramp funding approved for rural school"), true);
});
test("isFocus: generic news does not qualify", () => {
  assert.strictEqual(isFocus("Quarterly earnings beat analyst expectations"), false);
  assert.strictEqual(isFocus("We support and care about local business"), false);
});

// --- Recency guard: archives must not flood the queue ---
test("isRecent: keeps current events, drops archives and undated items", () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  assert.strictEqual(isRecent("2026-11-05T00:00:00Z", now), true);
  assert.strictEqual(isRecent("2026-08-01T00:00:00Z", now), false);
  assert.strictEqual(isRecent(null, now), false);
  assert.strictEqual(isRecent("not-a-date", now), false);
  assert.strictEqual(isRecent("2026-11-11T00:00:00Z", now), true); // small clock skew allowed
  assert.strictEqual(isRecent("2026-12-01T00:00:00Z", now), false);
  assert.strictEqual(MAX_EVENT_AGE_DAYS, 21);
});

// --- GDACS fixture (real structure: alert level + place-name extraction) ---
const GDACS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:gdacs="http://www.gdacs.org"><channel><title>GDACS RSS information</title>
<item>
<title>Orange earthquake (Magnitude 6.1M, Depth:10km) in Chile 09/11/2026 04:52 UTC, 230 thousand in MMI IV.</title>
<link>http://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1576372</link>
<pubDate>Mon, 09 Nov 2026 05:03:32 GMT</pubDate>
<gdacs:alertlevel>Orange</gdacs:alertlevel>
</item>
<item>
<title>Green forest fire notification in South Sudan</title>
<link>http://www.gdacs.org/report.aspx?eventtype=WF&amp;eventid=1033673</link>
<pubDate>Tue, 10 Nov 2026 00:01:09 GMT</pubDate>
<gdacs:alertlevel>Green</gdacs:alertlevel>
</item>
</channel></rss>`;
test("GDACS: alert level parsed, places extracted, Orange kept / Green dropped", () => {
  const items = parseRssItems(GDACS_XML);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].alertLevel, "Orange");
  assert.strictEqual(gdacsLocation(items[0].title), "Chile");
  assert.strictEqual(gdacsLocation(items[1].title), "South Sudan");
  const kept = items.filter(it => /orange|red/i.test(it.alertLevel || ""));
  assert.strictEqual(kept.length, 1);
});

// --- Regression: category must never be missing (CI crash "Invalid category in 601") ---
test("toQueueBlock: derives a valid category when the event has none", () => {
  const b = toQueueBlock({
    headline: "Magnitude 6.4 earthquake strikes near Solomon Islands",
    sourceName: "GDACS (EU JRC)",
    url: "https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1",
    date: "2026-11-09T03:34:59.000Z",
    location: "Solomon Islands",
    hash: "def456"
  }, 601);
  assert.strictEqual(b.category, "Environmental");
  assert.ok(["Accessibility & Universal Design","Environmental","Classrooms","Civic Tech"].includes(b.category));
  assert.strictEqual(b.status, "Proposed");
  assert.strictEqual(b.fundedUSD, 0);
  assert.strictEqual(b.votesCount, 0);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
