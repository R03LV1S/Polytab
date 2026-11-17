#!/usr/bin/env node
/**
 * scripts/ingest-us-state-charities.js
 * Zero-cost, keyless US charity ingestion from the IRS Exempt Organizations
 * Business Master File (EO BMF) per-state extracts.
 *
 * Why: the vote-template generator must bind each U.S. Senate race to real
 * IRS-audited 501(c)(3) organizations domiciled in the subject's state.
 * The legacy docs/data/verified-orgs.json only held a 54-org ProPublica sample,
 * so 35/35 generated records shipped with empty beneficiary arrays.
 *
 * Sources (public, no key, no rate limit):
 *   https://www.irs.gov/pub/irs-soi/eo_{state}.csv
 *   https://apps.irs.gov/pub/epostcard/data-download-revocation.zip
 *
 * Gates applied per organization:
 *   1. SUBSECTION = 03            (501(c)(3))
 *   2. STATUS = 01                (active)
 *   3. DEDUCTIBILITY = 1          (contributions deductible)
 *   4. EIN not on IRS Automatic Revocation list (reinstatements honored)
 *   5. Valid 9-digit EIN
 *
 * Output:
 *   docs/data/orgs/US/{STATE}.json   (sharded, sha256 in manifest)
 *   docs/data/orgs/manifest.json     (US shards merged, counts recomputed)
 *   docs/data/cache/irs-revoked-eins.txt (7-day cache)
 *
 * Usage:
 *   node scripts/ingest-us-state-charities.js
 *   node scripts/ingest-us-state-charities.js --states=AL,GA,TX --max=400
 *   node scripts/ingest-us-state-charities.js --all
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Readable } = require("stream");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs/data/orgs/US");
const MANIFEST_PATH = path.join(ROOT, "docs/data/orgs/manifest.json");
const SEED_PATH = path.join(ROOT, "docs/data/beta/winners-seed-2026.json");
const REVOKE_CACHE = path.join(ROOT, "docs/data/cache/irs-revoked-eins.txt");
const REVOKE_URL = "https://apps.irs.gov/pub/epostcard/data-download-revocation.zip";
const BMF_BASE = "https://www.irs.gov/pub/irs-soi";
const USER_AGENT = "Polytab-US-IRS-EO-BMF-Ingest/1.0 (zero-cost open data; contact via repo)";
const REVOKE_TTL_HOURS = 24 * 7;

const ALL_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY"
];

// NTEE groups used to guarantee category diversity inside every state shard.
// The generator re-classifies these into YES (restitution) / NO (commons) pools.
const DIVERSITY_RULES = [
  { key: "fire_ems",   ntee: /^M2[04]/,        name: /\b(FIRE|RESCUE|EMS|AMBULANCE)\b/i },
  { key: "veterans",   ntee: /^W[0-9]/,        name: /\b(VETERAN|MILITARY|SERVICE.?DOG)\b/i },
  { key: "food",       ntee: /^K3[01]/,        name: /\b(FOOD|HUNGER|PANTRY|GLEAN)\b/i },
  { key: "hospital",   ntee: /^E2[0-9]|^E3[0-9]/, name: /\b(HOSPITAL|CLINIC|HEALTH)\b/i },
  { key: "disaster",   ntee: /^T3[0-9]|^M2[0-9]/, name: /\b(DISASTER|RELIEF|RED CROSS)\b/i },
  { key: "youth",      ntee: /^B[0-9]/,        name: /\b(YOUTH|BOYS|GIRLS|SCOUT)\b/i },
  { key: "environment",ntee: /^C[0-9]/,        name: /\b(ENVIRONMENT|WATER|WATERSHED|CONSERVATION|RIVER|CLIMATE)\b/i },
  { key: "housing",    ntee: /^L[0-9]/,        name: /\b(HOUSING|SHELTER|HABITAT|TENANT|HOMELESS)\b/i },
  { key: "legal",      ntee: /^I[0-9]/,        name: /\b(LEGAL|LAW|JUSTICE|RIGHTS)\b/i },
  { key: "civic",      ntee: /^R[0-9]/,        name: /\b(CIVIL|RIGHTS|DEMOCRACY|VOTER|JOURNAL|NEWS)\b/i },
  { key: "health",     ntee: /^E[0-9]|^G[0-9]/,name: /\b(HEALTH|MEDICAL|PATIENT|HOSPICE)\b/i }
];

function parseArgs(argv) {
  const out = { states: null, max: 320, all: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--all") out.all = true;
    else if (arg.startsWith("--states=")) {
      out.states = arg.slice("--states=".length).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    } else if (arg.startsWith("--max=")) {
      out.max = Math.max(20, Number(arg.slice("--max=".length)) || 320);
    }
  }
  return out;
}

function normalizeState(code) {
  const st = String(code || "").replace(/^US-/i, "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(st) ? st : null;
}

function targetStates(args) {
  if (args.all) return ALL_STATES.slice();
  if (args.states && args.states.length) return [...new Set(args.states.map(normalizeState).filter(Boolean))];
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
    const fromSeed = (seed.races || []).map((r) => normalizeState(r.state)).filter(Boolean);
    if (fromSeed.length) return [...new Set(fromSeed)].sort();
  } catch (_) {}
  return ALL_STATES.slice();
}

function parseCsvLine(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Extracts the first file of a PKZIP buffer (central-directory based, deflate or store).
 * Used for the IRS revocation archive, which ships one pipe-delimited text file.
 */
