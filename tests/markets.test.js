// Offline tests for the Futarchy market + forecast reputation data.
//
// These lock in two user-mandated rules:
//   1. 100% of every stake funds the project the staker chose. No protocol
//      slice, no pooled redistribution, no staker payout.
//   2. Incentives are non-monetary: accuracy rate, win/loss record, badges.
// Plus the standing rules: honest-zero metrics and no location/PII data.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const DOCS = path.join(__dirname, "..", "docs");
const marketsFile = JSON.parse(fs.readFileSync(path.join(DOCS, "data", "markets.json"), "utf8"));
const ledger = JSON.parse(fs.readFileSync(path.join(DOCS, "data", "forecasters.json"), "utf8"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n      " + e.message); }
}

function walk(node, visit, trail) {
  const at = trail || "$";
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, visit, at + "[" + i + "]"));
  if (node && typeof node === "object") {
    return Object.keys(node).forEach((k) => {
      visit(k, node[k], at + "." + k);
      walk(node[k], visit, at + "." + k);
    });
  }
  return undefined;
}

test("funding policy: 100% project escrow, 0% protocol fee, 0% staker payout", () => {
  const p = marketsFile.fundingPolicy;
  assert.ok(p, "fundingPolicy missing");
  assert.strictEqual(p.projectEscrowPct, 100);
  assert.strictEqual(p.protocolFeePct, 0);
  assert.strictEqual(p.stakerPayoutPct, 0);
});

test("incentive policy: reputation only, never money", () => {
  const p = marketsFile.incentivePolicy;
  assert.ok(p, "incentivePolicy missing");
  assert.strictEqual(p.type, "non-monetary-reputation");
  assert.ok(/never .*(redeemable|transferable|paid)/i.test(p.description), "must state reputation is not cashable");
  assert.strictEqual(ledger.payoutPolicy, "none — reputation is never redeemable, transferable, or paid in money.");
});

test("no redistributive or betting language survives in market copy", () => {
  const forbidden = [
    /10%\s*protocol/i,
    /protocol slice of winning/i,
    /losing[- ]side(?:'s)? stakes? (?:route|fund)/i,
    /bet on beliefs/i,
    /betting product/i,
    /\bcurrentOdds\b/,
    /\bodds\b/i
  ];
  walk(marketsFile, (k, v) => {
    if (typeof v !== "string") return;
    for (const re of forbidden) {
      assert.ok(!re.test(v), "forbidden phrase " + re + " in markets.json value: " + v.slice(0, 100));
      assert.ok(!re.test(k), "forbidden key " + re + " in markets.json");
    }
  });
});

test("honest-zero: every market starts unfunded with an unset forecast split", () => {
  assert.ok(marketsFile.markets.length >= 2);
  for (const m of marketsFile.markets) {
    assert.strictEqual(m.totalVolumeUSD, 0, m.id + " totalVolumeUSD must be 0");
    assert.strictEqual(m.forecastSplit, null, m.id + " forecastSplit must be null");
    assert.strictEqual(m.status, "Open", m.id + " status");
    assert.ok(Number(m.stakePriceUSD) > 0, m.id + " stakePriceUSD must be a real price");
  }
});

test("every outcome routes to the shared Polytab-managed Base escrow", () => {
  const ESCROW = "0x1e89ff2c2922528c8cEB0dB07F73ef979Ea76C08";
  for (const m of marketsFile.markets) {
    assert.ok(m.outcomes.length >= 2, m.id + " needs at least two outcomes");
    for (const o of m.outcomes) {
      assert.strictEqual(o.escrowWallet, ESCROW, m.id + " outcome " + o.key + " must fund the shared Polytab escrow");
      assert.ok(/^\d+$/.test(o.beneficiaryBountyId), m.id + " outcome " + o.key + " needs a numeric bounty id");
      assert.ok(/^https?:\/\//.test((m.oracle || {}).source || ""), m.id + " oracle source must be a public URL");
    }
  }
});

test("resolution copy credits an outcome instead of paying stakers", () => {
  for (const m of marketsFile.markets) {
    assert.ok(/credit/i.test(m.resolutionRule), m.id + " resolutionRule must speak of credit, not payout");
    assert.ok(/100% of every stake/i.test(m.fundingRule), m.id + " fundingRule must state 100% to project");
    assert.ok(/nothing is paid|never paid|not paid|never money|no payout/i.test(m.reputationRule), m.id + " reputationRule must deny payment");
    assert.ok(!/loser|winner takes|payout to staker/i.test(m.fundingRule + " " + m.reputationRule), m.id + " gambling framing");
  }
});

test("forecast ledger starts empty — no invented leaderboard rows", () => {
  assert.ok(Array.isArray(ledger.forecasters));
  assert.strictEqual(ledger.forecasters.length, 0);
  assert.strictEqual(ledger.updatedAt, null);
  assert.ok(ledger.badges.length >= 3, "badges must be defined");
  for (const b of ledger.badges) {
    assert.ok(b.key && b.label && b.rule, "badge needs key/label/rule");
    assert.ok(!/money|usd|cash|payout/i.test(b.label + " " + b.rule), "badge must not imply money: " + b.key);
  }
});

test("no coordinates or home-address fields anywhere in market/ledger data", () => {
  walk({ marketsFile, ledger }, (k, v) => {
    assert.ok(!/^(lat|lng|latitude|longitude|coords|coordinates|georss)$/i.test(k), "location key present: " + k);
    if (typeof v === "string") {
      assert.ok(!/^-?\d{1,3}\.\d{2,},\s*-?\d{1,3}\.\d{2,}$/.test(v.trim()), "coordinate pair present: " + v);
    }
  });
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
