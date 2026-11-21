#!/usr/bin/env node
/**
 * scripts/generate-legislative-vote-template.js
 * Zero-dependency Node.js (v18+) generator for Polytab legislative vote templates
 * (bills, resolutions, joint/concurrent resolutions, laws) under "Policy & Governance Votes".
 *
 * Purpose: middleman-free community sentiment votes that act as a litmus test for what
 * communities want vs. how representatives actually vote.
 *
 * Modes:
 *  - default: writes final outputs
 *  - DRAFT=1 or --draft: writes draft outputs (*.draft.json) with _review hints
 *
 * Sources (public/free, no key): GovTrack API v2 (best-effort enrichment) + local seed manifest.
 * Honest-zero: fundedUSD/votesCount start at 0; no coordinates near private individuals.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const DRAFT = process.env.DRAFT === "1" || process.argv.includes("--draft");
const CONGRESS = Number(process.env.CONGRESS || 119);
const REPO_ROOT = process.cwd();

const CONFIG = {
  templateVersion: "pol-legislative-vote-beta-1",
  congress: CONGRESS,

  seedManifestPath: "docs/data/beta/legislative-votes-seed.json",
  outputDir: "docs/data/beta/legislative-votes",
  combinedOutputFile: DRAFT
    ? "docs/data/beta/legislative-votes-draft.json"
    : "docs/data/beta/legislative-votes-all.json",

  verifiedOrgsPath: "docs/data/verified-orgs.json",

  govtrackBillUrl: (govtrackId) => `https://www.govtrack.us/api/v2/bill/${govtrackId}`,
  govtrackSearchUrl: ({ congress, bill_type, number }) =>
    `https://www.govtrack.us/api/v2/bill?congress=${encodeURIComponent(congress)}&bill_type=${encodeURIComponent(bill_type)}&number=${encodeURIComponent(number)}&limit=1`,

  campaign: {
    type: "open_ended",
    funding_activation_threshold_usd: 5000,
    timer_starts: "on_funding_activation_threshold_reached",
    timer_duration_days: null,
    status_before_activation: "open_for_funding",
    status_after_activation: "active_voting_window"
  },

  payment: {
    chain: "base",
    chain_id: 8453,
    token: "USDC",
    wallet: "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08",
    qr_asset: "docs/escrow-qr.png",
    note: "Polytab wallet/QR (Base USDC). Claim-first, non-custodial routing; contributions settle per campaign policy once verified payout is unlocked."
  },

  location: {
    label: "United States Capitol",
    address: "First St SE, Washington, DC 20004, USA",
    lat: 38.8899,
    lng: -77.0091
  }
};

const BILL_TYPE_MAP = {
  hr: "house_bill",
  hres: "house_resolution",
  hjres: "house_joint_resolution",
  hconres: "house_concurrent_resolution",
  s: "senate_bill",
  sres: "senate_resolution",
  sjres: "senate_joint_resolution",
  sconres: "senate_concurrent_resolution"
};

const BILL_TYPE_DISPLAY = {
  house_bill: "H.R.",
  house_resolution: "H.Res.",
  house_joint_resolution: "H.J.Res.",
  house_concurrent_resolution: "H.Con.Res.",
  senate_bill: "S.",
  senate_resolution: "S.Res.",
  senate_joint_resolution: "S.J.Res.",
  senate_concurrent_resolution: "S.Con.Res."
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function isPlainObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function fetchJson(url, retries = 3, delayMs = 1200) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, {
        headers: {
          "User-Agent": "Polytab-Legislative-Vote-Template/1.0 (+https://polytab.store)",
          "Accept": "application/json"
        }
      }, (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); }
            catch (_e) { reject(new Error(`Invalid JSON from ${url}`)); }
          } else if ((res.statusCode === 429 || res.statusCode >= 500) && n < retries) {
            setTimeout(() => attempt(n + 1), delayMs * (n + 1));
          } else {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
        });
      });
      req.on("error", (err) => {
        if (n < retries) setTimeout(() => attempt(n + 1), delayMs * (n + 1));
        else reject(err);
      });
      req.setTimeout(15000, () => req.destroy(new Error(`Timeout ${url}`)));
    };
    attempt(0);
  });
}

function normalizeBillType(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/[.\s-]+/g, "");
  if (BILL_TYPE_MAP[k]) return BILL_TYPE_MAP[k];
  const direct = String(raw).toLowerCase();
  if (Object.values(BILL_TYPE_MAP).includes(direct)) return direct;
  return null;
}

function chamberForType(billType) {
  if (!billType) return "congress";
  if (billType.startsWith("house")) return "house";
  if (billType.startsWith("senate")) return "senate";
  return "joint";
}

function displayId(congress, billType, number) {
  const prefix = BILL_TYPE_DISPLAY[billType] || String(billType || "Bill").toUpperCase();
  return `${prefix} ${number} (${congress}th)`;
}

function bountyIdFor(congress, billType, number) {
  const t = String(billType || "bill").replace(/_/g, "-");
  return `leg-${congress}-${t}-${number}`;
}

function loadVerifiedOrgs() {
  const p = path.join(REPO_ROOT, CONFIG.verifiedOrgsPath);
  if (!fs.existsSync(p)) return [];
  try {
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    const arr = Array.isArray(v) ? v : (v.orgs || v.organizations || []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function pickBeneficiaries(orgs, { scope, states, max = 5 }) {
  let pool = orgs.filter((o) => o && (o.ein || o.name));
  const normStates = (states || []).map((s) => String(s).toUpperCase().replace(/^US-/, ""));
  if (scope === "state" && normStates.length) {
    pool = pool.filter((o) => normStates.includes(String(o.state || "").toUpperCase()));
  }
  pool = pool.slice().sort((a, b) => {
    const va = a && a.verification ? a.verification : {};
    const vb = b && b.verification ? b.verification : {};
    const sa = (va.is_501c3 ? 2 : 0) + (va.independently_filed ? 1 : 0) + (va.has_recent_filing ? 1 : 0);
    const sb = (vb.is_501c3 ? 2 : 0) + (vb.independently_filed ? 1 : 0) + (vb.has_recent_filing ? 1 : 0);
    if (sb !== sa) return sb - sa;
    const ra = (a.latest_filing && Number(a.latest_filing.total_revenue)) || 0;
    const rb = (b.latest_filing && Number(b.latest_filing.total_revenue)) || 0;
    return rb - ra;
  });
  return pool.slice(0, max).map((o) => ({
    ein: o.ein || null,
    name: o.name || null,
    city: o.city || null,
    state: o.state || null,
    source: o.source || "verified-orgs",
    registry_id: o.registry_id || null,
    source_url: (o.verification && o.verification.source_url) || null
  }));
}

async function enrichFromGovTrack(entry) {
  const congress = Number(entry.congress || CONFIG.congress);
  const billType = normalizeBillType(entry.bill_type || entry.type);
  const number = Number(entry.number);
  let bill = null;

  if (entry.govtrack_id) {
    try { bill = await fetchJson(CONFIG.govtrackBillUrl(entry.govtrack_id)); } catch (_) { bill = null; }
  }
  if (!bill && congress && billType && number) {
    try {
      const search = await fetchJson(CONFIG.govtrackSearchUrl({ congress, bill_type: billType, number }));
      if (search && Array.isArray(search.objects) && search.objects[0]) bill = search.objects[0];
    } catch (_) { bill = null; }
  }
  return bill;
}

function buildLegislation(entry, gt) {
  const congress = Number(entry.congress || (gt && gt.congress) || CONFIG.congress);
  const billType = normalizeBillType(entry.bill_type || entry.type || (gt && gt.bill_type)) || "house_bill";
  const number = Number(entry.number || (gt && gt.number) || 0);
  const chamber = entry.chamber || chamberForType(billType);
  const title = entry.title || (gt && (gt.title_without_number || gt.title)) || `[TITLE_REQUIRED ${displayId(congress, billType, number)}]`;
  const shortTitle = entry.short_title || (gt && gt.short_title) || null;
  const summary = entry.summary || (gt && gt.current_status_description) || null;

  const sponsor = entry.sponsor || (gt && gt.sponsor ? {
    name: gt.sponsor.name || null,
    party: gt.sponsor.party || null,
    state: gt.sponsor.state || null,
    bioguide_id: gt.sponsor.bioguideid || gt.sponsor.bioguide_id || null
  } : null);

  const sourceUrls = [];
  if (gt && gt.link) sourceUrls.push(gt.link);
  if (gt && gt.congressdotgov_url) sourceUrls.push(gt.congressdotgov_url);
  if (gt && gt.govtrack_url) sourceUrls.push(gt.govtrack_url);
  if (entry.congress_gov_url) sourceUrls.push(entry.congress_gov_url);
  if (entry.source_url) sourceUrls.push(entry.source_url);
  if (!sourceUrls.length && congress && billType && number) {
    const short = (BILL_TYPE_DISPLAY[billType] || "").toLowerCase().replace(/\./g, "");
    sourceUrls.push(`https://www.govtrack.us/congress/bills/${congress}/${short}${number}`);
  }

  const subjects = Array.isArray(entry.subjects)
    ? entry.subjects
    : (gt && Array.isArray(gt.subjects) ? gt.subjects.map((s) => (s && (s.name || s)) || null).filter(Boolean).slice(0, 20) : []);

  return {
    congress,
    session: entry.session || String(congress),
    chamber,
    bill_type: billType,
    number,
    display_id: entry.display_id || displayId(congress, billType, number),
    govtrack_id: entry.govtrack_id || (gt && gt.id) || null,
    title,
    short_title: shortTitle,
    summary,
    status: entry.status || (gt && gt.current_status) || "unknown",
    status_label: entry.status_label || (gt && gt.current_status_label) || null,
    status_date: entry.status_date || (gt && gt.current_status_date) || null,
    introduced_date: entry.introduced_date || (gt && gt.introduced_date) || null,
    latest_action: entry.latest_action || (gt && (gt.current_status_description || gt.latest_major_action)) || null,
    sponsor,
    subjects,
    source_urls: [...new Set(sourceUrls.filter(Boolean))]
  };
}

function buildVote(leg) {
  const id = leg.display_id;
  const title = leg.short_title || leg.title;
  const question = `[LITMUS TEST] ${id}: \"${title}\" — Should this measure pass as written? ` +
    `Cast your community vote (without middlemen) and compare community will with how representatives vote.`;
  return {
    question,
    type: "advisory_yes_no",
    options: ["Yes - Support passage", "No - Oppose passage", "Abstain"],
    litmus_test: {
      purpose: "Contrast community sentiment with representative roll-call votes (voting platform without middlemen).",
      community_vote: { yes: 0, no: 0, abstain: 0, source: "polytab_community" },
      representative_votes: {
        house: { yes: null, no: null, not_voting: null, roll_call: null, source_url: null },
        senate: { yes: null, no: null, not_voting: null, roll_call: null, source_url: null },
        by_member: []
      },
      comparison_note: "Populate representative_votes from official roll-call records to contrast with community results."
    }
  };
}

function buildBounty(leg, entry, beneficiaries) {
  const scope = entry.beneficiary_scope || "national";
  const states = (entry.beneficiary_states || []).map((s) => String(s).toUpperCase().replace(/^US-/, ""));
  const scopeLabel = scope === "state" && states.length ? `in ${states.join(", ")}` : (scope === "local" && (entry.localities || []).length ? `in ${(entry.localities || []).join(", ")}` : "(national/community scope as specified)");
  const description = entry.bounty_description || `[BETA_BOUNTY_OUTCOME] Open-ended campaign for ${leg.display_id}. Bounty benefits verified local entities/charities ${scopeLabel}, aligned with this Policy & Governance Vote.`;
  return {
    description,
    destination_type: entry.destination_type || "verified_charity_beneficiaries",
    destination_criteria: entry.bounty_criteria || "Funds directed to verified 501(c)(3)/public-benefit local entities/charities aligned with campaign scope and impact area; distribution finalized per campaign governance and verification.",
    beneficiary_scope: scope,
    beneficiary_states: states,
    localities: Array.isArray(entry.localities) ? entry.localities : [],
    eligible_beneficiaries: beneficiaries
  };
}

function buildReview(record) {
  const missing = [];
  const placeholders = [];
  if (!record.legislation || !record.legislation.number) missing.push("legislation.number");
  if (!record.legislation || String(record.legislation.title || "").includes("TITLE_REQUIRED")) placeholders.push("legislation.title");
  if (!record.legislation || !Array.isArray(record.legislation.source_urls) || record.legislation.source_urls.length === 0) missing.push("legislation.source_urls");
  if (String((record.vote && record.vote.question) || "").includes("[LITMUS TEST]") && !(record.legislation && record.legislation.short_title)) placeholders.push("vote.question (add plain-language short_title/summary)");
  if (!record.bounty_if_passed || !Array.isArray(record.bounty_if_passed.eligible_beneficiaries) || record.bounty_if_passed.eligible_beneficiaries.length === 0) placeholders.push("bounty_if_passed.eligible_beneficiaries");
  if (String((record.bounty_if_passed && record.bounty_if_passed.description) || "").includes("[BETA_BOUNTY_OUTCOME]")) placeholders.push("bounty_if_passed.description");
  if (!record.legislation || !record.legislation.status || record.legislation.status === "unknown") placeholders.push("legislation.status");
  return { missing, placeholders };
}

function ensureSeedManifest(seedPath) {
  if (fs.existsSync(seedPath)) return JSON.parse(fs.readFileSync(seedPath, "utf8"));
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  const starter = {
    _comment: "Seed manifest for national/congressional legislative votes (Policy & Governance Votes). Add bills/resolutions/laws to emit. Set enabled=true and provide congress/bill_type/number. Enrichment via GovTrack is best-effort and keyless.",
    congress: CONFIG.congress,
    campaigns: [
      {
        enabled: false,
        congress: CONFIG.congress,
        bill_type: "house_bill",
        number: 0,
        govtrack_id: null,
        title: "Example Bill Title",
        short_title: null,
        summary: "Plain-language summary of what this measure does and why communities may care.",
        status: "introduced",
        sponsor: null,
        beneficiary_scope: "national",
        beneficiary_states: [],
        localities: [],
        bounty_description: null,
        bounty_criteria: null,
        campaign_overrides: {
          funding_activation_threshold_usd: 5000,
          timer_duration_days: null
        },
        auto_fetch: true
      }
    ]
  };
  fs.writeFileSync(seedPath, JSON.stringify(starter, null, 2) + "\n", "utf8");
  console.log(`[Seed] Created starter seed manifest at ${seedPath}. Edit it (enabled:true, bill details), then re-run.`);
  return starter;
}

async function main() {
  const seedPath = path.join(REPO_ROOT, CONFIG.seedManifestPath);
  const seed = ensureSeedManifest(seedPath);
  const entries = Array.isArray(seed.campaigns) ? seed.campaigns : [];
  const enabled = entries.filter((e) => e && e.enabled !== false && Number(e.number) > 0);
  const orgs = loadVerifiedOrgs();

  if (!enabled.length) {
    console.log("[Info] No enabled campaigns with valid bill numbers in seed manifest. Add enabled entries to emit templates.");
  }

  const records = [];
  for (const entry of enabled) {
    const congress = Number(entry.congress || seed.congress || CONFIG.congress);
    const billType = normalizeBillType(entry.bill_type || entry.type) || "house_bill";
    const number = Number(entry.number);
    if (!number) continue;

    let gt = null;
    if (entry.auto_fetch !== false) {
      try { gt = await enrichFromGovTrack({ ...entry, congress, bill_type: billType, number }); }
      catch (_) { gt = null; }
      await sleep(250);
    }

    const legislation = buildLegislation({ ...entry, congress, bill_type: billType, number }, gt);
    const beneficiaries = pickBeneficiaries(orgs, {
      scope: entry.beneficiary_scope || "national",
      states: entry.beneficiary_states || [],
      max: Number(entry.beneficiary_count || 5)
    });

    const overrides = isPlainObject(entry.campaign_overrides) ? entry.campaign_overrides : {};
    const threshold = Number(overrides.funding_activation_threshold_usd || CONFIG.campaign.funding_activation_threshold_usd) || 5000;
    const campaign = {
      ...CONFIG.campaign,
      ...overrides,
      type: "open_ended",
      funding_activation_threshold_usd: threshold,
      timer_starts: "on_funding_activation_threshold_reached"
    };

    const bountyId = bountyIdFor(congress, billType, number);
    const record = {
      template_version: CONFIG.templateVersion,
      bounty_id: bountyId,
      slug: slugify(`${congress}-${billType}-${number}-${legislation.short_title || legislation.title}`),
      domain: "legislative",
      ui: {
        section: "Policy & Governance Votes",
        parent_category: "Voting",
        category: "Policy & Governance Votes",
        block: 93000
      },
      legislation,
      vote: buildVote(legislation),
      campaign,
      bounty_if_passed: buildBounty(legislation, entry, beneficiaries),
      metrics: {
        fundedUSD: 0,
        votesCount: 0,
        targetUSD: campaign.funding_activation_threshold_usd,
        honest_zero: true
      },
      location: CONFIG.location,
      payment: { ...CONFIG.payment, payment_memo_or_slug: bountyId },
      provenance: {
        status: DRAFT ? "beta_template_draft" : "beta_template",
        generated_at: new Date().toISOString(),
        generated_on: todayIso(),
        generator: "scripts/generate-legislative-vote-template.js",
        congress,
        sources: ["seed_manifest", ...(gt ? ["govtrack_api_v2"] : [])],
        review_required: true
      }
    };

    const review = buildReview(record);
    if (DRAFT) record._review = review;
    records.push(record);
  }

  const outDir = path.join(REPO_ROOT, CONFIG.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const suffix = DRAFT ? ".draft.json" : ".json";
  for (const r of records) {
    const file = path.join(outDir, `${r.bounty_id}${suffix}`);
    fs.writeFileSync(file, JSON.stringify(r, null, 2) + "\n", "utf8");
  }

  const combined = {
    template_version: CONFIG.templateVersion,
    generated_at: new Date().toISOString(),
    draft: DRAFT,
    count: records.length,
    records
  };
  const combinedPath = path.join(REPO_ROOT, CONFIG.combinedOutputFile);
  fs.mkdirSync(path.dirname(combinedPath), { recursive: true });
  fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2) + "\n", "utf8");

  console.log(`[Done] ${DRAFT ? "Draft" : "Final"} records: ${records.length}`);
  console.log(`[Out]  ${combinedPath}`);
  if (records.length) console.log(`[Out]  ${path.join(outDir, `*${suffix}`)}`);
  if (DRAFT && records.some((r) => r._review && (r._review.missing.length || r._review.placeholders.length))) {
    console.log("[Review] Some records have missing fields/placeholders. Edit drafts or seed manifest, then finalize.");
  }
}

main().catch((err) => {
  console.error("[Fatal]", err && err.stack ? err.stack : err);
  process.exit(1);
});
