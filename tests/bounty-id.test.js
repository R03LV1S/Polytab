// Offline tests for the canonical bounty identifier (scripts/bounty-id.js)
// and its JSON Schema contract (docs/data/schema/bounty.schema.json).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const id = require(path.join(__dirname, "..", "scripts", "bounty-id.js"));

const ROOT = path.join(__dirname, "..");
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "data", "schema", "bounty.schema.json"), "utf8"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n      " + e.message); }
}

const SAMPLE = { env: "prod", platform: "gh", org: "Hyperlink", repo: "core-api", issueNumber: 408 };

test("generateBountyId: matches the canonical pattern", () => {
  const bid = id.generateBountyId(SAMPLE);
  assert.ok(id.ID_PATTERN.test(bid), "id does not match ID_PATTERN: " + bid);
  assert.strictEqual(bid.split("_").length, 7, "expected 7 underscore-separated segments: " + bid);
  assert.ok(bid.startsWith("bty_prod_gh_hyperlink_core-api_408_"), bid);
});

test("generateBountyId: generated ids satisfy the JSON Schema id pattern", () => {
  const re = new RegExp(schema.properties.id.pattern);
  for (const s of [SAMPLE, { env: "dev", platform: "gl", org: "acme corp!", repo: "web.app", issueNumber: 7 }, { org: "x", repo: "y", issueNumber: 1 }]) {
    const bid = id.generateBountyId(s);
    assert.ok(re.test(bid), "schema pattern rejected " + bid);
  }
});

test("generateBountyId: deterministic (webhook redelivery => identical id)", () => {
  assert.strictEqual(id.generateBountyId(SAMPLE), id.generateBountyId({ ...SAMPLE }));
  const a = id.generateBountyId(SAMPLE);
  const b = id.generateBountyId({ env: "prod", platform: "gh", org: "Hyperlink", repo: "core-api", issueNumber: 408 });
  assert.strictEqual(a, b, "same source must yield the same id");
});

test("generateBountyId: distinct sources yield distinct ids", () => {
  const base = id.generateBountyId(SAMPLE);
  assert.notStrictEqual(base, id.generateBountyId({ ...SAMPLE, issueNumber: 409 }));
  assert.notStrictEqual(base, id.generateBountyId({ ...SAMPLE, org: "other" }));
  assert.notStrictEqual(base, id.generateBountyId({ ...SAMPLE, env: "stg" }));
});

test("generateBountyId: sanitizes org/repo into [a-z0-9-]", () => {
  const bid = id.generateBountyId({ env: "prod", platform: "gh", org: "Acme Corp.!!", repo: "Web_App/One", issueNumber: 12 });
  assert.ok(/^bty_prod_gh_[a-z0-9-]+_[a-z0-9-]+_12_[a-z0-9]{4,}$/.test(bid), bid);
  assert.ok(bid.includes("acme-corp"), bid);
});

test("generateBountyId: defaults env/platform, clamps invalid issue numbers", () => {
  const bid = id.generateBountyId({ org: "a", repo: "b", issueNumber: -5 });
  assert.ok(bid.startsWith("bty_prod_gh_a_b_0_"), bid);
});

test("parseBountyId: round-trips a generated id", () => {
  const bid = id.generateBountyId(SAMPLE);
  const parsed = id.parseBountyId(bid);
  assert.strictEqual(parsed.env, "prod");
  assert.strictEqual(parsed.platform, "gh");
  assert.strictEqual(parsed.org, "hyperlink");
  assert.strictEqual(parsed.repo, "core-api");
  assert.strictEqual(parsed.issueNumber, 408);
  assert.strictEqual(id.parseBountyId("not-a-bounty"), null);
});

test("isBountyId: true for canonical, false for junk", () => {
  assert.strictEqual(id.isBountyId(id.generateBountyId(SAMPLE)), true);
  assert.strictEqual(id.isBountyId("bty_prod_gh_a"), false);
  assert.strictEqual(id.isBountyId("601"), false);
});

test("schema: honest-zero reward and no coordinates/PII fields", () => {
  assert.strictEqual(schema.properties.reward.properties.amount.minimum, 0);
  assert.ok(/honest-zero/i.test(schema.properties.reward.properties.amount.description || ""));
  assert.strictEqual(schema.additionalProperties, false);
  const keys = Object.keys(schema.properties).join(" ").toLowerCase();
  for (const banned of ["lat", "lng", "latitude", "longitude", "coords", "coordinates", "georss"]) {
    assert.ok(!keys.includes(banned), "schema must not carry " + banned);
  }
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