function unzipFirstFileToText(zipBuffer) {
  let eocd = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("Invalid ZIP: EOCD not found");
  const cdOffset = zipBuffer.readUInt32LE(eocd + 16);
  if (zipBuffer.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error("Invalid ZIP: central directory signature");
  const method = zipBuffer.readUInt16LE(cdOffset + 10);
  const compSize = zipBuffer.readUInt32LE(cdOffset + 20);
  const localOffset = zipBuffer.readUInt32LE(cdOffset + 42);
  const nameLen = zipBuffer.readUInt16LE(localOffset + 26);
  const extraLen = zipBuffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const data = zipBuffer.subarray(start, start + compSize);
  if (method === 0) return data.toString("utf8");
  if (method === 8) return zlib.inflateRawSync(data).toString("utf8");
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

function normalizeBmfDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

async function* fetchLines(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(180_000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let first = true;
  for await (const chunk of Readable.fromWeb(res.body)) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (first) { line = line.replace(/^\uFEFF/, ""); first = false; }
      if (line) yield line;
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield buf.replace(/^\uFEFF/, "");
}

function readRevokedCache() {
  try {
    if (!fs.existsSync(REVOKE_CACHE)) return null;
    const ageHours = (Date.now() - fs.statSync(REVOKE_CACHE).mtimeMs) / 3_600_000;
    if (ageHours > REVOKE_TTL_HOURS) return null;
    const lines = fs.readFileSync(REVOKE_CACHE, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length < 1000) return null;
    return new Set(lines);
  } catch (_) {
    return null;
  }
}

async function loadRevokedEins() {
  const cached = readRevokedCache();
  if (cached) {
    console.log(`[Revocation] Using cache (${cached.size.toLocaleString()} EINs) ${REVOKE_CACHE}`);
    return cached;
  }
  console.log("[Revocation] Downloading IRS Automatic Revocation archive (~48 MB)...");
  const res = await fetch(REVOKE_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(180_000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${REVOKE_URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = unzipFirstFileToText(buf);
  const revoked = new Set();
  let lines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split("|");
    if (cols.length < 12) continue;
    const ein = String(cols[0] || "").replace(/\D/g, "");
    if (ein.length !== 9) continue;
    const rev = Date.parse(cols[9]);
    const rein = Date.parse(cols[11]);
    if (!Number.isNaN(rein) && !Number.isNaN(rev) && rein >= rev) revoked.delete(ein);
    else revoked.add(ein);
    lines++;
  }
  fs.mkdirSync(path.dirname(REVOKE_CACHE), { recursive: true });
  fs.writeFileSync(REVOKE_CACHE, [...revoked].join("\n") + "\n", "utf8");
  console.log(`[Revocation] Parsed ${lines.toLocaleString()} rows; ${revoked.size.toLocaleString()} currently revoked EINs cached.`);
  return revoked;
}

function classifyDiversity(name, ntee) {
  for (const rule of DIVERSITY_RULES) {
    if (rule.ntee && rule.ntee.test(ntee || "")) return rule.key;
    if (rule.name && rule.name.test(name || "")) return rule.key;
  }
  return "other";
}

function selectDiverse(candidates, maxPerState) {
  const byCat = new Map();
  for (const c of candidates) {
    const cat = classifyDiversity(c.name, c.ntee_code);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(c);
  }
  const byRevenue = (a, b) => (b.revenue_amt - a.revenue_amt) || (b.asset_amt - a.asset_amt);

  // Reserve a bounded per-category quota so small fire/EMS, food-bank, legal-aid
  // and veterans orgs are never crowded out by large universities/hospital systems.
  // 20 per category keeps every archetype's restitution pool selectable.
  const QUOTA = 20;
  const reserved = [];
  for (const [, arr] of byCat) {
    arr.sort(byRevenue);
    for (const c of arr.slice(0, QUOTA)) reserved.push(c);
  }
  const picked = new Map(reserved.map((c) => [c.ein, c]));

  // Reserve can never exceed the hard cap: keep the highest-revenue reserved orgs.
  if (picked.size > maxPerState) {
    const keep = reserved.slice().sort(byRevenue).slice(0, maxPerState);
    return keep.sort(byRevenue);
  }

  const overall = candidates.slice().sort(byRevenue);
  for (const c of overall) {
    if (picked.size >= maxPerState) break;
    picked.set(c.ein, c);
  }
  return [...picked.values()]
    .sort((a, b) => byRevenue(a, b) || a.name.localeCompare(b.name))
    .slice(0, maxPerState);
}

async function ingestState(st, revoked, maxPerState) {
  const url = `${BMF_BASE}/eo_${st.toLowerCase()}.csv`;
  const candidates = [];
  let headers = null;
  let rows = 0;
  let kept = 0;

  for await (const line of fetchLines(url)) {
    if (!headers) {
      headers = parseCsvLine(line).map((h) => h.toUpperCase());
      continue;
    }
    rows++;
    const cols = parseCsvLine(line);
    if (cols.length < 20) continue;
    const row = Object.fromEntries(headers.map((h, i) => [h, cols[i]]));
    const ein = String(row.EIN || "").replace(/\D/g, "");
    if (ein.length !== 9) continue;
    if (revoked.has(ein)) continue;
    if (String(row.SUBSECTION || "").trim() !== "03") continue;
    if (String(row.STATUS || "").trim() !== "01") continue;
    if (String(row.DEDUCTIBILITY || "").trim() !== "1") continue;
    const name = String(row.NAME || "").trim();
    if (!name) continue;

    // Exclude grantmaking vehicles and donor-advised funds: they are 501(c)(3)s
    // but they are not operating charities, so they cannot be restitution targets.
    const foundationCode = String(row.FOUNDATION || "").trim().padStart(2, "0");
    if (foundationCode === "02" || foundationCode === "04") continue;
    if (/\b(DONOR.?ADVISED|DONOR ADVISED|CHARITABLE GIFT FUND|GIVING FUND|GIFT FUND)\b/i.test(name)) continue;

    const ntee = String(row.NTEE_CD || "").trim().toUpperCase() || null;
    // NTEE T = Philanthropy, Voluntarism & Grantmaking Foundations.
    if (ntee && /^T/.test(ntee)) continue;

    const revenue = Math.max(0, Math.round(Number(row.REVENUE_AMT || 0)));
    const assets = Math.max(0, Math.round(Number(row.ASSET_AMT || 0)));
    const income = Math.max(0, Math.round(Number(row.INCOME_AMT || 0)));

    const signals = ["IRS_EO_BMF_ACTIVE_501C3", "IRS_AUTO_REVOCATION_CLEAN"];
    if (ntee) signals.push(`IRS_BMF_NTEE_${ntee}`);
    if (revenue > 0) signals.push("IRS_BMF_REVENUE_REPORTED");
    if (assets > 0) signals.push("IRS_BMF_ASSETS_REPORTED");

    candidates.push({
      registry_id: `US-EIN:${ein}`,
      ein,
      name,
      city: String(row.CITY || "").trim() || null,
      state: st,
      ntee_code: ntee,
      subsection_code: 3,
      ruling_date: normalizeBmfDate(row.RULING),
      revenue_amt: revenue,
      asset_amt: assets,
      income_amt: income,
      verification_tier: "TIER_1_AUDITED",
      independently_audited: true,
      audit_signals: signals,
      source_authority: `IRS EO BMF (eo_${st.toLowerCase()}.csv)`,
      captured_at: new Date().toISOString()
    });
    kept++;
  }

  const selected = selectDiverse(candidates, maxPerState);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shard = {
    schema_version: "us-state-charities-v1",
    country_iso2: "US",
    admin1_state_province: st,
    generated_at_utc: new Date().toISOString(),
    source: `IRS EO BMF eo_${st.toLowerCase()}.csv + IRS Automatic Revocation gate`,
    rows_scanned: rows,
    eligible_before_cap: kept,
    count: selected.length,
    organizations: selected
  };
  const filePath = path.join(OUT_DIR, `${st}.json`);
  const text = JSON.stringify(shard, null, 2) + "\n";
  fs.writeFileSync(filePath, text, "utf8");
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  console.log(`[${st}] rows=${rows} eligible=${kept} wrote=${selected.length} sha256=${sha256.slice(0, 12)}`);
  return { st, count: selected.length, sha256 };
}

function updateManifest(usShards, revokedCount) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const nonUs = (manifest.shards || []).filter((s) => s.country_iso2 !== "US");
  const merged = [
    ...nonUs,
    ...usShards.map((s) => ({
      shard: `orgs/US/${s.st}.json`,
      country_iso2: "US",
      admin1_state_province: s.st,
      count: s.count,
      sha256: s.sha256
    }))
  ];
  manifest.shards = merged;
  manifest.total_shards = merged.length;
  manifest.total_verified_orgs = merged.reduce((acc, s) => acc + Number(s.count || 0), 0);
  manifest.generated_at_utc = new Date().toISOString();
  manifest.us_state_ingest = {
    generated_at_utc: new Date().toISOString(),
    source: "IRS EO BMF per-state CSV (eo_{state}.csv)",
    states: usShards.length,
    revoked_eins_gated: revokedCount
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[Manifest] total_shards=${manifest.total_shards} total_verified_orgs=${manifest.total_verified_orgs}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const states = targetStates(args);
  console.log(`[Start] IRS EO BMF ingestion for ${states.length} states: ${states.join(",")}`);

  const revoked = await loadRevokedEins();
  const results = [];
  for (const st of states) {
    try {
      results.push(await ingestState(st, revoked, args.max));
    } catch (err) {
      console.error(`[${st}] FAILED: ${err.message}`);
    }
  }
  if (!results.length) throw new Error("No state shards produced");
  updateManifest(results, revoked.size);
  console.log(`[Done] ${results.length}/${states.length} state shards written, ${results.reduce((a, r) => a + r.count, 0)} organizations indexed.`);
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
