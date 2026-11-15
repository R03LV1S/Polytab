#!/usr/bin/env node
/**
 * scripts/generate-vote-template.js
 * Zero-dependency Node.js (v18+) generator for Polytab pol-vote-beta-2 templates.
 * Modes:
 *  - default: writes final outputs
 *  - DRAFT=1 or --draft: writes draft outputs (*-draft.json) with _review hints
 */

const fs = require("fs");
const path = require("path");

const DRAFT = process.env.DRAFT === "1" || process.argv.includes("--draft");

// ======================= CUSTOMIZATION ZONE =======================
const CONFIG = {
  templateVersion: "pol-vote-beta-2",
  electionYear: Number(process.env.ELECTION_YEAR || 2026),
  officeType: process.env.OFFICE_TYPE || "us_senate", // "us_senate" | "us_house"
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

  payment: {
    chain: "base",
    chain_id: 8453,
    token: "USDC",
    wallet: "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08",
    qr_asset: "docs/escrow-qr.png",
    note: "Uses existing project wallet/QR; subject to current claim-first/support-locked routing rules unless overridden for this beta item."
  },
  location: {
    label: "United States Capitol",
    address: "First St SE, Washington, DC 20004, USA",
    lat: 38.8899,
    lng: -77.0091
  },

  buildVoteQuestion(subjectName, careerReceiptsUsd) {
    return `[BETA_VOTE_QUESTION_PLACEHOLDER for ${subjectName} | career reported receipts: $${Number(careerReceiptsUsd || 0).toLocaleString("en-US")}]`;
  },
  buildBountyDescription(stateCode) {
    return `[BETA_BOUNTY_OUTCOME_PLACEHOLDER for ${stateCode}]`;
  },
  buildBountyCriteria(stateCode) {
    return `[BETA_CRITERIA_PLACEHOLDER for ${stateCode}]`;
  }
};
// ===================== END CUSTOMIZATION ZONE =====================

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const todayIso = () => new Date().toISOString().slice(0, 10);

async function fetchJsonWithRetry(url, retries = 4, delayMs = 1200) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Polytab-Local-Ingest/1.0" } });
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

function ensureSeedManifest(seedPath) {
  if (fs.existsSync(seedPath)) return JSON.parse(fs.readFileSync(seedPath, "utf8"));
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  const starterSeed = {
    _comment: "Certified winners/opponents manifest. Set won_race=true to emit. Fill bioguide_id/fec_candidate_ids/opponents from certified results.",
    races: [
      {
        office_type: "us_senate",
        election_year: 2026,
        state: "US-TX",
        district: null,
        race_type: "regular",
        senate_class: 2,
        subject: {
          name: "Example Senator",
          party: "R",
          incumbent: true,
          won_race: false,
          bioguide_id: "C001056",
          fec_candidate_ids: ["S2TX00106"],
          votelog_slug: "john-cornyn",
          votelog_listed: true
        },
        opponents_nov_general: [
          { name: "Example Opponent", party: "D", fec_candidate_id: "S0YY00000" }
        ]
      }
    ]
  };
  fs.writeFileSync(seedPath, JSON.stringify(starterSeed, null, 2) + "\n", "utf8");
  console.log(`[Seed] Created starter seed manifest at ${seedPath}. Edit it (set won_race=true for races to emit), then re-run.`);
  return starterSeed;
}

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

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
        // fallback: any election_full row for this candidate with coverage, prefer latest
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

let _votelogDonorsBackup = null;
function loadVotelogDonorsBackup(repoRoot) {
  if (_votelogDonorsBackup) return _votelogDonorsBackup;
  const p = path.join(repoRoot, CONFIG.votelogDonorsBackupPath || "docs/data/beta/votelog-donors-all.json");
  try {
    if (fs.existsSync(p)) {
      _votelogDonorsBackup = JSON.parse(fs.readFileSync(p, "utf8"));
      console.log(`[Backup] Loaded VoteLog donors backup: ${p}`);
    } else {
      _votelogDonorsBackup = { races: {} };
    }
  } catch (e) {
    console.warn(`[Backup] Failed to load donors backup: ${e.message}`);
    _votelogDonorsBackup = { races: {} };
  }
  return _votelogDonorsBackup;
}

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
  for (const s of slugCandidates) { if (backup.races && backup.races[s]) { raceData = backup.races[s]; break; } }
  if (!raceData) return [];

  const fecSet = new Set((subjectFecIds || []).filter(Boolean));
  let entity = null;
  for (const e of Object.values(raceData.by_entity || {})) {
    if (fecSet.has(e.candidate_id)) { entity = e; break; }
  }
  const donors = (entity && Array.isArray(entity.top_donors) && entity.top_donors.length)
    ? entity.top_donors
    : (Array.isArray(raceData.top_donors_race_wide) ? raceData.top_donors_race_wide : []);
  if (!donors.length) return [];
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

