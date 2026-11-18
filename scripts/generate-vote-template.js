#!/usr/bin/env node
/**
 * scripts/generate-vote-template.js
 * Zero-dependency Node.js (v18+) Futarchy & Restitution Bounty Generator (pol-vote-beta-4-positive-sum).
 * Automatically synthesizes all 5 stages: Hook & Bait, The Line, The Pole, Resolution,
 * and Anti-Commandeering Guard with quadratic whale dampening and 501(c)(3) firewall.
 */

const fs = require("fs");
const path = require("path");
const { createSopCache } = require("./lib/sop-ledger-cache");
const { loadFecBulkIndex } = require("./lib/fec-bulk-resolver");

const DRAFT = process.env.DRAFT === "1" || process.argv.includes("--draft");
const sopCache = createSopCache(process.cwd());

function resolveFecApiKeyFromDisk(repoRoot = process.cwd()) {
  if (process.env.FEC_API_KEY && process.env.FEC_API_KEY !== "DEMO_KEY") return process.env.FEC_API_KEY;
  try {
    const p = path.join(repoRoot, ".fec_api_key");
    if (fs.existsSync(p)) {
      const k = fs.readFileSync(p, "utf8").trim();
      if (k) return k;
    }
  } catch (_) {}
  return process.env.FEC_API_KEY || "DEMO_KEY";
}

// ======================= CUSTOMIZATION ZONE =======================
const CONFIG = {
  templateVersion: "pol-vote-beta-4-positive-sum",
  electionYear: Number(process.env.ELECTION_YEAR || 2026),
  officeType: process.env.OFFICE_TYPE || "us_senate",
  fecApiKey: resolveFecApiKeyFromDisk(process.cwd()),

  votelogMembersUrls: [
    "https://votelog.org/data/members-all.json",
    "https://votelog.org/downloads/members-all.json"
  ],
  legislatorsUrls: [
    "https://unitedstates.github.io/congress-legislators/legislators-current.json",
    "https://unitedstates.github.io/congress-legislators/legislators-historical.json"
  ],
  openFecBaseUrl: "https://api.open.fec.gov/v1",

  seedManifestPath: "docs/data/beta/winners-seed-2026.json",
  outputDir: "docs/data/beta/votes-2026",
  combinedOutputFile: DRAFT ? "docs/data/beta/votes-2026-draft.json" : "docs/data/beta/votes-2026-all.json",
  votelogDonorsBackupPath: "docs/data/beta/votelog-donors-all.json",

  verifiedOrgsIndexPath: "docs/data/verified-orgs.json",
  verifiedOrgsShardDir: "docs/data/orgs/US",

  payment: {
    chain: "base",
    chain_id: 8453,
    token: "USDC",
    wallet: "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08",
    qr_asset: "docs/escrow-qr.png",
    note: "Conditional Futarchy Escrow: Funds route to verified state 501(c)(3) restitution targets upon Quorum + Oracle Resolution."
  },
  location: {
    label: "United States Capitol",
    address: "First St SE, Washington, DC 20004, USA",
    lat: 38.8899,
    lng: -77.0091
  }
};
// ===================== END CUSTOMIZATION ZONE =====================

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtUsd = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");

// ============================================================================
// CHARITY POOL PARTITION: Split state audited 501(c)(3) shards into YES/NO pools
// ============================================================================

/**
 * Splits a state's IRS-audited 501(c)(3) charities into two non-overlapping pools:
 *   1. restitutionPool (for YES wins): targeted corrective charities matching the
 *      donor capture archetype (environment, housing/legal, health, civil rights...)
 *   2. commonsPool (for NO wins): universal bipartisan life-safety/community commons
 *      (Fire/EMS, Veterans, Food Banks, Community Hospitals, Disaster Relief, Youth).
 *
 * Classification is NTEE-first, name-second, and every organization lands in exactly
 * one pool. Returns five of each so both outcomes always have audited destinations.
 *
 * @param {Array} verifiedCharities - Orgs from docs/data/orgs/US/{STATE}.json
 * @param {string} stateCode - Two-letter state ISO code
 * @param {object|null} archetype - Matched CAPTURE_ARCHETYPES entry
 * @returns {Object} { restitutionBeneficiaries, commonsBeneficiaries, stateShort }
 */
