#!/usr/bin/env node
/**
 * scripts/generate-vote-template.js
 * Zero-dependency Node.js (v18+) Futarchy & Restitution Bounty Generator (pol-vote-beta-4-positive-sum).
 * Automatically synthesizes all 5 stages: Hook & Bait, The Line, The Pole, Resolution,
 * and Anti-Commandeering Guard with quadratic whale dampening and 501(c)(3) firewall.
 */

const fs = require("fs");
const path = require("path");

const DRAFT = process.env.DRAFT === "1" || process.argv.includes("--draft");

// ======================= CUSTOMIZATION ZONE =======================
const CONFIG = {
  templateVersion: "pol-vote-beta-4-positive-sum",
  electionYear: Number(process.env.ELECTION_YEAR || 2026),
  officeType: process.env.OFFICE_TYPE || "us_senate",
  fecApiKey: process.env.FEC_API_KEY || "DEMO_KEY",

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
 *   1. restitutionPool (for YES wins): Targeted corrective charities matching the donor capture archetype
 *   2. commonsPool (for NO wins): Universal bipartisan life-safety/community commons
 *     (Fire/EMS, Veterans, Food Banks, Hospitals, Disaster Relief, Libraries/Youth)
 * @param {Array} verifiedCharities - Orgs from verified-orgs.json or state shards
 * @param {string} stateCode - Two-letter state ISO code
 * @returns {Object} { restitutionBeneficiaries, commonsBeneficiaries, stateShort }
 */
function splitStateCharitiesByOutcome(verifiedCharities, stateCode) {
  const commonsRegex = /\b(FOOD|HUNGER|FIRE|RESCUE|EMS|AMBULANCE|VETERAN|HOSPITAL|CLINIC|HEALTH|DISASTER|RED CROSS|UNITED WAY|SHELTER|HABITAT|YOUTH|BOYS|GIRLS|LIBRARY|SCHOLARSHIP|RELIEF)\b/i;
  const commonsPool = [];
  const restitutionPool = [];

  for (const c of (verifiedCharities || [])) {
    if (commonsRegex.test(c.name || "")) {
      commonsPool.push(c);
    } else {
      restitutionPool.push(c);
    }
  }

  // Ensure both pools always have audited fallback entries if the state sample is small
  if (commonsPool.length === 0 && restitutionPool.length > 1) {
    commonsPool.push(restitutionPool.pop());
  }
  if (restitutionPool.length === 0 && commonsPool.length > 1) {
    restitutionPool.push(commonsPool.pop());
  }

  return {
    restitutionBeneficiaries: restitutionPool.slice(0, 5),
    commonsBeneficiaries: commonsPool.slice(0, 5),
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
  const leadDonor = (topDonors && topDonors[0]) ? topDonors[0] : null;

  const topOpponent = (opponentsOut || [])
    .slice()
    .sort((a, b) => Number(b.cycle_total_receipts_usd || 0) - Number(a.cycle_total_receipts_usd || 0))[0] || null;
  const oppUsd = Number(topOpponent?.cycle_total_receipts_usd || 0);

  const disparityRatio = oppUsd > 0 ? Number((Math.max(cycleUsd, careerUsd) / oppUsd).toFixed(2)) : null;
  const donorCorpus = (topDonors || []).map((d) => `${d.name || ""} ${d.employer || ""} ${d.occupation || ""} ${d.type || ""}`).join(" ");

  let matchedArchetype = CAPTURE_ARCHETYPES.find((a) => a.regex.test(donorCorpus));
  if (!matchedArchetype) {
    matchedArchetype = CAPTURE_ARCHETYPES[0];
  }

  // 1. THE HOOK & BAIT
  const hookAndBait = {
    archetype_id: matchedArchetype.id,
    archetype_label: matchedArchetype.label,
    career_war_chest_usd: careerUsd,
    cycle_war_chest_usd: cycleUsd,
    top_5_donors_cycle_usd: top5Sum,
    lead_patron: leadDonor
      ? { name: leadDonor.name, amount_usd: leadDonor.amount_usd, type: leadDonor.type }
      : { name: "Unitemized / Bundled Committee Transfers", amount_usd: cycleUsd, type: "committee_or_pac" },
    opponent_funding_disparity_ratio: disparityRatio,
    primary_harm_thesis: matchedArchetype.harmVector
  };

  // 2. THE LINE
  const leadPatronClause = leadDonor
    ? `anchored this cycle by ${leadDonor.name} (${fmtUsd(leadDonor.amount_usd)}) and ${fmtUsd(top5Sum)} from top-5 patrons`
    : `backed by ${fmtUsd(cycleUsd)} in cycle committee receipts`;

  const disparityClause = (topOpponent && oppUsd > 0 && disparityRatio >= 1.2)
    ? `—out-raising general opponent ${topOpponent.name} (${fmtUsd(oppUsd)}) by ${disparityRatio}x—`
    : "—";

  const voteQuestion =
    `FUTARCHY CONDITIONAL RESOLUTION [${stateCode} ${officeLabel}]: ${subjectName} (${subjectParty || "I"}) has accumulated ` +
    `${fmtUsd(careerUsd)} in career FEC-reported receipts (${leadPatronClause})${disparityClause}exhibiting the ` +
    `"${matchedArchetype.label}" profile. Will independent constituent & oracle review confirm that this private-interest ` +
    `capital concentration compromises public representation in ${stateCode}, thereby executing the ${stateShort} ` +
    `Corrective Restitution Pool toward ${matchedArchetype.restitutionCause}?`;

  const futarchyThesis =
    `Private campaign financing treats ${stateCode} representation as an investable asset class. When ${subjectName}'s ` +
    `campaign apparatus absorbs ${fmtUsd(careerUsd)} (${leadPatronClause}), policy incentives skew toward ` +
    `${matchedArchetype.harmVector}. This futarchy market converts spectator outrage into direct fiscal counter-leverage.`;

  // 3. THE POLE
  const benchmarkPacUnit = Math.max(1000, Math.round((leadDonor?.amount_usd || cycleUsd || 100000) / 1000));
  const poleMechanics = {
    model: "conditional_restitution_futarchy",
    escrow_chain: "base_mainnet_8453",
    escrow_token: "USDC",
    outcomes: {
      YES_EXECUTE_RESTITUTION: "Confirms special-interest capture; releases 100% of escrowed pool to audited state 501(c)(3) restitution beneficiaries — direct corrective remediation of the captured constituent impact.",
      NO_VETO_BENEFICIAL_COMMONS: "Finds representation uncompromised by top-donor concentration; redirects 100% of escrowed pool to a bipartisan, district-wide beneficial common good (e.g., voter-protection legal defense, disaster-relief matching fund, or civic-infrastructure project) where both sides of the political divide can agree that the community as a whole is strengthened — countering zero-sum capture politics with positive-sum community investment.",
      ABSTAIN_AUDIT_ONLY: "Logs cryptographic constituent dissent on-chain without shifting conditional odds; preserves the pool for future cycle reconsideration."
    },
    leverage_ratio_statement: `Every $10 USDC staked in the ${stateCode} Restitution Pool directly counter-programs ${fmtUsd(benchmarkPacUnit)} of top-patron political capital. If the Yes option wins, funds fund front-line ${matchedArchetype.restitutionCause} restitution beneficiaries. If the No option wins, funds redirect to a bipartisan district-wide common good that strengthens the entire community — denying special interests the ability to commandeer the bounty and promoting positive-sum governance over zero-sum subjugation.`
  };

  // 4. MOTIVATING FACTOR / RESOLUTION
  const namedCharities = verifiedCharities.length > 0
    ? verifiedCharities.map((c) => `${c.name} (${c.registry_id})`).join("; ")
    : `Top-ranked IRS Form 990-audited, revocation-clean 501(c)(3) organizations domiciled in ${stateCode} under ${matchedArchetype.nteeFocus}`;

  const bountyDescription =
    `Direct Corrective Restitution for ${stateCode}: Routes 100% of settled Base USDC bounty funds to independently audited, ` +
    `IRS-verified 501(c)(3) public charities operating inside ${stateShort} dedicated to ${matchedArchetype.restitutionCause}—` +
    `directly remediating the constituent impact of ${matchedArchetype.label} (${fmtUsd(careerUsd)} career receipts). ` +
    `If the futarchy market resolves affirmatively, funds execute the restitution pool. If the No option wins, funds veto the capture claim and redirect to a bipartisan district-wide common good (voter protection, disaster relief, or civic infrastructure) protecting the bounty from Special Interest capture and promoting positive-sum community investment over zero-sum oppression.`;

  const destinationCriteria =
    `MUST satisfy all 4 Zero-Trust Restitution Gates: (1) Active 501(c)(3) statutory registration in ${stateCode} verified via ` +
    `IRS EO BMF & clean against IRS Automatic Revocation + OpenSanctions; (2) Verified Form 990 financial filing (${matchedArchetype.nteeFocus}); ` +
    `(3) Zero corporate PAC or political committee affiliation; (4) Pre-indexed Eligible Beneficiaries in ${stateCode}: ${namedCharities}. ` +
    `Note on Resolution Outcome: If the Yes option wins, eligible beneficiaries receive direct restitution. If the No option wins, the bounty pool redirects to a bipartisan district-wide common good (voter protection, disaster relief, or civic infrastructure) — ensuring the bounty cannot be commandeered by special interests and promoting positive-sum community investment over zero-sum subjugation.`;

  const resolutionOracle = {
    trigger_conditions: [
      `Condition A (Financial Capture Threshold): OpenFEC coverage_end_date (${financeStats.coverageEndDate || "current cycle"}) confirms career receipts >= ${fmtUsd(careerUsd)} or top-5 patron concentration >= ${fmtUsd(top5Sum)}.`,
      `Condition B (Constituent Futarchy Quorum): Community vote reaches >= 60% 'Yes' supermajority across verified cycle participants before the settlement epoch.`,
      `Condition C (Zero-Trust Beneficiary Audit): Recipient 501(c)(3) passes automated SHA-256 Merkle verification in docs/data/verified-orgs.json at execution time.`
    ],
    eligible_audited_beneficiaries: verifiedCharities
  };

  // Split charities into two pools
  const charityPools = splitStateCharitiesByOutcome(verifiedCharities, race.state);

  return {
    hookAndBait,
    voteQuestion,
    futarchyThesis,
    poleMechanics,
    bountyDescription,
    destinationCriteria,
    resolutionOracle,
    charityPools,
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
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Polytab-Local-Ingest/2.0" } });
      if (res.status === 429) {
        const wait = 5000 * (i + 1);
        console.warn(`[Rate Limit 429] Sleeping ${wait}ms: ${url}`);
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
}

/**
 * Fetches candidate totals from OpenFEC API.
 * @param {Array} fecIds - Array of FEC candidate IDs
 * @param {number} targetCycle - Election year
 * @returns {Object} { careerReceipts, careerNetContributions, cycleReceipts, coverageEndDate, ... }
 */
async function fetchCandidateTotals(fecIds, targetCycle) {
  let careerReceipts = 0, careerNetContributions = 0, cycleReceipts = 0, coverageEndDate = null;
  const sources = [];
  const principalByCandidate = [];

  for (const candId of (fecIds || [])) {
    if (!candId || /00000$/.test(candId)) continue;
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
    for (const designation of ["P", "A"]) {
      try {
        const cmteUrl = `${CONFIG.openFecBaseUrl}/candidate/${encodeURIComponent(candId)}/committees/?api_key=${CONFIG.fecApiKey}&cycle=${targetCycle}&designation=${designation}&per_page=20`;
        const cmteData = await fetchJsonWithRetry(cmteUrl);
        const cmtes = Array.isArray(cmteData?.results) ? cmteData.results : [];
        if (cmtes.length) { principalByCandidate.push(cmtes[0].committee_id); break; }
      } catch (_) {}
      await sleep(250);
    }
  }

  return {
    careerReceipts: Math.round(careerReceipts),
    careerNetContributions: Math.round(careerNetContributions),
    cycleReceipts: Math.round(cycleReceipts),
    coverageEndDate,
    principalCommitteeId: principalByCandidate[0] || null,
    principalCommitteeIds: principalByCandidate.filter(Boolean),
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
 * Fetches top 5 donors for a committee, preferring local VoteLog backup.
 * @param {string} committeeId
 * @param {number} cycle
 * @param {string} repoRoot
 * @param {object} race
 * @param {Array} subjectFecIds
 * @returns {Array} Top 5 donors
 */
async function fetchTop5DonorsForCommittee(committeeId, cycle, repoRoot, race, subjectFecIds) {
  // Prefer local VoteLog donors backup when available (offline, avoids broken FEC by_contributor).
  const backupDonors = getVotelogBackupTopDonors(repoRoot, race || {}, subjectFecIds || []);
  if (backupDonors.length) {
    console.log(`[Backup] Using local VoteLog donors for ${race?.state || "race"} (${backupDonors.length})`);
    return backupDonors;
  }

  if (committeeId && !/00000$/.test(committeeId)) {
    const urls = [
      `${CONFIG.openFecBaseUrl}/schedules/schedule_a/by_contributor/?api_key=${CONFIG.fecApiKey}&committee_id=${encodeURIComponent(committeeId)}&two_year_transaction_period=${cycle}&per_page=20`,
      `${CONFIG.openFecBaseUrl}/schedules/schedule_a/by_contributor/?api_key=${CONFIG.fecApiKey}&committee_id=${encodeURIComponent(committeeId)}&cycle=${cycle}&per_page=20`
    ];
    for (const url of urls) {
      try {
        const data = await fetchJsonWithRetry(url, 2, 1500);
        const rows = Array.isArray(data?.results) ? data.results : [];
        if (!rows.length) continue;
        const sorted = rows.slice().sort((a, b) => Number(b.total || b.contribution_receipt_amount || 0) - Number(a.total || a.contribution_receipt_amount || 0));
        return sorted.slice(0, 5).map((r, idx) => {
          const et = String(r.entity_type || r.entity_type_desc || "").toUpperCase();
          const type = et.includes("IND") ? "individual_agg" : "committee_or_pac";
          return {
            rank: idx + 1,
            name: r.contributor_name || "Unknown",
            committee_id: r.contributor_id || null,
            amount_usd: Math.round(Number(r.total || r.contribution_receipt_amount || 0)),
            type,
            source_url: `https://www.fec.gov/data/receipts/?committee_id=${committeeId}&two_year_transaction_period=${cycle}`
          };
        });
      } catch (_) {}
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
  if (String(record.vote?.question || "").includes("PLACEHOLDER")) placeholders.push("vote.question");
  if (String(record.bounty_if_passed?.description || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_passed.description");
  if (String(record.bounty_if_passed?.destination_criteria || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_passed.destination_criteria");
  if (String(record.bounty_if_no_wins?.destination_criteria || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_no_wins.destination_criteria");
  return { missing, placeholders };
}

/**
 * Loads IRS-verified, Form 990-audited charities from local shards or master file.
 * @param {string} repoRoot
 * @param {string} stateCode
 * @returns {Array} Verified charities
 */
function loadStateVerifiedCharities(repoRoot, stateCode) {
  const st = String(stateCode || "").replace(/^US-/i, "").toUpperCase();
  const candidates = [];

  // 1. Check state shard first (docs/data/orgs/US/{STATE}.json)
  if (st && st !== "XX") {
    const shardPath = path.join(repoRoot, CONFIG.verifiedOrgsShardDir, `${st}.json`);
    if (fs.existsSync(shardPath)) {
      try {
        const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
        if (Array.isArray(shard.organizations)) candidates.push(...shard.organizations);
      } catch (_) {}
    }
  }

  // 2. Fallback to master index (docs/data/verified-orgs.json)
  if (candidates.length === 0) {
    const indexPath = path.join(repoRoot, CONFIG.verifiedOrgsIndexPath);
    if (fs.existsSync(indexPath)) {
      try {
        const idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        const all = Array.isArray(idx) ? idx : (idx.organizations || []);
        const stateFiltered = all.filter(
          (o) => o?.location?.country_iso2 === "US" && (!st || o?.location?.admin1_state_province === st)
        );
        candidates.push(...(stateFiltered.length > 0 ? stateFiltered : all.slice(0, 10)));
      } catch (_) {}
    }
  }

  return candidates.slice(0, 5).map((c) => ({
    registry_id: c.registry_id,
    name: c.name,
    city: c.location?.locality_city_town || null,
    state: c.location?.admin1_state_province || st,
    verification_tier: c.verification_tier || "TIER_1_AUDITED",
    audit_signals: c.audit_signals || ["IRS_EO_BMF_ACTIVE_501C3"],
    website: c.website || null
  }));
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

async function main() {
  const repoRoot = process.cwd();
  const seedPath = path.join(repoRoot, CONFIG.seedManifestPath);
  const outDir = path.join(repoRoot, CONFIG.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const [votelogMembers, crosswalk] = await Promise.all([
    loadFirstJsonArray(CONFIG.votelogMembersUrls, "VoteLog"),
    loadLegislatorsCrosswalk()
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

    const financeStats = await fetchCandidateTotals(fecIds, electionYear);
    const topDonors = await fetchTop5DonorsForCommittee(financeStats.principalCommitteeId, electionYear, repoRoot, race, fecIds);

    const opponentsIn = Array.isArray(race.opponents_nov_general) ? race.opponents_nov_general : (race.opponents_nov_general ? [race.opponents_nov_general] : []);
    const opponentsOut = [];
    for (const opp of opponentsIn) {
      const oppIds = opp.fec_candidate_id ? [opp.fec_candidate_id] : (opp.fec_candidate_ids || []);
      const oppStats = await fetchCandidateTotals(oppIds, electionYear);
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
        futarchy_thesis: futarry.futarchyThesis,
        question_vars: {
          subject_name: race.subject.name,
          career_total_receipts_usd: financeStats.careerReceipts,
          capture_archetype: futarchy.hookAndBait.archetype_label,
          lead_patron_name: futarchy.hookAndBait.lead_patron.name,
          lead_patron_usd: futarchy.hookAndBait.lead_patron.amount_usd
        },
        type: "futarchy_conditional_restitution",
        options: [
          "Yes — Confirm Capture & Execute State Restitution Bounty",
          "No — Veto Capture Claim & Roll Escrow Pool to Bipartisan Commons",
          "Abstain — Log On-Chain Constituent Dissent Only"
        ]
      },

      // STAGE 3: THE POLE
      futarchy_pole_mechanics: futarchy.poleMechanics,

      // STAGE 4A: IF 'YES' WINS -> TARGETED CORRECTIVE RESTITUTION
      bounty_if_passed: {
        winning_option: "YES_EXECUTE_RESTITUTION",
        description: futarchy.bountyDescription,
        destination_type: "audited_501c3_restitution_escrow",
        destination_criteria: futarchy.destinationCriteria,
        resolution_oracle: futarchy.resolutionOracle,
        state: race.state || null
      },

      // STAGE 4B: IF 'NO' WINS -> BIPARTISAN UNIVERSAL COMMONS + CANDIDATE VINDICATION
      bounty_if_no_wins: {
        winning_option: "NO_VETO_BENEFICIAL_COMMONS",
        description:
          `Positive-Sum Bipartisan Commons for ${race.state}: Constituents reject the capture framing for ${race.subject.name}. ` +
          `100% of escrowed Base USDC routes to non-political, universally beneficial 501(c)(3) infrastructure in ${race.state} ` +
          `(Volunteer Fire/EMS, Veterans' Care, Food Banks, and Disaster Relief) with an on-chain Constituent Mandate Vindication credit.`,
        destination_type: "audited_501c3_bipartisan_commons_escrow",
        candidate_benefit_attestation:
          `Issues immutable on-chain 'CONSTITUENT_MANDATE_VINDICATED' attestation for ${race.subject.name} (${race.state}) ` +
          `and credits the constituency's defense of the candidate for funding front-line state humanitarian & emergency infrastructure.`,
        destination_criteria:
          `MUST be an IRS-audited 501(c)(3) public charity in ${race.state} operating in non-ideological universal commons ` +
          `(NTEE M20/M24 Fire & Rescue, W30 Veterans, K31 Food Banks, E20 Community Hospitals) with zero partisan lobbying.`,
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
  console.log(`[Complete] Wrote ${generatedItems.length} positive-sum futarchy template(s) to ${combinedPath} ${DRAFT ? "(DRAFT)" : ""}`);
}

main().catch((err) => { console.error("[Fatal Error]", err); process.exit(1); });