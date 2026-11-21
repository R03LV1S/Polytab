#!/usr/bin/env node
/**
 * scripts/generate-legislative-vote-seed.js
 * Auto-discover recent/upcoming/active national congressional bills & resolutions
 * (Policy & Governance Votes) from keyless public official sources and write/update
 * the legislative seed manifest.
 *
 * Sources (no API key, $0, reputable/official where possible):
 *   - GovInfo Bills RSS:        https://www.govinfo.gov/rss/bills.xml (recently published/updated)
 *   - House Floor (this week):  https://docs.house.gov/floor/ (scheduled/considered measures)
 *   - Senate Active Legislation: https://www.senate.gov/legislative/active_leg_page.htm (active measures)
 *
 * Best-effort discovery: parses measures, dedupes by (congress,type,number), enables as campaigns.
 * "Upcoming votes" in real time are chamber-specific; for richest coverage Congress.gov API (key) or
 * manual/browser scrubbing can supplement (see script menu: open sources, import/bulk add).
 *
 * Env/options:
 *   CONGRESS=119        target Congress (default 119)
 *   LIMIT=25            max campaigns to seed (default 25)
 *   MERGE=1             merge into existing seed (default) vs replace campaigns
 *   REPLACE=1           replace campaigns list with discovered set
 *   SOURCES=govinfo,house_floor,senate_active   comma list (default: all)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const CONGRESS = Number(process.env.CONGRESS || 119);
const LIMIT = Math.max(1, Number(process.env.LIMIT || 25));
const REPLACE = process.env.REPLACE === "1";
const MERGE = !REPLACE;
const SOURCES = new Set(String(process.env.SOURCES || "govinfo,house_floor,senate_active").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

const REPO_ROOT = process.cwd();
const SEED_PATH = path.join(REPO_ROOT, "docs/data/beta/legislative-votes-seed.json");

const GOVINFO_RSS = "https://www.govinfo.gov/rss/bills.xml";
const HOUSE_FLOOR_URL = "https://docs.house.gov/floor/";
const SENATE_ACTIVE_URL = "https://www.senate.gov/legislative/active_leg_page.htm";

const TYPE_MAP = {
  hr: "house_bill",
  hres: "house_resolution",
  hjres: "house_joint_resolution",
  hconres: "house_concurrent_resolution",
  s: "senate_bill",
  sres: "senate_resolution",
  sjres: "senate_joint_resolution",
  sconres: "senate_concurrent_resolution"
};

const CONGRESS_GOV_TYPE_TO_CODE = {
  "house-bill": "hr",
  "house-resolution": "hres",
  "house-joint-resolution": "hjres",
  "house-concurrent-resolution": "hconres",
  "senate-bill": "s",
  "senate-resolution": "sres",
  "senate-joint-resolution": "sjres",
  "senate-concurrent-resolution": "sconres"
};

function fetchText(url, retries = 3, delayMs = 1200) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Polytab-Legislative-Seed/1.0 (+https://polytab.store)",
          "Accept": "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*"
        }
      }, (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else if ((res.statusCode === 429 || res.statusCode >= 500) && n < retries) {
            setTimeout(() => attempt(n + 1), delayMs * (n + 1));
          } else reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        });
      });
      req.on("error", (err) => {
        if (n < retries) setTimeout(() => attempt(n + 1), delayMs * (n + 1));
        else reject(err);
      });
      req.setTimeout(20000, () => req.destroy(new Error(`Timeout ${url}`)));
    };
    attempt(0);
  });
}

function decodeEntities(s) {
  let out = String(s || "");
  out = out.replace(/&amp;/g, "&");
  out = out.replace(/&nbsp;/gi, " ");
  out = out.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  out = out.replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return Number.isFinite(c) ? String.fromCharCode(c) : _; });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, n) => { const c = parseInt(n, 16); return Number.isFinite(c) ? String.fromCharCode(c) : _; });
  return out.replace(/\s+/g, " ").trim();
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " "));
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  let v = m[1];
  const cdata = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (cdata) v = cdata[1];
  return v;
}

function normalizeTypeCode(code) {
  if (!code) return null;
  const c = String(code).toLowerCase().replace(/[\s.]/g, "");
  if (TYPE_MAP[c]) return c;
  if (c === "housebill") return "hr";
  if (c === "senatebill") return "s";
  return TYPE_MAP[c] ? c : null;
}

function parseBillRef(text) {
  // "H.R. 7254", "H. R. 9640", "H.R.2347", "S.2256", "H. Res. 1247", "H.Res.1247", "S.J.Res.1" etc.
  const t = decodeEntities(text).replace(/\s+/g, " ").trim();
  const m = t.match(/\b(H\.?\s*R\.?|S\.?|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|S\.?\s*Con\.?\s*Res\.?)\s*(\d{1,5})\b/i);
  if (!m) return null;
  const raw = m[1].toLowerCase().replace(/[\s.]/g, "");
  let typeCode = null;
  if (raw === "hr") typeCode = "hr";
  else if (raw === "s") typeCode = "s";
  else if (raw === "hres") typeCode = "hres";
  else if (raw === "sres") typeCode = "sres";
  else if (raw === "hjres") typeCode = "hjres";
  else if (raw === "sjres") typeCode = "sjres";
  else if (raw === "hconres") typeCode = "hconres";
  else if (raw === "sconres") typeCode = "sconres";
  if (!typeCode) return null;
  return { typeCode, number: Number(m[2]) };
}

function toCampaign({ congress, typeCode, number, title, summary, source, sourceLink, status, extraMeta }) {
  const billType = TYPE_MAP[typeCode];
  if (!billType || !number) return null;
  const cleanTitle = decodeEntities(String(title || "").replace(/\s+/g, " ")).trim() || `${typeCode.toUpperCase()} ${number}`;
  const cleanSummary = summary ? decodeEntities(String(summary).replace(/\s+/g, " ")).trim() : `Auto-discovered (${source}): ${cleanTitle}`;
  return {
    enabled: true,
    congress: Number(congress || CONGRESS),
    bill_type: billType,
    number: Number(number),
    govtrack_id: null,
    title: cleanTitle,
    short_title: cleanTitle,
    summary: cleanSummary,
    status: status || "introduced",
    sponsor: null,
    beneficiary_scope: "national",
    beneficiary_states: [],
    localities: [],
    bounty_description: null,
    bounty_criteria: null,
    campaign_overrides: { funding_activation_threshold_usd: 5000, timer_duration_days: null },
    auto_fetch: true,
    _seed_meta: {
      source,
      discovered_at: new Date().toISOString(),
      source_link: sourceLink || null,
      ...(extraMeta || {})
    }
  };
}

function loadOrInitSeed() {
  if (fs.existsSync(SEED_PATH)) {
    try { return JSON.parse(fs.readFileSync(SEED_PATH, "utf8")); } catch (_) {}
  }
  return {
    _comment: "Seed manifest for national/congressional legislative votes (Policy & Governance Votes). Use menu option 6 to auto-discover (GovInfo RSS, House floor, Senate active - keyless), option 5 to quick-add manually, or edit/import manually. Set enabled=true and provide congress/bill_type/number.",
    congress: CONGRESS,
    campaigns: []
  };
}

async function discoverFromGovInfoRss() {
  if (!SOURCES.has("govinfo") && !SOURCES.has("govinfo_rss")) return [];
  console.log(`[Seed] Fetching GovInfo Bills RSS: ${GOVINFO_RSS}`);
  let xml;
  try { xml = await fetchText(GOVINFO_RSS); } catch (e) { console.warn(`[Seed] GovInfo RSS failed: ${e.message}`); return []; }
  const blocks = xml.split("<item>").slice(1);
  const out = [];
  for (const b of blocks) {
    const titleRaw = extractTag(b, "title") || "";
    const link = stripTags(extractTag(b, "link") || "");
    const pubDate = stripTags(extractTag(b, "pubDate") || "");
    const m = String(link || "").match(/BILLS-(\d+)(hr|s|hres|sres|hjres|sjres|hconres|sconres)(\d+)/i);
    if (!m) continue;
    const congress = Number(m[1]);
    if (CONGRESS && congress !== CONGRESS) continue;
    const typeCode = m[2].toLowerCase();
    const number = Number(m[3]);
    // clean title: "H.R. 5549 (EH) - Efficient Nuclear Licensing Hearings Act"
    const t = decodeEntities(titleRaw).replace(/\s+/g, " ").trim();
    const tm = t.match(/^(?:H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.|S\.Res\.|S\.J\.Res\.|S\.Con\.Res\.)\s*\d+\s*(?:\([^)]*\))?\s*[-–—:]\s*(.+)$/i);
    const cleanTitle = tm ? tm[1].trim() : t.replace(/^(?:H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.|S\.Res\.|S\.J\.Res\.|S\.Con\.Res\.)\s*\d+\s*(?:\([^)]*\))?\s*[-–—:]?\s*/i, "").trim() || t;
    out.push(toCampaign({ congress, typeCode, number, title: cleanTitle, source: "govinfo_bills_rss", sourceLink: link, extraMeta: { pub_date: pubDate } }));
  }
  return out.filter(Boolean);
}