async function fetchTop5DonorsForCommittee(committeeId, cycle, repoRoot, race, subjectFecIds) {
  // Prefer local VoteLog donors backup when available (offline, avoids broken FEC by_contributor).
  const backupDonors = getVotelogBackupTopDonors(repoRoot, race || {}, subjectFecIds || []);
  if (backupDonors.length) {
    console.log(`[Backup] Using local VoteLog donors for ${race?.state || "race"} (${backupDonors.length})`);
    return backupDonors;
  }

  if (committeeId && !/00000$/.test(committeeId)) {
    // by_contributor returns aggregated totals per contributor; sort=-total is not accepted by the API.
    // Try valid param combinations and sort client-side.
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
          let type = "other";
          if (et.includes("IND")) type = "individual_agg";
          else if (et.includes("PAC") || et.includes("COM") || et.includes("ORG") || et.includes("CCM") || et.includes("PTY")) type = "committee_or_pac";
          return {
            rank: idx + 1,
            name: r.contributor_name || "Unknown",
            committee_id: r.contributor_id || null,
            amount_usd: Math.round(Number(r.total || r.contribution_receipt_amount || 0)),
            type,
            source_url: `https://www.fec.gov/data/receipts/?committee_id=${committeeId}&two_year_transaction_period=${cycle}`
          };
        });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.warn(`[OpenFEC] Top donors attempt failed for ${committeeId}: ${msg}`);
      }
    }
    console.warn(`[OpenFEC] Top donors unavailable for ${committeeId} (endpoint errors/unavailable).`);
  }
  return [];
}

function buildReviewHints(record) {
  const missing = [];
  const placeholders = [];
  if (!record.subject.identifiers.fec_candidate_ids || record.subject.identifiers.fec_candidate_ids.length === 0) missing.push("subject.identifiers.fec_candidate_ids");
  if (record.finance.career_total_receipts_usd === 0 && (record.subject.identifiers.fec_candidate_ids || []).length > 0) missing.push("finance.career_total_receipts_usd (0 - check API/key/IDs)");
  if (!record.finance.top_donors_cycle || record.finance.top_donors_cycle.length === 0) missing.push("finance.top_donors_cycle");
  if (!record.finance.coverage_end_date) missing.push("finance.coverage_end_date");
  if (!record.opponents_nov_general || record.opponents_nov_general.length === 0) missing.push("opponents_nov_general (none listed)");
  (record.opponents_nov_general || []).forEach((o, i) => {
    if (!o.fec_candidate_id && !(o.fec_candidate_ids || []).length) missing.push(`opponents_nov_general[${i}].fec_candidate_id`);
    if (o.cycle_total_receipts_usd === 0) missing.push(`opponents_nov_general[${i}].cycle_total_receipts_usd (0 - verify)`);
  });
  if (String(record.vote.question || "").includes("PLACEHOLDER")) placeholders.push("vote.question");
  if (String(record.bounty_if_passed.description || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_passed.description");
  if (String(record.bounty_if_passed.destination_criteria || "").includes("PLACEHOLDER")) placeholders.push("bounty_if_passed.destination_criteria");
  return { missing, placeholders };
}

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
    if (!vlListed) {
      console.log(`[Skip] ${race.subject.name}: not listed on VoteLog (and no explicit seed override).`);
      continue;
    }

    const electionYear = Number(race.election_year || CONFIG.electionYear);
    console.log(`[Processing] ${race.state} ${officeType} ${race.race_type || "regular"} — ${race.subject.name} [FEC: ${fecIds.join(", ") || "none"}]`);

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

    const stateSlug = String(race.state || "US-XX").toLowerCase();
    const raceType = race.race_type || "regular";
    const districtSlug = race.district ? `-${String(race.district).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    const bountyId = `${electionYear}-${officeType}-${stateSlug}${districtSlug}-${raceType}`;
    const cycleWindow = officeType === "us_senate" ? "full_term_6yr" : "2yr";

    const record = {
      template_version: CONFIG.templateVersion,
      bounty_id: bountyId,
      office_type: officeType,
      election_year: electionYear,
      jurisdiction: { level: "federal", state: race.state || null, district: race.district || null, race_type: raceType, senate_class: race.senate_class ?? null },
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
        cycle_window: cycleWindow,
        cycle_total_receipts_usd: financeStats.cycleReceipts,
        coverage_end_date: financeStats.coverageEndDate,
        top_donors_cycle: topDonors,
        sources: financeStats.sources
      },
      opponents_nov_general: opponentsOut,
      vote: {
        question: CONFIG.buildVoteQuestion(race.subject.name, financeStats.careerReceipts),
        question_vars: { subject_name: race.subject.name, career_total_receipts_usd: financeStats.careerReceipts },
        type: "advisory_yes_no",
        options: ["Yes", "No", "Abstain"]
      },
      bounty_if_passed: {
        description: CONFIG.buildBountyDescription(race.state || "US-XX"),
        destination_type: "tip_jar",
        destination_criteria: CONFIG.buildBountyCriteria(race.state || "US-XX"),
        state: race.state || null
      },
      location: CONFIG.location,
      payment: { ...CONFIG.payment, payment_memo_or_slug: bountyId },
      provenance: { status: DRAFT ? "beta_template_draft" : "beta_template", generated_at: new Date().toISOString(), generator: "pol-vote-template", review_required: true }
    };

    if (DRAFT) record._review = buildReviewHints(record);

    const fileName = DRAFT ? `${bountyId}.draft.json` : `${bountyId}.json`;
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(record, null, 2) + "\n", "utf8");
    generatedItems.push(record);
    console.log(`[Saved] ${path.join(outDir, fileName)}`);
  }

  const combinedPath = path.join(repoRoot, CONFIG.combinedOutputFile);
  fs.mkdirSync(path.dirname(combinedPath), { recursive: true });
  fs.writeFileSync(combinedPath, JSON.stringify(generatedItems, null, 2) + "\n", "utf8");
  console.log(`[Complete] Wrote ${generatedItems.length} template(s) to ${combinedPath} ${DRAFT ? "(DRAFT)" : ""}`);
}

main().catch((err) => { console.error("[Fatal Error]", err); process.exit(1); });