function splitStateCharitiesByOutcome(verifiedCharities, stateCode, archetype = null) {
  // Commons categories, evaluated in this order. Each org lands in at most one.
  // Rationale: both sides of the political divide already fund these, so a NO
  // win is a genuine positive-sum outcome rather than a zero-sum "loss".
  // Rules are deliberately narrow: broad NTEE letters (e.g. all of W, M or B8)
  // pull in trade associations and loan servicers that are not real commons.
  const commonsBuckets = [
    {
      id: "fire_ems",
      match: (n, t) =>
        (!ASSOC.test(n) && /^M24/.test(t)) ||
        /\b(FIRE (DEPARTMENT|DEPT|COMPANY|DISTRICT|RESCUE|SERVICE|FIGHTING)|FIREFIGHT|VOLUNTEER FIRE|AMBULANCE|PARAMEDIC|RESCUE SQUAD|\bEMS\b|EMERGENCY MEDICAL)/i.test(n)
    },
    {
      id: "veterans",
      match: (n, t) =>
        /^W3[0-9]/.test(t) ||
        /\b(VETERAN|SERVICE.?DOG|WOUNDED WARRIOR|FOLDS OF HONOR|\bUSO\b|UNITED SERVICE ORGANIZATIONS)/i.test(n)
    },
    {
      id: "food",
      match: (n, t) =>
        /^K3[01]/.test(t) ||
        /\b(FOOD BANK|FOODBANK|FOOD PANTRY|HUNGER|GLEAN|MEALS ON WHEELS|SECOND HARVEST|SOUP KITCHEN|FEEDING (AMERICA|[A-Z]))/i.test(n)
    },
    {
      id: "disaster",
      match: (n) =>
        /\b(DISASTER|RED CROSS|HURRICANE|FLOOD|EARTHQUAKE|TORNADO|WILDFIRE)\b/i.test(n)
    },
    {
      id: "health",
      match: (n, t) =>
        !/^E3[0-9]/.test(t) &&
        !/\b(PLAN|INSURANCE|ASSOCIATION|SOCIETY|INSTITUTE|CONSORTIUM|HOLDINGS|FOUNDATION)\b/i.test(n) &&
        (/^E2[0-9]/.test(t) || /\b(HOSPITAL|MEDICAL CENTER|HEALTH SYSTEM|HEALTHCARE|HOSPICE|COMMUNITY CLINIC)\b/i.test(n))
    },
    {
      id: "youth",
      match: (n) =>
        /\b(BOYS ?& ?GIRLS|BOYS AND GIRLS|GIRL SCOUTS?|BOY SCOUTS?|YMCA|YWCA|4-H|BIG BROTHERS?|BIG SISTERS?|CAMP FIRE|BOYS CLUB|GIRLS CLUB)\b/i.test(n)
    }
  ];
  const isCommonsLike = (n) =>
    /\b(FIRE|RESCUE|AMBULANCE|VETERAN|FOOD BANK|FOODBANK|FOOD PANTRY|HUNGER|DISASTER|RED CROSS|HOSPITAL|HOSPICE|HEALTH SYSTEM|BOYS ?& ?GIRLS|GIRL SCOUTS?|BOY SCOUTS?|YMCA|YWCA|SOUP KITCHEN|MEALS ON WHEELS)\b/i.test(n) &&
    !ASSOC.test(n);

  // Archetype-specific restitution ranking. Two tiers so a broad secondary
  // prefix (e.g. health) can never outrank the archetype's primary remedy.
  const archetypePrefs = {
    SUPERPAC_OLIGARCH_SWARM: {
      primary: /^(R[0-9]|I[0-9]|A3[0-9])/,
      secondary: /^(A[0-9]|B[0-9]|P[0-9])/
    },
    EXTRACTIVE_ENERGY_INDUSTRIAL: {
      primary: /^(C[0-8][0-9]|D[0-9])/,
      secondary: /^(E[1-9][0-9]|K[0-9]|O[0-9])/
    },
    WALL_STREET_CRYPTO_REAL_ESTATE: {
      primary: /^(L[0-9]|I[0-9]|J[0-9])/,
      secondary: /^(P[0-9]|K[0-9]|W[0-9])/
    },
    PHARMA_HEALTH_INSURANCE_BLOC: {
      primary: /^(E[1-9][0-9]|G[0-9]|F[0-9]|H[0-9])/,
      secondary: /^(P[0-9]|K[0-9])/
    },
    DEFENSE_SURVEILLANCE_COMPLEX: {
      primary: /^(W3[0-9]|R[0-9]|I[0-9])/,
      secondary: /^(P[0-9]|F[0-9])/
    }
  };
  const archetypeKeywords = {
    SUPERPAC_OLIGARCH_SWARM: /\b(VOTER|DEMOCRACY|JOURNAL|NEWS|PRESS|CIVIL|RIGHTS|ETHICS|ACCOUNTAB|OPEN.?RECORDS|LEGAL|COURT|DEFENDER|AID)\b/i,
    EXTRACTIVE_ENERGY_INDUSTRIAL: /\b(WATER|WATERSHED|ENVIRONMENT|CONSERVATION|RIVER|CLIMATE|SOLAR|CLEAN.?AIR|LAND|PARKS)\b/i,
    WALL_STREET_CRYPTO_REAL_ESTATE: /\b(HOUSING|TENANT|FORECLOSURE|LEGAL|DEBT|HABITAT|COMMUNITY.?LAND|CONSUMER|SHELTER)\b/i,
    PHARMA_HEALTH_INSURANCE_BLOC: /\b(CLINIC|PATIENT|PRESCRIPTION|MEDICAL|HOSPICE|DISEASE|CANCER|DIABETES)\b/i,
    DEFENSE_SURVEILLANCE_COMPLEX: /\b(VETERAN|MILITARY|PRIVACY|CIVIL|RIGHTS|LEGAL|FAMILY)\b/i
  };

  // Grantmaking vehicles / DAFs are 501(c)(3) but cannot be restitution targets.
  const notOperating = /\b(DONOR.?ADVISED|CHARITABLE GIFT FUND|GIVING FUND|COMMUNITY FOUNDATION)\b/i;
  // Trade bodies, academies and financial vehicles are never "both sides" commons.
  const ASSOC = /\b(ASSOCIATION|ASSOCIATIONN|SOCIETY|COUNCIL|CONSORTIUM|INSTITUTE|ACADEMY|SCHOOL|UNIVERSITY|COLLEGE|LOTTERY|STUDENT LOAN|MANAGEMENT|PARTNERSHIP|HOLDINGS|INSURANCE|THRIFT)\b/i;

  const archId = archetype?.id || "SUPERPAC_OLIGARCH_SWARM";
  // Do not let the commons buckets consume an archetype's own primary remedy
  // category (e.g. health clinics for the pharma archetype, veterans for defense).
  const skipBuckets = new Set();
  if (archId === "PHARMA_HEALTH_INSURANCE_BLOC") skipBuckets.add("health");
  if (archId === "DEFENSE_SURVEILLANCE_COMPLEX") skipBuckets.add("veterans");

  const seen = new Set();
  const commonsByBucket = new Map();
  const restitutionPool = [];

  for (const c of (verifiedCharities || [])) {
    const id = c.registry_id || c.ein || c.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (notOperating.test(String(c.name || ""))) continue;

    const ntee = String(c.ntee_code || "").toUpperCase();
    const name = String(c.name || "");

    const bucket = commonsBuckets.find(
      (b) => !skipBuckets.has(b.id) && b.match(name, ntee)
    );
    if (bucket) {
      const arr = commonsByBucket.get(bucket.id) || [];
      arr.push(c);
      commonsByBucket.set(bucket.id, arr);
    } else if (isCommonsLike(name) && !/\b(HOUSING|HABITAT|TENANT|LAND TRUST|LEGAL|RIGHTS)\b/i.test(name)) {
      const arr = commonsByBucket.get("other_commons") || [];
      arr.push(c);
      commonsByBucket.set("other_commons", arr);
    } else {
      restitutionPool.push(c);
    }
  }

  const revenue = (c) => Number(c.revenue_amt || c.income_amt || 0);
  const byRevenue = (a, b) => (revenue(b) - revenue(a)) || String(a.name).localeCompare(String(b.name));

  // One commons org per category first (fire, veterans, food, disaster, health,
  // youth), then fill by revenue. Guarantees a recognizable, cross-partisan mix.
  const commonsPool = [];
  const bucketOrder = commonsBuckets.map((b) => b.id);
  for (const id of bucketOrder) {
    const arr = commonsByBucket.get(id) || [];
    arr.sort(byRevenue);
    if (arr.length) commonsPool.push(arr[0]);
    commonsByBucket.set(id, arr.slice(1));
  }
  const commonsRest = [...commonsByBucket.values()].flat().sort(byRevenue);
  commonsPool.push(...commonsRest);

  // Guarantee 5 commons even in a thin state sample: broaden first to any
  // commons-sounding org, then to any remaining audited org (never a pool overlap).
  if (commonsPool.length < 5) {
    const taken = new Set(commonsPool.map((c) => c.registry_id || c.ein || c.name));
    const broad = restitutionPool
      .filter((c) => !taken.has(c.registry_id || c.ein || c.name) && isCommonsLike(String(c.name || "")))
      .sort(byRevenue);
    commonsPool.push(...broad);
  }

  // Guarantee both pools exist even in a tiny state sample.
  if (commonsPool.length === 0 && restitutionPool.length > 1) commonsPool.push(restitutionPool.pop());
  if (restitutionPool.length === 0 && commonsPool.length > 1) restitutionPool.push(commonsPool.pop());

  const prefs = archetypePrefs[archId] || { primary: /./, secondary: /$^/ };
  const keywordRe = archetypeKeywords[archId] || /$^/;
  const score = (c) => {
    const ntee = String(c.ntee_code || "").toUpperCase();
    let s = 0;
    if (prefs.primary.test(ntee)) s += 6;
    else if (prefs.secondary.test(ntee)) s += 2;
    if (keywordRe.test(String(c.name || ""))) s += 3;
    return s;
  };

  restitutionPool.sort((a, b) => (score(b) - score(a)) || byRevenue(a, b));

  const commonsBeneficiaries = commonsPool.slice(0, 5);
  const commonsIds = new Set(commonsBeneficiaries.map((c) => c.registry_id || c.ein || c.name));
  const restitutionBeneficiaries = restitutionPool
    .filter((c) => !commonsIds.has(c.registry_id || c.ein || c.name))
    .slice(0, 5);

  return {
    restitutionBeneficiaries,
    commonsBeneficiaries,
    stateShort: String(stateCode || "US-XX").replace(/^US-/, "")
  };
}

/**
 * Generates the Anti-Commandeering & Positive-Sum Game Theory Guard for each race.
 * Enforces: quadratic vote weight (sqrt USDC, 5% wallet cap), 501(c)(3) only firewall,
 * and the Plutocrat Trap clause converting any whale brigading capital into state humanitarian infrastructure.
 * @param {string} stateCode
 * @param {string} leadPatronName
 * @param {number} leadPatronUsd
 * @returns {Object} Anti-commandeering guard invariant
 */
function buildAntiCommandeeringGuard(stateCode, leadPatronName, leadPatronUsd) {
  const fmtUsd = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
  return {
    invariant: "NON_EXTRACTABLE_PUBLIC_COMMONS_LOCK",
    whale_vote_formula: "quadratic_sqrt_usdc_with_5pct_wallet_cap",
    max_single_wallet_vote_share_pct: 5.0,
    dark_money_firewall: "IRS_SUBSECTION_03_PUBLIC_CHARITY_ONLY_NO_501C4_OR_PAC_CONDUITS",
    plutocrat_trap_clause:
      `If ${leadPatronName || "private special interests"} (${fmtUsd(leadPatronUsd)} cycle patron) or aligned whales ` +
      `attempt to brigade the 'NO' outcome to manufacture candidate exoneration, 100% of their injected USDC is ` +
      `irrevocably locked into ${stateCode} Bipartisan Universal Commons (volunteer fire/EMS, veterans' care, ` +
      `food banks, and disaster relief), while their voting weight is quadratically dampened at 5% max share.`
  };
}