async function discoverFromHouseFloor() {
  if (!SOURCES.has("house_floor") && !SOURCES.has("house")) return [];
  console.log(`[Seed] Fetching House floor (Bills This Week): ${HOUSE_FLOOR_URL}`);
  let html;
  try { html = await fetchText(HOUSE_FLOOR_URL); } catch (e) { console.warn(`[Seed] House floor failed: ${e.message}`); return []; }
  const out = [];
  const seen = new Set();
  // Pattern: <td class="legisNum" ...>H.R. 7254</td> <td class="floorText" ...>Title</td>
  const re = /<td[^>]*class="legisNum"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="floorText"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = parseBillRef(stripTags(m[1]));
    if (!ref) continue;
    const key = `${CONGRESS}|${ref.typeCode}|${ref.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = stripTags(m[2]).replace(/,\s*as amended\s*$/i, "").trim();
    out.push(toCampaign({ congress: CONGRESS, typeCode: ref.typeCode, number: ref.number, title, source: "house_floor_bills_this_week", sourceLink: HOUSE_FLOOR_URL, status: "scheduled_or_considered", extraMeta: { note: "House floor / Bills This Week" } }));
  }
  // Fallback: any H.R./S./Res refs if table parsing missed
  if (!out.length) {
    const refRe = /\b((?:H\.R\.|S\.|H\.\s*Res\.|S\.\s*Res\.|H\.\s*J\.\s*Res\.|S\.\s*J\.\s*Res\.|H\.\s*Con\.\s*Res\.|S\.\s*Con\.\s*Res\.))\s*(\d{1,5})\b/gi;
    let rm;
    while ((rm = refRe.exec(html)) !== null) {
      const ref = parseBillRef(rm[0]);
      if (!ref) continue;
      const key = `${CONGRESS}|${ref.typeCode}|${ref.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(toCampaign({ congress: CONGRESS, typeCode: ref.typeCode, number: ref.number, title: `${rm[1].replace(/\s+/g,"")} ${rm[2]}`, source: "house_floor_bills_this_week", sourceLink: HOUSE_FLOOR_URL, status: "scheduled_or_considered" }));
    }
  }
  return out.filter(Boolean);
}

