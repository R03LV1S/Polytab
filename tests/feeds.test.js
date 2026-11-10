// Offline tests for the RSS/geoRSS feed generator (no network needed).
//
// These tests verify the feeds mirror docs/feed.json EXACTLY — no invented
// funding or vote numbers — and that the XML files are structurally sane.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const gen = require(path.join(__dirname, "..", "scripts", "generate-feeds.js"));

const DOCS = path.join(__dirname, "..", "docs");
const shelf = JSON.parse(fs.readFileSync(path.join(DOCS, "feed.json"), "utf8"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n      " + e.message); }
}

function readUtf8NoBom(name) {
  const p = path.join(DOCS, name);
  const buf = fs.readFileSync(p);
  assert.ok(!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF), name + " must not start with a UTF-8 BOM");
  return buf.toString("utf8");
}

test("esc: escapes XML metacharacters", () => {
  assert.strictEqual(gen.esc('A & B <tag> "q" \'s\''), "A &amp; B &lt;tag&gt; &quot;q&quot; &apos;s&apos;");
});

test("rfc822: valid ISO date -> RFC 822, invalid -> null", () => {
  assert.strictEqual(gen.rfc822("2026-11-09T18:00:00Z"), "Mon, 09 Nov 2026 18:00:00 GMT");
  assert.strictEqual(gen.rfc822("nonsense"), null);
  assert.strictEqual(gen.rfc822(null), null);
});

test("itemDescription: mirrors feed.json metrics exactly (no fabricated numbers)", () => {
  for (const item of shelf.items) {
    const desc = gen.itemDescription(item);
    const m = item._polytab || {};
    assert.ok(desc.includes("Funded: $" + Number(m.fundedUSD).toFixed(2)), "funded mismatch for #" + item.id);
    assert.ok(desc.includes("Votes: " + (Number(m.votesCount) || 0)), "votes mismatch for #" + item.id);
    assert.ok(desc.includes("Category: " + m.category), "category missing for #" + item.id);
    if (!Number(m.fundedUSD) && !Number(m.votesCount)) {
      assert.ok(desc.includes("Honest-zero"), "zero-metric item must say Honest-zero (#" + item.id + ")");
    }
  }
});

test("generate: writes all three feeds with one item per shelf entry", () => {
  gen.main();
  for (const name of ["feed.xml", "feeds/global.xml", "feeds/audio.xml"]) {
    const xml = readUtf8NoBom(name);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), name + " declaration");
    assert.ok(xml.trim().endsWith("</rss>"), name + " closing tag");
    const items = (xml.match(/<item>/g) || []).length;
    assert.strictEqual(items, shelf.items.length, name + " item count");
  }
});

test("feed.xml: every shelf id has a guid, no geo coordinates", () => {
  const xml = readUtf8NoBom("feed.xml");
  for (const item of shelf.items) {
    assert.ok(xml.includes("polytab:shelf:" + item.id), "missing guid for #" + item.id);
  }
  assert.strictEqual((xml.match(/<georss:point>/g) || []).length, 0);
});

test("feeds/global.xml: geoRSS points only for items with coordinates", () => {
  const xml = readUtf8NoBom("feeds/global.xml");
  const withCoords = shelf.items.filter((i) => {
    const m = i._polytab || {};
    return Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng));
  });
  assert.strictEqual((xml.match(/<georss:point>/g) || []).length, withCoords.length);
  // Coordinates must be rounded to 2 decimals (neighborhood-level, anti-doxing)
  const points = [...xml.matchAll(/<georss:point>(-?\d+\.\d+) (-?\d+\.\d+)<\/georss:point>/g)];
  for (const p of points) {
    assert.strictEqual(p[1].split(".")[1].length, 2, "latitude not rounded: " + p[1]);
    assert.strictEqual(p[2].split(".")[1].length, 2, "longitude not rounded: " + p[2]);
  }
});

test("feeds/audio.xml: no fake audio enclosures", () => {
  const xml = readUtf8NoBom("feeds/audio.xml");
  assert.strictEqual((xml.match(/<enclosure/g) || []).length, 0);
  assert.ok(/no audio enclosures/i.test(xml));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
