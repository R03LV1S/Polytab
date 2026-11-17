/**
 * scripts/lib/sop-ledger-cache.js
 * Single-chokepoint SOP Ledger, LIFO Prepend Log, and TTL/ETag Cache.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SOP_SENTINEL = "<!-- === SOP:PREPEND_BELOW_THIS_LINE === -->";

const JSON_SOP_HEADER = Object.freeze({
  DO_NOT_REMOVE: "Hard-encoded machine-readable SOP header for Polytab incremental data mining.",
  schema_version: "1.0.0",
  ordering_invariant: "lifo_delta_log[0] is ALWAYS the newest mining event (prepended via unshift). Never append to bottom.",
  security_invariant: "All URLs must have api_key query parameters redacted prior to indexing or logging.",
  ttl_policy: "Historical legislators: 720h | OpenFEC totals/committees/donors: 72h | VoteLog & Current legislators: 24h"
});

const MD_SOP_HEADER = [
  "---",
  'sop_schema: "polytab-sop-ledger-v1"',
  'mutation_rule: "PREPEND_ONLY_BELOW_SENTINEL"',
  "---",
  "",
  "# 🛡️ POLYTAB IMMUTABLE SOP & INCREMENTAL MINING LEDGER",
  "> **MACHINE & HUMAN OPERATING DIRECTIVE (DO NOT REMOVE)**",
  "> 1. **Purpose:** Prevents redundant re-mining of OpenFEC, VoteLog, and Congress-Legislators endpoints across runs.",
  "> 2. **Prepend Protocol (LIFO):** Every cycle MUST prepend its summary immediately **below** the sentinel marker so the newest update is always at the top of the list.",
  "> 3. **Cache Lookup:** `fetchJsonWithRetry` checks `docs/data/cache/mining-state-ledger.json` first and skips network I/O when within TTL.",
  "",
  SOP_SENTINEL
].join("\n");

function redactUrl(rawUrl) {
  return String(rawUrl || "").replace(/([?&]api_key=)[^&]+/gi, "$1REDACTED");
}

// Test/synthetic hosts must never enter the production mining ledger.
const NON_PRODUCTION_HOSTS = /(^|\.)(example\.com|example\.org|example\.net|localhost|test|invalid|local)$/i;

function isProductionUrl(cleanUrl) {
  let host;
  try {
    const u = new URL(cleanUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname;
  } catch (_) {
    return false;
  }
  if (!host || NON_PRODUCTION_HOSTS.test(host)) return false;
  if (/^(127\.|0\.0\.0\.0|\[::1\])/.test(host)) return false;
  return true;
}

function getTtlHoursForUrl(cleanUrl) {
  if (cleanUrl.includes("legislators-historical")) return 720; // 30 days
  if (cleanUrl.includes("api.open.fec.gov")) return 72;        // 3 days
  return 24;                                                   // 1 day default
}

function isNonEmptyPayload(data) {
  if (!data) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (Array.isArray(data.results)) return data.results.length > 0;
  return Object.keys(data).length > 0;
}

function createSopCache(repoRoot = process.cwd()) {
  const cacheDir = path.join(repoRoot, "docs/data/cache");
  const blobsDir = path.join(cacheDir, "blobs");
  const jsonLedgerPath = path.join(cacheDir, "mining-state-ledger.json");
  const mdLedgerPath = path.join(repoRoot, "docs/data/LEDGER-MINING-SOP.md");
  const forceRemine = process.env.FORCE_REMINE === "1" || process.argv.includes("--force-remine");

  fs.mkdirSync(blobsDir, { recursive: true });

  let state = {
    $sop_instructions: JSON_SOP_HEADER,
    last_updated_utc: new Date().toISOString(),
    lifo_delta_log: [],
    endpoints: {}
  };

  if (fs.existsSync(jsonLedgerPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonLedgerPath, "utf8"));
      state.lifo_delta_log = Array.isArray(parsed.lifo_delta_log) ? parsed.lifo_delta_log : [];
      state.endpoints = parsed.endpoints || {};
      // Scrub any historical non-production pollution from the ledger.
      for (const url of Object.keys(state.endpoints)) {
        if (!isProductionUrl(url)) {
          try { fs.unlinkSync(path.join(repoRoot, state.endpoints[url]?.blob || "")); } catch (_) {}
          delete state.endpoints[url];
        }
      }
      state.lifo_delta_log = state.lifo_delta_log.filter((e) => isProductionUrl(e?.endpoint || ""));
    } catch (_) {}
  }

  const stats = { hits: 0, misses: 0, http304: 0 };

  async function fetchWithSopCache(rawUrl, rawFetchFn) {
    const cleanUrl = redactUrl(rawUrl);
    if (!isProductionUrl(cleanUrl)) {
      // Never persist synthetic/test endpoints; pass straight through.
      return rawFetchFn();
    }
    const keyHash = crypto.createHash("sha256").update(cleanUrl).digest("hex").slice(0, 24);
    const blobFile = path.join(blobsDir, `${keyHash}.json`);
    const entry = state.endpoints[cleanUrl];
    const now = Date.now();

    if (!forceRemine && entry && fs.existsSync(blobFile) && now < Date.parse(entry.expires_at_utc || 0)) {
      try {
        const cachedData = JSON.parse(fs.readFileSync(blobFile, "utf8"));
        if (isNonEmptyPayload(cachedData)) {
          stats.hits++;
          return cachedData;
        }
      } catch (_) {}
    }

    // Execute live network fetch
    const freshData = await rawFetchFn();
    const valid = isNonEmptyPayload(freshData);
    const ttlHours = valid ? getTtlHoursForUrl(cleanUrl) : 6; // 6h cooldown on empty responses

    const serialized = JSON.stringify(freshData);
    const payloadHash = crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 16);

    if (valid) {
      fs.writeFileSync(`${blobFile}.tmp`, serialized, "utf8");
      fs.renameSync(`${blobFile}.tmp`, blobFile);
    }

    const changed = !entry || entry.payload_sha256 !== payloadHash;
    state.endpoints[cleanUrl] = {
      mined_at_utc: new Date(now).toISOString(),
      expires_at_utc: new Date(now + ttlHours * 3_600_000).toISOString(),
      payload_sha256: payloadHash,
      non_empty: valid,
      blob: `docs/data/cache/blobs/${keyHash}.json`
    };

    if (changed && valid) {
      state.lifo_delta_log.unshift({
        timestamp_utc: new Date(now).toISOString(),
        action: entry ? "UPDATED" : "MINED_NEW",
        endpoint: cleanUrl,
        payload_sha256: payloadHash
      });
      if (state.lifo_delta_log.length > 200) state.lifo_delta_log.length = 200;
    }

    stats.misses++;
    return freshData;
  }

  function commitLedger(runLabel = "votes-2026") {
    state.last_updated_utc = new Date().toISOString();
    const orderedJson = {
      $sop_instructions: JSON_SOP_HEADER,
      last_updated_utc: state.last_updated_utc,
      lifo_delta_log: state.lifo_delta_log,
      endpoints: state.endpoints
    };
    fs.writeFileSync(`${jsonLedgerPath}.tmp`, JSON.stringify(orderedJson, null, 2) + "\n", "utf8");
    fs.renameSync(`${jsonLedgerPath}.tmp`, jsonLedgerPath);

    let tail = "";
    if (fs.existsSync(mdLedgerPath)) {
      const rawMd = fs.readFileSync(mdLedgerPath, "utf8");
      const idx = rawMd.indexOf(SOP_SENTINEL);
      if (idx !== -1) tail = rawMd.slice(idx + SOP_SENTINEL.length).trim().slice(0, 40000);
    }

    const topBlock = [
      `### [${state.last_updated_utc}] Run: \`${runLabel}\``,
      `- **Local Cache Hits (Skipped Network):** ${stats.hits}`,
      `- **Newly Mined / Refreshed Endpoints:** ${stats.misses}`,
      `- **Total Cached Endpoints Indexed:** ${Object.keys(state.endpoints).length}`
    ].join("\n");

    const mdOut = `${MD_SOP_HEADER}\n\n${topBlock}${tail ? "\n\n" + tail : ""}\n`;
    fs.writeFileSync(`${mdLedgerPath}.tmp`, mdOut, "utf8");
    fs.renameSync(`${mdLedgerPath}.tmp`, mdLedgerPath);
    console.log(`[SOP-Ledger] Hits=${stats.hits}, Misses=${stats.misses} -> Committed ${mdLedgerPath}`);
  }

  return { fetchWithSopCache, commitLedger };
}

module.exports = { createSopCache };