async function discoverFromSenateActive() {
  if (!SOURCES.has("senate_active") && !SOURCES.has("senate")) return [];
  console.log(`[Seed] Fetching Senate active legislation: ${SENATE_ACTIVE_URL}`);
  let html;
  try { html = await fetchText(SENATE_ACTIVE_URL); } catch (e) { console.warn(`[Seed] Senate active failed: ${e.message}`); return []; }
  const out = [];
  const seen = new Set();
  // Reliable: congress.gov bill links in page, e.g. /bill/119th-congress/house-bill/2347
  const re = /https?:\/\/www\.congress\.gov\/bill\/(\d+)th-congress\/(house-bill|senate-bill|house-resolution|senate-resolution|house-joint-resolution|senate-joint-resolution|house-concurrent-resolution|senate-concurrent-resolution)\/(\d+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const congress = Number(m[1]);
    if (CONGRESS && congress !== CONGRESS) continue;
    const typeCode = CONGRESS_GOV_TYPE_TO_CODE[m[2].toLowerCase()];
    const number = Number(m[3]);
    if (!typeCode || !number) continue;
    const key = `${congress}|${typeCode}|${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // try to get nearby text/topic label (heuristic: look backwards for table cell text)
    let title = `${typeCode.toUpperCase()} ${number}`;
    const ctxStart = Math.max(0, m.index - 300);
    const ctx = stripTags(html.slice(ctxStart, m.index));
    // last meaningful segment before link
    const parts = ctx.split(/\s{2,}|[\n\r\t]+/).map(s => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.length > 8 && !/^--$/.test(p) && !/^(S\.|H\.R\.|H\.Res|S\.Res)/i.test(p) && !/^(Appropriations|Program Authorizations|Agency Authorizations|Other)$/i.test(p)) {
        title = p.replace(/\s*\(.*?\)\s*$/,"").trim() || title;
        break;
      }
    }
    out.push(toCampaign({ congress, typeCode, number, title, source: "senate_active_legislation", sourceLink: SENATE_ACTIVE_URL, status: "active", extraMeta: { note: "Senate commonly searched/active legislation" } }));
  }
  return out.filter(Boolean);
}

(async () => {
  const results = await Promise.allSettled([
    discoverFromGovInfoRss(),
    discoverFromHouseFloor(),
    discoverFromSenateActive()
  ]);
  const all = [];
  const sourceCounts = {};
  const sourceNames = ["govinfo_bills_rss", "house_floor_bills_this_week", "senate_active_legislation"];
  results.forEach((r, i) => {
    const name = sourceNames[i] || `source_${i}`;
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      sourceCounts[name] = r.value.length;
      all.push(...r.value);
    } else {
      sourceCounts[name] = 0;
      if (r.status === "rejected") console.warn(`[Seed] ${name} error: ${r.reason && r.reason.message ? r.reason.message : r.reason}`);
    }
  });

  // dedupe preserving order (earlier sources first? we ran in parallel, but prioritize house_floor/senate_active as more "upcoming/active")
  const priority = { "house_floor_bills_this_week": 0, "senate_active_legislation": 1, "govinfo_bills_rss": 2 };
  all.sort((a, b) => (priority[a?._seed_meta?.source] ?? 9) - (priority[b?._seed_meta?.source] ?? 9));
  const seen = new Set();
  const discovered = [];
  for (const c of all) {
    if (!c) continue;
    const key = `${c.congress}|${c.bill_type}|${c.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    discovered.push(c);
    if (discovered.length >= LIMIT) break;
  }

  if (!discovered.length) {
    console.log(`[Seed] No matching bills/resolutions discovered for Congress ${CONGRESS}.`);
  }

  const seed = loadOrInitSeed();
  if (!Array.isArray(seed.campaigns)) seed.campaigns = [];
  seed.congress = CONGRESS;

  if (REPLACE) {
    seed.campaigns = discovered;
  } else {
    const idx = new Map();
    seed.campaigns.forEach((c, i) => idx.set(`${c.congress}|${c.bill_type}|${c.number}`, i));
    for (const c of discovered) {
      const k = `${c.congress}|${c.bill_type}|${c.number}`;
      if (idx.has(k)) {
        const i = idx.get(k);
        const prev = seed.campaigns[i] || {};
        seed.campaigns[i] = { ...c, ...{
          enabled: prev.enabled !== false,
          beneficiary_scope: prev.beneficiary_scope || c.beneficiary_scope,
          beneficiary_states: (prev.beneficiary_states && prev.beneficiary_states.length) ? prev.beneficiary_states : c.beneficiary_states,
          localities: (prev.localities && prev.localities.length) ? prev.localities : c.localities,
          bounty_description: prev.bounty_description || c.bounty_description,
          bounty_criteria: prev.bounty_criteria || c.bounty_criteria,
          short_title: prev.short_title || c.short_title,
          summary: prev.summary || c.summary,
          title: (prev.title && prev.title !== c.title && !/^[A-Z.]+\s*\d+$/i.test(prev.title)) ? prev.title : c.title,
          campaign_overrides: prev.campaign_overrides || c.campaign_overrides
        } };
      } else {
        seed.campaigns.push(c);
      }
    }
  }

  fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true });
  fs.writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + "\n", "utf8");
  const enabled = seed.campaigns.filter((c) => c && c.enabled !== false && Number(c.number) > 0).length;
  console.log(`[Seed] Wrote ${seed.campaigns.length} campaign(s) (${enabled} enabled) to ${SEED_PATH}`);
  console.log(`[Seed] Discovered this run: ${discovered.length} (Congress ${CONGRESS}, limit ${LIMIT}, mode ${REPLACE ? "replace" : "merge"})`);
  console.log(`[Seed] Source hits (pre-dedupe): ${JSON.stringify(sourceCounts)}`);
})().catch((e) => { console.error(e); process.exit(1); });