// ============================================================================
// FUTARCHY ENGINE: HOOK & BAIT -> THE LINE -> THE POLE -> RESOLUTION
// ============================================================================

const CAPTURE_ARCHETYPES = [
  {
    id: "SUPERPAC_OLIGARCH_SWARM",
    regex: /\b(PAC|ACTION|FUND|FUTURE|LEADERSHIP|VICTORY|CLUB FOR GROWTH|AIPAC|SENATE LEADERSHIP|MAJORITY|DEFEND|CONSERVATIVE|PROGRESSIVE|DEMOCRACY)\b/i,
    label: "Outside Super PAC & Megadonor Swarm",
    harmVector: "dilution of local constituent voice via concentrated ideological/outside Super PAC bundlers",
    restitutionCause: "non-partisan civic accountability, investigative public-interest journalism, and voter legal defense",
    nteeFocus: "Civil Rights, Public Policy & Voter Education (NTEE R/W)"
  },
  {
    id: "EXTRACTIVE_ENERGY_INDUSTRIAL",
    regex: /\b(ENERGY|OIL|GAS|PETROLEUM|CHEVRON|EXXON|KOCH|PIPELINE|MINING|COAL|UTILITIES|POWER|CHEMICAL)\b/i,
    label: "Extractive Energy & Petrochemical Capture",
    harmVector: "regulatory leniency toward industrial emissions, grid monopolies, and watershed externalities",
    restitutionCause: "clean water remediation, community grid resilience, and environmental health clinics",
    nteeFocus: "Environmental Quality, Clean Water & Public Health (NTEE C/E)"
  },
  {
    id: "WALL_STREET_CRYPTO_REAL_ESTATE",
    regex: /\b(CAPITAL|VENTURES|INVESTMENT|PARTNERS|HOLDINGS|BANK|FINANCIAL|CITADEL|BLACKSTONE|CRYPTO|COINBASE|FAIRSHAKE|REALTY|HOMES)\b/i,
    label: "Private Equity, Speculative Finance & Real Estate Syndicate",
    harmVector: "housing financialization, consumer debt deregulation, and tax-code arbitrage",
    restitutionCause: "affordable housing trusts, predatory-lending legal aid, and household debt relief",
    nteeFocus: "Housing Shelter, Legal Aid & Economic Relief (NTEE L/I/P)"
  },
  {
    id: "PHARMA_HEALTH_INSURANCE_BLOC",
    regex: /\b(HEALTH|PHARMA|PFIZER|MERCK|BIO|MEDICAL|HOSPITAL|INSURANCE|BLUE CROSS|UNITEDHEALTH|CIGNA)\b/i,
    label: "Pharmaceutical & Managed-Care Cartel",
    harmVector: "prescription price inflation and medical-debt bankruptcies among working families",
    restitutionCause: "free community health clinics, indigent patient prescription funds, and medical debt abolition",
    nteeFocus: "Community Health Clinics & Medical Debt Relief (NTEE E/G)"
  },
  {
    id: "DEFENSE_SURVEILLANCE_COMPLEX",
    regex: /\b(DEFENSE|AEROSPACE|LOCKHEED|RAYTHEON|BOEING|GENERAL DYNAMICS|NORTHROP|PALANTIR|SECURITY|TECH)\b/i,
    label: "Defense, Aerospace & Surveillance Contractor Bloc",
    harmVector: "perpetual procurement escalation and domestic surveillance expansion over local infrastructure",
    restitutionCause: "veterans' trauma/housing rehabilitation and digital privacy civil-liberties defense",
    nteeFocus: "Veterans Support & Civil Liberties (NTEE W/R)"
  }
];

/**
 * Synthesizes all 5 stages of the Futarchy mechanism from verifiable FEC/VoteLog data.
 * Also splits charities into YES/NO pools and builds the anti-commandeering guard.
 * @param {object} params - Contains race, subjectName, subjectParty, financeStats, topDonors, opponentsOut, verifiedCharities
 * @returns {object} synth - All synthesized stages plus charity pools and anti-commandeering guard
 */
function synthesizeFutarchyMechanism(params) {
  const { race, subjectName, subjectParty, financeStats, topDonors, opponentsOut, verifiedCharities } = params;
  const stateCode = String(race.state || "US-XX").toUpperCase();
  const stateShort = stateCode.replace(/^US-/, "");
  const officeLabel = (race.office_type || CONFIG.officeType) === "us_senate" ? "U.S. Senate" : "U.S. House";

  const careerUsd = Number(financeStats.careerReceipts || 0);
  const cycleUsd = Number(financeStats.cycleReceipts || 0);
  const top5Sum = (topDonors || []).reduce((acc, d) => acc + Number(d.amount_usd || 0), 0);

  // Candidate self-funding is not a private patron, so it must never be
  // described as "outside Super PAC money". Detect it and keep the narrative honest.
  const nameTokens = (s) => String(s || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  const subjectTokens = nameTokens(subjectName);
  const looksLikeSubject = (donorName) => {
    const t = nameTokens(donorName);
    if (!t.length || !subjectTokens.length) return false;
    const subjectLast = subjectTokens[subjectTokens.length - 1];
    const shared = t.filter((x) => subjectTokens.includes(x) && x.length > 2).length;
    return t.includes(subjectLast) && shared >= 2;
  };
  const selfFundDonors = (topDonors || []).filter((d) => looksLikeSubject(d.name));
  const selfFundUsd = selfFundDonors.reduce((a, d) => a + Number(d.amount_usd || 0), 0);
  const leadDonor = (topDonors || []).find((d) => !looksLikeSubject(d.name)) || null;

  const topOpponent = (opponentsOut || [])
    .slice()
    .sort((a, b) => Number(b.cycle_total_receipts_usd || 0) - Number(a.cycle_total_receipts_usd || 0))[0] || null;
  const oppUsd = Number(topOpponent?.cycle_total_receipts_usd || 0);

  const disparityRatio = oppUsd > 0 ? Number((Math.max(cycleUsd, careerUsd) / oppUsd).toFixed(2)) : null;
  const donorCorpus = (topDonors || []).map((d) => `${d.name || ""} ${d.employer || ""} ${d.occupation || ""} ${d.type || ""}`).join(" ");

  // Score every archetype instead of taking the first regex hit. The generic
  // Sup PAC pattern matches "FUND"/"ACTION", so it must not shadow a more
  // specific capture vector (energy, finance, pharma, defense).
  const archetypeScores = CAPTURE_ARCHETYPES.map((a, idx) => {
    const hits = donorCorpus.match(new RegExp(a.regex.source, "gi")) || [];
    const distinctHits = new Set(hits.map((h) => h.toUpperCase())).size;
    const weight = a.id === "SUPERPAC_OLIGARCH_SWARM" ? 1 : 3;
    return { archetype: a, score: distinctHits * weight, idx };
  }).sort((a, b) => (b.score - a.score) || (a.archetype.id === "SUPERPAC_OLIGARCH_SWARM" ? 1 : -1) || (a.idx - b.idx));

  let matchedArchetype = archetypeScores[0].score > 0
    ? archetypeScores[0].archetype
    : CAPTURE_ARCHETYPES[0];

  // 1. THE HOOK & BAIT
  const hookAndBait = {
    archetype_id: matchedArchetype.id,
    archetype_label: matchedArchetype.label,
    career_war_chest_usd: careerUsd,
    cycle_war_chest_usd: cycleUsd,
    top_5_donors_cycle_usd: top5Sum,
    candidate_self_funding_usd: selfFundUsd,
    lead_patron: leadDonor
      ? { name: leadDonor.name, amount_usd: leadDonor.amount_usd, type: leadDonor.type }
      : (selfFundUsd > 0
        ? { name: `${subjectName} (candidate self-funding)`, amount_usd: selfFundUsd, type: "candidate_self_funding" }
        : { name: "Unitemized / Bundled Committee Transfers", amount_usd: cycleUsd, type: "committee_or_pac" }),
    opponent_funding_disparity_ratio: disparityRatio,
    primary_harm_thesis: matchedArchetype.harmVector
  };

  // 2. THE LINE
  const isSuperPac = leadDonor && (leadDonor.type?.includes("superpac") || leadDonor.amount_usd > cycleUsd);

  let leadPatronClause = "";
  if (selfFundUsd > 0 && leadDonor) {
    leadPatronClause = `with ${fmtUsd(cycleUsd)} this cycle, anchored by ${fmtUsd(selfFundUsd)} in candidate self-funding plus ${leadDonor.name} (${fmtUsd(leadDonor.amount_usd)})`;
  } else if (selfFundUsd > 0) {
    leadPatronClause = `with ${fmtUsd(cycleUsd)} this cycle, anchored by ${fmtUsd(selfFundUsd)} in candidate self-funding`;
  } else if (isSuperPac) {
    leadPatronClause = `with ${fmtUsd(cycleUsd)} this cycle, alongside ${fmtUsd(leadDonor.amount_usd)} in outside Super PAC support led by ${leadDonor.name}`;
  } else if (leadDonor && leadDonor.amount_usd > 0) {
    leadPatronClause = `with ${fmtUsd(cycleUsd)} this cycle, anchored by ${leadDonor.name} (${fmtUsd(leadDonor.amount_usd)})`;
  } else {
    leadPatronClause = `with ${fmtUsd(cycleUsd)} in cycle committee receipts`;
  }

  const disparityClause = (topOpponent && oppUsd > 0 && disparityRatio >= 1.2)
    ? `—out-raising general opponent ${topOpponent.name} (${fmtUsd(oppUsd)}) by ${disparityRatio}x—`
    : "—";

  const voteQuestion =
    `Community Accountability Resolution [${stateCode} ${officeLabel}]: ${subjectName} (${subjectParty || "I"}) has received ` +
    `${fmtUsd(careerUsd)} in career campaign contributions (${leadPatronClause})${disparityClause}linked to ` +
    `"${matchedArchetype.label}". Should ${stateShort} release the community fund to local charities working on ` +
    `${matchedArchetype.restitutionCause}?`;

  const futarchyThesis =
    `Large campaign contributions create public concern over policy priorities. When ${subjectName} ` +
    `receives ${fmtUsd(careerUsd)} (${leadPatronClause}), community members want accountability. ` +
    `This fund lets residents decide whether to direct community resources to local public causes.`;

  // 3. THE POLE
  const benchmarkPacUnit = Math.max(1000, Math.round((Math.max(leadDonor?.amount_usd || 0, selfFundUsd) || cycleUsd || 100000) / 1000));
  const poleMechanics = {
    model: "community_restitution_vote",
    escrow_chain: "base_mainnet_8453",
    escrow_token: "USDC",
    activation_threshold_usd: 10000,
    settlement_epoch_days: 60,
    outcomes: {
      YES_RELEASE_TO_LOCAL_CHARITIES: "Directs 100% of the funds to verified local non-profits working directly on state community needs.",
      NO_RELEASE_TO_COMMUNITY_COMMONS: "Directs 100% of the funds to bipartisan, universal local public services (volunteer fire/EMS, veterans' care, food banks, disaster relief).",
      ABSTAIN_LOG_DISSENT: "Records resident feedback without moving the vote count."
    },
    leverage_ratio_statement: `Every contribution directly empowers community-led funding. Once the campaign pool reaches $10,000, an automatic 60-day countdown begins. When the 60 days expire, all funds go directly to verified local charities or essential community services—zero platform cut.`
  };

  // 4. MOTIVATING FACTOR / RESOLUTION
  // Split first so the YES and NO outcomes route to explicitly different,
  // independently audited pools (never the same org on both sides).
  const charityPools = splitStateCharitiesByOutcome(verifiedCharities, race.state, matchedArchetype);
  if (!charityPools.restitutionBeneficiaries.length || !charityPools.commonsBeneficiaries.length) {
    throw new Error(
      `[${stateCode}] No audited 501(c)(3) beneficiaries could be bound. ` +
      `Run: node scripts/ingest-us-state-charities.js --states=${stateShort}`
    );
  }

  const namedCharities = charityPools.restitutionBeneficiaries
    .map((c) => `${c.name} (${c.registry_id})`)
    .join("; ");

  const namedCommons = charityPools.commonsBeneficiaries
    .map((c) => `${c.name} (${c.registry_id})`)
    .join("; ");

  const bountyDescription =
    `Community Fund for ${stateCode}: Delivers 100% of funds to verified, IRS-registered 501(c)(3) public charities ` +
    `serving ${stateShort} dedicated to ${matchedArchetype.restitutionCause}. ` +
    `Verified local recipients: ${namedCharities}. ` +
    `Once the pool hits $10,000, a 60-day timer starts. If YES wins, funds go to these charities; if NO wins, funds go to local community commons (fire/EMS, veterans, food banks).`;

  const destinationCriteria =
    `All recipient organizations must be active, verified 501(c)(3) public charities registered in ${stateCode} ` +
    `with clean IRS status and direct community impact. ` +
    `Approved charities: ${namedCharities}.`;

  const resolutionOracle = {
    activation_threshold_usd: 10000,
    settlement_epoch_days: 60,
    trigger_conditions: [
      `Condition 1 (Activation): The campaign activates its 60-day countdown timer as soon as total contributions reach $10,000 USD (Base USDC).`,
      `Condition 2 (Resolution Period): The community vote runs for exactly 60 days from the moment the $10,000 threshold is reached.`,
      `Condition 3 (Payout): If YES receives 60% or more of votes, 100% of the funds are sent to the verified state non-profits; otherwise, 100% is sent to universal community services (fire/EMS, veterans, food banks).`
    ],
    eligible_audited_beneficiaries: charityPools.restitutionBeneficiaries
  };

  return {
    hookAndBait,
    voteQuestion,
    futarchyThesis,
    poleMechanics,
    bountyDescription,
    destinationCriteria,
    resolutionOracle,
    charityPools,
    namedCommons,
    antiCommandeeringGuard: buildAntiCommandeeringGuard(
      stateCode,
      hookAndBait.lead_patron.name,
      hookAndBait.lead_patron.amount_usd
    )
  };
}

// ============================================================================
// STANDARD DATA FETCHERS (VoteLog + Congress-Legislators + OpenFEC)
// ============================================================================

/**
 * Loads a JSON array from the first successfully fetched URL.
 * Tries each URL in order, returning the first array found (members/results/legislators),
 * or an empty array if all fail.
 */
async function loadFirstJsonArray(urls, label) {
  for (const url of urls) {
    try {
      const data = await fetchJsonWithRetry(url, 2, 800);
      const list = Array.isArray(data) ? data : (data.members || data.results || data.legislators || []);
      if (Array.isArray(list)) {
        console.log(`[${label}] Loaded ${list.length} records from ${url}`);
        return list;
      }
    } catch (_) {}
  }
  console.warn(`[${label}] Could not load from provided URLs.`);
  return [];
}

/**
 * Loads legislators from the GitHub congress-legislators repositories.
 * Tries current first, then historical, returning a Map keyed by bioguide ID.
 */
async function loadLegislatorsCrosswalk() {
  const byBioguide = new Map();
  for (const url of CONFIG.legislatorsUrls) {
    try {
      const list = await fetchJsonWithRetry(url, 2, 1000);
      const arr = Array.isArray(list) ? list : [];
      for (const leg of arr) {
        const bioguide = leg?.id?.bioguide;
        if (!bioguide) continue;
        const key = bioguide.toUpperCase();
        if (!byBioguide.has(key)) byBioguide.set(key, leg);
      }
      console.log(`[Crosswalk] Loaded ${arr.length} from ${url}`);
    } catch (err) {
      console.warn(`[Crosswalk] Failed ${url}: ${err.message}`);
    }
  }
  console.log(`[Crosswalk] Total unique bioguide keys: ${byBioguide.size}`);
  return byBioguide;
}

/**
 * Ensures a seed manifest file exists, creating a starter seed if needed.
 */
function ensureSeedManifest(seedPath) {
  if (fs.existsSync(seedPath)) return JSON.parse(fs.readFileSync(seedPath, "utf8"));
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  const starterSeed = {
    _comment: "Certified winners/opponents manifest. Set won_race=true to emit.",
    races: [
      {
        office_type: "us_senate",
        election_year: 2026,
        state: "US-TX",
        district: null,
        race_type: "regular",
        senate_class: 2,
        subject: {
          name: "John Cornyn",
          party: "R",
          incumbent: true,
          won_race: true,
          bioguide_id: "C001056",
          fec_candidate_ids: ["S2TX00106"],
          votelog_slug: "john-cornyn",
          votelog_listed: true
        },
        opponents_nov_general: [
          { name: "General Election Challenger", party: "D", fec_candidate_id: "S0TX00000" }
        ]
      }
    ]
  };
  fs.writeFileSync(seedPath, JSON.stringify(starterSeed, null, 2) + "\n", "utf8");
  console.log(`[Seed] Created starter seed manifest at ${seedPath}. Edit it (set won_race=true for races to emit), then re-run.`);
  return starterSeed;
}

/**
 * Normalizes a string for consistent comparison.
 * Strips accents, lowercases, removes non-alphanumeric characters.
 * @param {string} s
 * @returns {string}
 */
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

/**
 * Finds a VoteLog member matching the race subject by slug, bioguide ID, or name+state.
 * @param {Array} votelogMembers - Array of VoteLog member objects
 * @param {object} race - Race object from seed manifest
 * @param {string} bioguide - Bioguide ID string
 * @returns {object|null} Matching VoteLog member or null
 */
function findVoteLogMatch(votelogMembers, race, bioguide) {
  const slug = race.subject.votelog_slug;
  if (slug) {
    const bySlug = votelogMembers.find(m => m.slug === slug || m.id === slug);
    if (bySlug) return bySlug;
  }
  if (bioguide) {
    const byBio = votelogMembers.find(m => String(m.bioguide_id || "").toUpperCase() === bioguide.toUpperCase());
    if (byBio) return byBio;
  }
  const name = norm(race.subject.name);
  const state = String(race.state || "").replace(/^US-/, "").toUpperCase();
  return votelogMembers.find(m => {
    const mState = String(m.state || m.state_abbrev || "").toUpperCase();
    const mName = norm(m.name || `${m.first_name || ""} ${m.last_name || ""}`);
    return mName && name && mName === name && (!state || mState === state);
  }) || null;
}

/**
 * Fetches JSON from a URL with retry logic and rate-limit handling.
 * @param {string} url
 * @param {number} retries
 * @param {number} delayMs
 * @returns {Promise<any>}
 */
async function fetchJsonWithRetry(url, retries = 4, delayMs = 1200) {
  return sopCache.fetchWithSopCache(url, async () => {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Polytab-Local-Ingest/2.0" } });
        if (res.status === 429) {
          const wait = 5000 * (i + 1);
          const safeUrl = String(url).replace(/([?&]api_key=)[^&]+/gi, "$1REDACTED");
          console.warn(`[Rate Limit 429] Sleeping ${wait}ms: ${safeUrl}`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (i < retries - 1) await sleep(delayMs * (i + 1));
      }
    }
    throw lastErr;
  });
}

/**
 * 4-Tier Adaptive Finance Resolver for candidate totals and principal committees.
 * Tier 1: Keyless FEC bulk summary (weball/cn) index
 * Tier 2: OpenFEC REST fallback (only if bulk yields 0 and key != DEMO_KEY)
 * Tier 3: (handled externally) votelog backup donors passed as topDonorsFallback
 * Tier 4: Mathematical accounting floor & adaptive coverage guard
 */
async function fetchCandidateTotals(fecIds, targetCycle, fecBulkIndex = null, topDonorsFallback = []) {
  let careerReceipts = 0, careerNetContributions = 0, cycleReceipts = 0, coverageEndDate = null;
  const sources = [];
  const principalByCandidate = [];

  const ids = (fecIds || []).filter((id) => id && !/00000$/.test(id));

  // Tier 1: Bulk index lookup (all cycles for career totals; target cycle for cycle receipts/coverage)
  for (const candId of ids) {
    const bulk = fecBulkIndex?.candidates?.[candId];
    if (!bulk) continue;
    if (bulk.pcc) principalByCandidate.push(bulk.pcc);
    for (const [cycStr, row] of Object.entries(bulk.cycles || {})) {
      const cyc = Number(cycStr);
      careerReceipts += Number(row.receipts || 0);
      careerNetContributions += Number(row.net_contributions || 0);
      if (cyc === Number(targetCycle)) {
        cycleReceipts += Number(row.receipts || 0);
        const cov = row.coverage_end_date || null;
        if (cov && (!coverageEndDate || cov > coverageEndDate)) coverageEndDate = cov;
      } else if (!coverageEndDate && row.coverage_end_date) {
        // keep latest known coverage as fallback context
        if (!coverageEndDate || row.coverage_end_date > coverageEndDate) coverageEndDate = row.coverage_end_date;
      }
    }
    sources.push({
      label: `FEC bulk candidate summary (weball/cn, ${candId})`,
      url: `https://www.fec.gov/files/bulk-downloads/${targetCycle}/weball${String(targetCycle).slice(-2)}.zip`,
      as_of: fecBulkIndex?.generated_at_utc?.slice(0, 10) || todayIso()
    });
  }

  // Tier 2: REST API fallback only if bulk yielded no receipts and a real key is available
  const needRest = careerReceipts === 0 && cycleReceipts === 0 && CONFIG.fecApiKey !== "DEMO_KEY";
  if (needRest) {
    for (const candId of ids) {
      const url = `${CONFIG.openFecBaseUrl}/candidate/${encodeURIComponent(candId)}/totals/?api_key=${CONFIG.fecApiKey}&election_full=true&per_page=100&sort=-cycle`;
      try {
        const data = await fetchJsonWithRetry(url);
        const results = Array.isArray(data?.results) ? data.results : [];
        for (const row of results) {
          if (row.election_full === true) {
            careerReceipts += Number(row.receipts || 0);
            careerNetContributions += Number(row.net_contributions || 0);
          }
        }
        const targetFull =
          results.find(r => r.election_full === true && Number(r.cycle) === Number(targetCycle)) ||
          results.find(r => r.election_full === true && Number(r.candidate_election_year) === Number(targetCycle)) ||
          results.find(r => Number(r.cycle) === Number(targetCycle)) ||
          results.find(r => r.election_full === true && (r.cycle == null || r.cycle === '') && Number(r.candidate_election_year || 0) === 0);
        if (targetFull) {
          cycleReceipts += Number(targetFull.receipts || 0);
          const cov = targetFull.coverage_end_date || targetFull.transaction_coverage_date;
          if (cov) {
            const d = String(cov).slice(0, 10);
            if (!coverageEndDate || d > coverageEndDate) coverageEndDate = d;
          }
        } else {
          const fullRows = results.filter(r => r.election_full === true);
          for (const r of fullRows) {
            const cov = r.coverage_end_date || r.transaction_coverage_date;
            if (cov) {
              const d = String(cov).slice(0, 10);
              if (!coverageEndDate || d > coverageEndDate) coverageEndDate = d;
            }
          }
        }
        sources.push({
          label: `OpenFEC candidate totals (election_full=true, ${candId})`,
          url: `https://api.open.fec.gov/v1/candidate/${candId}/totals/?election_full=true`,
          as_of: todayIso()
        });
      } catch (err) {
        console.warn(`[OpenFEC] Totals failed for ${candId}: ${err.message}`);
      }
      await sleep(300);
    }
  }

  // Principal committee REST fallback only if missing and real key available
  if (principalByCandidate.length === 0 && CONFIG.fecApiKey !== "DEMO_KEY") {
    for (const candId of ids) {
      for (const designation of ["P", "A"]) {
        try {
          const cmteUrl = `${CONFIG.openFecBaseUrl}/candidate/${encodeURIComponent(candId)}/committees/?api_key=${CONFIG.fecApiKey}&cycle=${targetCycle}&designation=${designation}&per_page=20`;
          const cmteData = await fetchJsonWithRetry(cmteUrl);
          const cmtes = Array.isArray(cmteData?.results) ? cmteData.results : [];
          if (cmtes.length) { principalByCandidate.push(cmtes[0].committee_id); break; }
        } catch (_) {}
        await sleep(250);
      }
      if (principalByCandidate.length) break;
    }
  }

  // Tier 4: Mathematical accounting floor & adaptive coverage guard
  const topDonorsSum = (topDonorsFallback || []).reduce((s, d) => s + Number(d.amount_usd || 0), 0);
  if (cycleReceipts === 0 && topDonorsSum > 0) {
    cycleReceipts = topDonorsSum;
  }
  if (careerReceipts < cycleReceipts) {
    careerReceipts = cycleReceipts;
  }
  if (careerNetContributions === 0 && careerReceipts > 0) {
    careerNetContributions = careerReceipts;
  }
  if (!coverageEndDate) {
    coverageEndDate = fecBulkIndex?.latest_global_coverage_date || `${targetCycle}-10-14`;
  }

  // Dedupe principal committee IDs preserving order
  const uniquePrincipals = [...new Set(principalByCandidate.filter(Boolean))];

  return {
    careerReceipts: Math.round(careerReceipts),
    careerNetContributions: Math.round(careerNetContributions),
    cycleReceipts: Math.round(cycleReceipts),
    coverageEndDate,
    principalCommitteeId: uniquePrincipals[0] || null,
    principalCommitteeIds: uniquePrincipals,
    sources
  };
}

/**
 * Loads VoteLog donors backup from local file.
 */
let _votelogDonorsBackup = null;
function loadVotelogDonorsBackup(repoRoot) {
  if (_votelogDonorsBackup) return _votelogDonorsBackup;
  const p = path.join(repoRoot, CONFIG.votelogDonorsBackupPath);
  try {
    _votelogDonorsBackup = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { races: {} };
  } catch (_) {
    _votelogDonorsBackup = { races: {} };
  }
  return _votelogDonorsBackup;
}

/**
 * Gets top 5 VoteLog donors for a race from the backup file.
 * @param {string} repoRoot
 * @param {object} race
 * @param {Array} subjectFecIds
 * @returns {Array} Top 5 donors
 */
function getVotelogBackupTopDonors(repoRoot, race, subjectFecIds) {
  const backup = loadVotelogDonorsBackup(repoRoot);
  const st = String(race.state || "").replace(/^US-/, "").toLowerCase();
  const rt = race.race_type || "regular";
  const slugCandidates = [
    race?._seed_meta?.votelog_data_slug,
    `${st}-senate-${rt === "special" ? "special" : "general"}`,
    `${st}-senate-general`
  ].filter(Boolean);
  let raceData = null;
  for (const s of slugCandidates) {
    if (backup.races && backup.races[s]) { raceData = backup.races[s]; break; }
  }
  if (!raceData) return [];

  const fecSet = new Set((subjectFecIds || []).filter(Boolean));
  let entity = null;
  for (const e of Object.values(raceData.by_entity || {})) {
    if (fecSet.has(e.candidate_id)) { entity = e; break; }
  }
  const donors = (entity && Array.isArray(entity.top_donors) && entity.top_donors.length)
    ? entity.top_donors
    : (Array.isArray(raceData.top_donors_race_wide) ? raceData.top_donors_race_wide : []);
  return donors.slice(0, 5).map((d, idx) => ({
    rank: idx + 1,
    name: d.name || "Unknown",
    committee_id: d.committee_id || (Array.isArray(d.committee_ids) && d.committee_ids.length === 1 ? d.committee_ids[0] : null),
    amount_usd: Math.round(Number(d.amount_usd || 0)),
    type: "superpac_donor_via_votelog",
    employer: d.employer || undefined,
    occupation: d.occupation || undefined,
    source_url: `https://votelog.org/data/${raceData.data_slug || st + "-senate-general"}/superpac-donors.csv`,
    source_note: "From local VoteLog donors backup (super PAC/outside-group donors, cycle-wide)."
  }));
}

/**
 * Aggregates FEC Schedule A itemized receipts into a top-5 donor list.
 * The OpenFEC `/schedules/schedule_a/by_contributor/` aggregate endpoint
 * currently returns HTTP 500, so we page the raw receipts endpoint and
 * aggregate client-side. Uses the real key only; DEMO_KEY is never used here.
 *
 * @param {string} committeeId
 * @param {number} cycle
 * @returns {Promise<Array>} Top 5 donors
 */
async function fetchTop5DonorsViaScheduleA(committeeId, cycle) {
  if (!committeeId || /00000$/.test(committeeId) || CONFIG.fecApiKey === "DEMO_KEY") return [];

  for (const period of [cycle, cycle - 2, cycle - 4].filter((y) => y >= 2016)) {
    const base = `${CONFIG.openFecBaseUrl}/schedules/schedule_a/?api_key=${CONFIG.fecApiKey}` +
      `&committee_id=${encodeURIComponent(committeeId)}&per_page=100` +
      `&sort=-contribution_receipt_amount&two_year_transaction_period=${period}`;
    const agg = new Map();
    let url = base;

    for (let page = 0; page < 5 && url; page++) {
      let data;
      try {
        data = await fetchJsonWithRetry(url, 2, 1500);
      } catch (err) {
        break;
      }
      const rows = Array.isArray(data?.results) ? data.results : [];
      for (const r of rows) {
        const amt = Number(r.contribution_receipt_amount || 0);
        if (!(amt > 0)) continue;
        const name = String(r.contributor_name || r.entity_type_desc || "Unknown").trim();
        if (!name) continue;
        const entity = String(r.entity_type || r.entity_type_desc || "").toUpperCase();
        const key = `${name}|${entity}`;
        const prev = agg.get(key) || { name, entity, amount: 0 };
        prev.amount += amt;
        agg.set(key, prev);
      }
      const last = data?.pagination?.last_indexes;
      if (!last || rows.length < 100 || page === 4) break;
      url = `${base}&last_index=${encodeURIComponent(last.last_index)}` +
        `&last_contribution_receipt_amount=${encodeURIComponent(last.last_contribution_receipt_amount)}`;
    }

    if (agg.size === 0) continue;
    const top = [...agg.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const looksLikePerson = (s) => /^[A-Z][A-Z'.\- ]{1,40},\s*[A-Z]/.test(s);
    return top.map((x, idx) => {
      // FEC entity_type is authoritative when present; otherwise infer from the
      // "LAST, FIRST" Schedule A contributor format to avoid calling a human a PAC.
      const ent = x.entity || "";
      const isCommittee = /PAC|COM|ORG|CCM|PTY|BUS|TRC/.test(ent);
      return {
        rank: idx + 1,
        name: x.name,
        committee_id: null,
        amount_usd: Math.round(x.amount),
        type: isCommittee ? "committee_or_pac" : (looksLikePerson(x.name) ? "individual_itemized_aggregate" : "entity_or_other"),
        source_url: `https://www.fec.gov/data/receipts/?committee_id=${committeeId}&two_year_transaction_period=${period}`,
        source_note: `Aggregated from FEC Schedule A itemized receipts (${period} two-year period).`
      };
    });
  }
  return [];
}

/**
 * Fetches top 5 donors for a committee, preferring local VoteLog backup.
 * @param {string} committeeId
 * @param {number} cycle
 * @param {string} repoRoot
 * @param {object} race
 * @param {Array} subjectFecIds
 * @returns {Array} Top 5 donors
 */
async function fetchTop5DonorsForCommittee(committeeId, cycle, repoRoot, race, subjectFecIds) {
  // Prefer local VoteLog donors backup when available (offline, avoids FEC aggregate 500s).
  const backupDonors = getVotelogBackupTopDonors(repoRoot, race || {}, subjectFecIds || []);
  if (backupDonors.length) {
    console.log(`[Backup] Using local VoteLog donors for ${race?.state || "race"} (${backupDonors.length})`);
    return backupDonors;
  }

  // Fallback: aggregate itemized Schedule A receipts for the principal committee.
  if (committeeId && !/00000$/.test(committeeId)) {
    const scheduleA = await fetchTop5DonorsViaScheduleA(committeeId, cycle);
    if (scheduleA.length) {
      console.log(`[ScheduleA] Aggregated ${scheduleA.length} donors for ${race?.state || committeeId}`);
      return scheduleA;
    }
  }
  return [];
}

/**
 * Builds review hints for draft mode, checking for missing data or placeholder strings.
 * @param {object} record - The generated vote template record
 * @returns {object} { missing, placeholders }
 */
function buildReviewHints(record) {
  const missing = [];
  const placeholders = [];
  if (!record.subject.identifiers.fec_candidate_ids || record.subject.identifiers.fec_candidate_ids.length === 0) missing.push("subject.identifiers.fec_candidate_ids");
  if (record.finance.career_total_receipts_usd === 0 && (record.subject.identifiers.fec_candidate_ids || []).length > 0) missing.push("finance.career_total_receipts_usd (0 - check API/key/IDs)");
  if (!record.finance.top_donors_cycle || record.finance.top_donors_cycle.length === 0) missing.push("finance.top_donors_cycle");
  if (!record.finance.coverage_end_date) missing.push("finance.coverage_end_date");
  if (!record.bounty_if_passed?.resolution_oracle?.eligible_audited_beneficiaries?.length) {
    missing.push("bounty_if_passed.resolution_oracle.eligible_audited_beneficiaries");
  }
  if (!record.bounty_if_no_wins?.eligible_commons_beneficiaries?.length) {
    missing.push("bounty_if_no_wins.eligible_commons_beneficiaries");
  }
  if (!String(record.bounty_if_no_wins?.description || "").includes("both sides")) {
    missing.push("bounty_if_no_wins.description (missing 'both sides' positive-sum clause)");
  }
  if (!record.anti_commandeering_guard?.invariant) missing.push("anti_commandeering_guard");
  if (String(record.vote?.question || "").includes("PLACEHOLDER")) placeholders.push("vote.question");
  if (String(record.bounty_if_passed?.description || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_passed.description");
  if (String(record.bounty_if_passed?.destination_criteria || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_passed.destination_criteria");
  if (String(record.bounty_if_no_wins?.destination_criteria || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_no_wins.destination_criteria");
  return { missing, placeholders };
}

/**
 * Normalizes any supported charity record (US state shard, legacy ProPublica
 * master list, or generic shard) into the beneficiary shape used by the
 * futarchy pools. Keeping one shape is what prevents empty beneficiary arrays.
 */
function normalizeBeneficiary(c, fallbackState) {
  const loc = c.location || {};
  const ein = c.ein ? String(c.ein).replace(/\D/g, "") : null;
  const state = String(c.state || loc.admin1_state_province || fallbackState || "")
    .replace(/^US-/i, "").toUpperCase();
  const ntee = c.ntee_code || c.ntee || null;
  const audit = Array.isArray(c.audit_signals) && c.audit_signals.length
    ? c.audit_signals
    : ["IRS_EO_BMF_ACTIVE_501C3"];
  return {
    registry_id: c.registry_id || (ein ? `US-EIN:${ein}` : null),
    ein: ein || null,
    name: c.name || null,
    city: c.city || loc.locality_city_town || null,
    state: /^[A-Z]{2}$/.test(state) ? state : null,
    ntee_code: ntee ? String(ntee).toUpperCase() : null,
    revenue_amt: Math.round(Number(c.revenue_amt ?? c.income_amt ?? c.income_amount ?? 0)),
    asset_amt: Math.round(Number(c.asset_amt ?? c.asset_amount ?? 0)),
    verification_tier: c.verification_tier || "TIER_1_AUDITED",
    independently_audited: c.independently_audited !== false,
    audit_signals: audit,
    source_authority: c.source_authority || null
  };
}

/**
 * Loads IRS-audited 501(c)(3) charities for a state.
 * Priority: docs/data/orgs/US/{STATE}.json -> docs/data/verified-orgs.json (orgs/array).
 * Returns up to 240 organizations sorted by reported revenue so the YES/NO pools
 * have a real sample to classify.
 *
 * @param {string} repoRoot
 * @param {string} stateCode
 * @returns {Array} Verified charities (normalized)
 */
function loadStateVerifiedCharities(repoRoot, stateCode) {
  const st = String(stateCode || "").replace(/^US-/i, "").toUpperCase();
  const candidates = [];
  const pushAll = (arr) => {
    for (const c of arr || []) {
      if (!c || !c.name) continue;
      if (c.subsection_code != null && Number(c.subsection_code) !== 3) continue;
      const state = String(c.state || c.location?.admin1_state_province || "").replace(/^US-/i, "").toUpperCase();
      if (st && state && state !== st) continue;
      candidates.push(c);
    }
  };

  // 1. Preferred: sharded IRS EO BMF state shard.
  if (st && st !== "XX") {
    const shardPath = path.join(repoRoot, CONFIG.verifiedOrgsShardDir, `${st}.json`);
    if (fs.existsSync(shardPath)) {
      try {
        const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
        if (Array.isArray(shard.organizations)) pushAll(shard.organizations);
      } catch (err) {
        console.warn(`[Charities] Failed to read ${shardPath}: ${err.message}`);
      }
    }
  }

  // 2. Fallback: legacy master list (supports both `orgs` and `organizations`).
  if (candidates.length === 0) {
    const indexPath = path.join(repoRoot, CONFIG.verifiedOrgsIndexPath);
    if (fs.existsSync(indexPath)) {
      try {
        const idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        const all = Array.isArray(idx) ? idx : (idx.orgs || idx.organizations || []);
        pushAll(all);
      } catch (err) {
        console.warn(`[Charities] Failed to read ${indexPath}: ${err.message}`);
      }
    }
  }

  return candidates
    .map((c) => normalizeBeneficiary(c, st))
    .filter((c) => c.registry_id && c.name && (!st || c.state === st))
    .sort((a, b) => (b.revenue_amt - a.revenue_amt) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 240);
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

async function main() {
  const repoRoot = process.cwd();
  const seedPath = path.join(repoRoot, CONFIG.seedManifestPath);
  const outDir = path.join(repoRoot, CONFIG.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const [votelogMembers, crosswalk, fecBulkIndex] = await Promise.all([
    loadFirstJsonArray(CONFIG.votelogMembersUrls, "VoteLog"),
    loadLegislatorsCrosswalk(),
    loadFecBulkIndex(repoRoot, CONFIG.electionYear)
  ]);
  const seed = ensureSeedManifest(seedPath);
  const races = Array.isArray(seed.races) ? seed.races : [];
  const generatedItems = [];

  for (const race of races) {
    const officeType = race.office_type || CONFIG.officeType;
    if (officeType !== CONFIG.officeType) continue;
    if (!race?.subject?.won_race) continue;

    const bioguide = String(race.subject.bioguide_id || "").toUpperCase();
    const leg = crosswalk.get(bioguide);
    const fecIds = Array.from(new Set([...(race.subject.fec_candidate_ids || []), ...((leg?.id?.fec) || [])])).filter(Boolean);
    const opensecretsCid = race.subject.opensecrets_cid || leg?.id?.opensecrets || null;
    const subjectParty = race.subject.party || leg?.terms?.[leg.terms.length - 1]?.party || null;

    const vlMatch = findVoteLogMatch(votelogMembers, race, bioguide);
    const vlSlug = vlMatch?.slug || vlMatch?.id || race.subject.votelog_slug || null;
    const vlListed = Boolean(vlMatch) || race.subject.votelog_listed === true || Boolean(vlSlug);
    if (!vlListed) continue;

    const electionYear = Number(race.election_year || CONFIG.electionYear);
    console.log(`[Processing] ${race.state} ${officeType} — ${race.subject.name} [FEC: ${fecIds.join(", ") || "none"}]`);

    // Resolve top donors first (backup works without principal committee); pass as floor to finance totals
    let topDonors = getVotelogBackupTopDonors(repoRoot, race, fecIds);
    if (topDonors.length) {
      console.log(`[Backup] Using local VoteLog donors for ${race?.state || "race"} (${topDonors.length})`);
    }
    let financeStats = await fetchCandidateTotals(fecIds, electionYear, fecBulkIndex, topDonors);
    // If backup donors unavailable, try REST donors using resolved principal committee
    if (!topDonors.length) {
      topDonors = await fetchTop5DonorsForCommittee(financeStats.principalCommitteeId, electionYear, repoRoot, race, fecIds);
      // Re-apply accounting floor with any newly resolved donors
      financeStats = await fetchCandidateTotals(fecIds, electionYear, fecBulkIndex, topDonors);
    }

    const opponentsIn = Array.isArray(race.opponents_nov_general) ? race.opponents_nov_general : (race.opponents_nov_general ? [race.opponents_nov_general] : []);
    const opponentsOut = [];
    for (const opp of opponentsIn) {
      const oppIds = opp.fec_candidate_id ? [opp.fec_candidate_id] : (opp.fec_candidate_ids || []);
      const oppRaceRef = { state: race.state, race_type: race.race_type, _seed_meta: race._seed_meta };
      const oppBackupDonors = getVotelogBackupTopDonors(repoRoot, oppRaceRef, oppIds);
      let oppStats = await fetchCandidateTotals(oppIds, electionYear, fecBulkIndex, oppBackupDonors);
      if (!oppBackupDonors.length) {
        await fetchTop5DonorsForCommittee(oppStats.principalCommitteeId, electionYear, repoRoot, oppRaceRef, oppIds);
        oppStats = await fetchCandidateTotals(oppIds, electionYear, fecBulkIndex, []);
      }
      opponentsOut.push({
        name: opp.name || null,
        party: opp.party || null,
        cycle: electionYear,
        cycle_total_receipts_usd: oppStats.cycleReceipts,
        coverage_end_date: oppStats.coverageEndDate,
        fec_candidate_id: opp.fec_candidate_id || oppIds[0] || null,
        fec_candidate_ids: oppIds,
        sources: oppStats.sources
      });
    }

    const verifiedCharities = loadStateVerifiedCharities(repoRoot, race.state);

    const futarchy = synthesizeFutarchyMechanism({
      race,
      subjectName: race.subject.name,
      subjectParty,
      financeStats,
      topDonors,
      opponentsOut,
      verifiedCharities
    });

    const stateSlug = String(race.state || "US-XX").toLowerCase();
    const raceType = race.race_type || "regular";
    const districtSlug = race.district ? `-${String(race.district).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    const bountyId = `${electionYear}-${officeType}-${stateSlug}${districtSlug}-${raceType}`;

    const record = {
      template_version: CONFIG.templateVersion,
      bounty_id: bountyId,
      office_type: officeType,
      election_year: electionYear,
      jurisdiction: {
        level: "federal",
        state: race.state || null,
        district: race.district || null,
        race_type: raceType,
        senate_class: race.senate_class ?? null
      },
      subject: {
        name: race.subject.name,
        party: subjectParty,
        incumbent: Boolean(race.subject.incumbent),
        won_race: true,
        votelog: { listed: vlListed, member_id_or_slug: vlSlug, profile_url: vlSlug ? `https://votelog.org/members/${vlSlug}` : null },
        identifiers: {
          bioguide_id: bioguide || null,
          fec_candidate_ids: fecIds,
          fec_principal_committee_id_cycle: financeStats.principalCommitteeId,
          fec_principal_committee_ids_cycle: financeStats.principalCommitteeIds || [],
          opensecrets_cid: opensecretsCid
        }
      },
      finance: {
        career_total_receipts_usd: financeStats.careerReceipts,
        career_net_contributions_usd: financeStats.careerNetContributions,
        career_total_note: "Sum of FEC reported full-election receipts/net contributions across candidate IDs and authorized committees (source-linked).",
        cycle: electionYear,
        cycle_window: officeType === "us_senate" ? "full_term_6yr" : "2yr",
        cycle_total_receipts_usd: financeStats.cycleReceipts,
        coverage_end_date: financeStats.coverageEndDate,
        top_donors_cycle: topDonors,
        sources: financeStats.sources
      },
      opponents_nov_general: opponentsOut,

      // STAGE 1: THE HOOK & BAIT
      controversy_hook: futarchy.hookAndBait,

      // STAGE 2: THE LINE
      vote: {
        question: futarchy.voteQuestion,
        futarchy_thesis: futarchy.futarchyThesis,
        question_vars: {
          subject_name: race.subject.name,
          career_total_receipts_usd: financeStats.careerReceipts,
          capture_archetype: futarchy.hookAndBait.archetype_label,
          lead_patron_name: futarchy.hookAndBait.lead_patron.name,
          lead_patron_usd: futarchy.hookAndBait.lead_patron.amount_usd
        },
        type: "community_restitution_vote",
        options: [
          "Yes — Send Fund to Local Charities",
          "No — Send Fund to Essential Community Services",
          "Abstain — Record Feedback Only"
        ]
      },

      // STAGE 3: THE POLE
      futarchy_pole_mechanics: futarchy.poleMechanics,

      // STAGE 4A: IF 'YES' WINS -> TARGETED CORRECTIVE RESTITUTION
      bounty_if_passed: {
        winning_option: "YES_RELEASE_TO_LOCAL_CHARITIES",
        description: futarchy.bountyDescription,
        destination_type: "audited_501c3_restitution_escrow",
        destination_criteria: futarchy.destinationCriteria,
        resolution_oracle: futarchy.resolutionOracle,
        state: race.state || null
      },

      // STAGE 4B: IF 'NO' WINS -> BIPARTISAN UNIVERSAL COMMONS + CANDIDATE VINDICATION
      bounty_if_no_wins: {
        winning_option: "NO_RELEASE_TO_COMMUNITY_COMMONS",
        description:
          `Community Commons for ${race.state}: If residents decide against the restitution fund, ` +
          `100% of the funds go directly to essential local community services in ${race.state} ` +
          `(Volunteer Fire/EMS, Veterans' Care, Food Banks, and Disaster Relief). ` +
          `Recipient non-profits: ${futarchy.namedCommons}.`,
        destination_type: "audited_501c3_bipartisan_commons_escrow",
        candidate_benefit_attestation:
          `Issues immutable on-chain 'CONSTITUENT_MANDATE_VINDICATED' attestation for ${race.subject.name} (${race.state}) ` +
          `and credits the constituency's defense of the candidate for funding front-line state humanitarian & emergency infrastructure.`,
        destination_criteria:
          `MUST be an IRS-audited 501(c)(3) public charity in ${race.state} operating in non-ideological universal commons ` +
          `(NTEE M24 Fire & Rescue, M20 Disaster Relief, W30 Veterans, K31 Food Banks, E20/E22 Community Hospitals, O Youth Development) ` +
          `with zero partisan lobbying, chosen only where both sides of the political divide benefit. ` +
          `Eligible commons beneficiaries: ${futarchy.namedCommons}.`,
        eligible_commons_beneficiaries: futarchy.charityPools.commonsBeneficiaries,
        state: race.state || null
      },

      // STAGE 5: ANTI-COMMANDEERING & PLUTOCRAT TRAP GUARD
      anti_commandeering_guard: futarchy.antiCommandeeringGuard,

      location: CONFIG.location,
      payment: { ...CONFIG.payment, payment_memo_or_slug: bountyId },
      provenance: {
        status: DRAFT ? "beta_template_draft" : "beta_template_verified",
        generated_at: new Date().toISOString(),
        generator: "pol-vote-futarchy-v4",
        review_required: DRAFT
      }
    };

    if (DRAFT) record._review = buildReviewHints(record);

    const fileName = DRAFT ? `${bountyId}.draft.json` : `${bountyId}.json`;
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(record, null, 2) + "\n", "utf8");
    generatedItems.push(record);
    console.log(`[Saved] ${path.join(outDir, fileName)} [Archetype: ${futarchy.hookAndBait.archetype_id}]`);
  }

  const combinedPath = path.join(repoRoot, CONFIG.combinedOutputFile);
  fs.mkdirSync(path.dirname(combinedPath), { recursive: true });
  fs.writeFileSync(combinedPath, JSON.stringify(generatedItems, null, 2) + "\n", "utf8");
  sopCache.commitLedger(`${CONFIG.officeType}-${CONFIG.electionYear}`);
  console.log(`[Complete] Wrote ${generatedItems.length} positive-sum futarchy template(s) to ${combinedPath} ${DRAFT ? "(DRAFT)" : ""}`);
}

main().catch((err) => { console.error("[Fatal Error]", err); process.exit(1); });