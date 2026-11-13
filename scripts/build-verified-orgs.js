// Polytab — Verified Charity Master List builder
//
// Goal: capture a growing master list of verified, independently audited, trusted
// charities as quickly as possible WITHOUT accruing any $$ charges.
//
// Source (free, no API key, public): ProPublica Nonprofit Explorer API
//   https://projects.propublica.org/nonprofits/api/v2/
// backed by IRS Exempt Organizations BMF + IRS annual financial extracts.
// Evidence is IRS Form 990 / 990-EZ / 990-PF filings (independently filed).
//
// Honest rules:
// - We record what the filings show (EIN, filing years, reported figures). We do
//   not invent ratings, audits, or "trusted" badges beyond the filing evidence.
// - No coordinates, no personal/home data. City/state from the public filing only.
// - Registry entries are candidates for review/pairing; adding to this master
//   list does NOT auto-promote anything to docs/feed.json (Projects).
//
// Runs in GitHub Actions (free tier). Idempotent merge by EIN.

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'docs', 'data', 'verified-orgs.json');
const BASE = 'https://projects.propublica.org/nonprofits/api/v2';
const USER_AGENT = 'Polytab-VerifiedOrgs/1.0 (+https://github.com/R03LV1S/Polytab)';
const MAX_NEW_PER_RUN = 200;      // capture quickly but finish within job time
const MAX_DETAIL_FETCHES = 120;   // detail calls per run (polite, bounded)
const REQUEST_DELAY_MS = 350;     // polite pacing; free tier, no $$
const SEARCH_PAGES_PER_QUERY = 3; // pages per query per run

const MISSION_QUERIES = [
  'children disability', 'pediatric cancer', 'children hospital', 'childhood leukemia',
  'orphan children', 'foster children', 'special needs children', 'autism children',
  'blind children', 'deaf children', 'wheelchair children', 'rare disease children',
  'sick children', 'hospice children', 'disability accessibility', 'assistive technology',
  'cerebral palsy', 'prosthetic children', 'neonatal intensive care', 'family shelter children'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickLatestFiling(orgDetail) {
  const filings = Array.isArray(orgDetail && orgDetail.filings_with_data) ? orgDetail.filings_with_data : [];
  if (filings.length === 0) return null;
  // filings_with_data is usually newest-first; be defensive
  const sorted = filings.slice().sort((a, b) => (Number(b.tax_prd_yr) || 0) - (Number(a.tax_prd_yr) || 0));
  const f = sorted[0];
  const totRev = safeNum(f.totrevenue);
  const totExp = safeNum(f.totfuncexpns);
  const progExp = safeNum(f.totprogrmservexpnsa != null ? f.totprogrmservexpnsa : f.totprgmrevnue); // best-effort
  let programRatio = null;
  // 990 fields vary; try a few common ones
  const programSpent = safeNum(f.totprgmrevnue) != null ? safeNum(f.totprgmrevnue) : safeNum(f.progrmservexp);
  const totalSpent = totExp != null ? totExp : safeNum(f.totexpns);
  if (programSpent != null && totalSpent != null && totalSpent > 0) {
    // only meaningful when programSpent looks like an expense component
    if (programSpent <= totalSpent * 1.5) programRatio = Math.max(0, Math.min(1, programSpent / totalSpent));
  }
  return {
    tax_year: safeNum(f.tax_prd_yr),
    form_type: f.formtype != null ? String(f.formtype) : null,
    pdf_url: f.pdf_url || null,
    total_revenue: totRev,
    total_expenses: totExp != null ? totExp : safeNum(f.totexpns),
    total_assets_eoy: safeNum(f.totassetsend),
    reported_program_spend: programSpent,
    program_expense_ratio: programRatio != null ? Math.round(programRatio * 1000) / 1000 : null
  };
}

function toRegistryEntry(org, detail) {
  const o = (detail && detail.organization) ? detail.organization : org || {};
  const ein = String(o.ein || org.ein || '').replace(/\D/g, '');
  const latest = pickLatestFiling(detail);
  const subsection = o.subsection_code != null ? Number(o.subsection_code) : null;
  return {
    ein,
    name: (o.name || org.name || '').trim(),
    city: (o.city || org.city || '').trim() || null,
    state: (o.state || org.state || '').trim() || null,
    ntee_code: o.ntee_code || org.ntee_code || null,
    subsection_code: subsection,
    ruling_date: o.ruling_date || null,
    classification_codes: o.classification_codes || null,
    deductibility_code: o.deductibility_code != null ? Number(o.deductibility_code) : null,
    foundation_code: o.foundation_code != null ? Number(o.foundation_code) : null,
    asset_amount: safeNum(o.asset_amount),
    income_amount: safeNum(o.income_amount),
    latest_filing: latest,
    verification: {
      source: 'ProPublica Nonprofit Explorer API (IRS EO BMF + IRS financial extracts)',
      source_url: 'https://projects.propublica.org/nonprofits/organizations/' + ein,
      evidence: latest ? 'IRS Form 990/990-EZ/990-PF filing (tax year ' + latest.tax_year + ')' : 'IRS EO BMF listing',
      independently_filed: true,
      has_recent_filing: !!(latest && latest.tax_year && latest.tax_year >= 2018),
      is_501c3: subsection === 3
    },
    captured_at: new Date().toISOString()
  };
}

function isAcceptable(entry) {
  if (!entry.ein || !entry.name) return false;
  if (entry.verification.is_501c3 !== true) return false; // 501(c)(3)
  if (!entry.verification.has_recent_filing) return false; // evidence of ongoing filing
  return true;
}

function loadRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!data || !Array.isArray(data.orgs)) throw new Error('bad shape');
    if (!data.progress || typeof data.progress !== 'object') data.progress = {};
    return data;
  } catch (_) {
    return {
      version: 1,
      updated_at: null,
      description: 'Polytab verified charity master list. Captured from free public sources (ProPublica Nonprofit Explorer / IRS filings). Evidence-backed; no fabricated ratings. No coordinates or personal data.',
      counts: { total: 0 },
      progress: { query_index: 0, pages: {} },
      orgs: []
    };
  }
}

async function main() {
  const reg = loadRegistry();
  const byEin = new Map(reg.orgs.map(o => [String(o.ein), o]));
  let detailFetches = 0;
  let added = 0;
  let scanned = 0;

  const startQuery = (Number(reg.progress.query_index) || 0) % MISSION_QUERIES.length;
  outer:
  for (let qi = 0; qi < MISSION_QUERIES.length; qi++) {
    const qIdx = (startQuery + qi) % MISSION_QUERIES.length;
    const q = MISSION_QUERIES[qIdx];
    const startPage = Number((reg.progress.pages || {})[q] || 0);
    for (let p = startPage; p < startPage + SEARCH_PAGES_PER_QUERY; p++) {
      let search;
      try {
        await sleep(REQUEST_DELAY_MS);
        search = await fetchJson(BASE + '/search.json?q=' + encodeURIComponent(q) + '&page=' + p);
      } catch (e) {
        console.log('search failed q="' + q + '" page=' + p + ': ' + e.message);
        break; // try next query
      }
      const orgs = Array.isArray(search.organizations) ? search.organizations : [];
      if (orgs.length === 0) { (reg.progress.pages = reg.progress.pages || {})[q] = 0; break; }
      for (const hit of orgs) {
        scanned++;
        const ein = String(hit.ein || '').replace(/\D/g, '');
        if (!ein || byEin.has(ein)) continue;
        if (detailFetches >= MAX_DETAIL_FETCHES || added >= MAX_NEW_PER_RUN) break outer;
        let detail = null;
        try {
          await sleep(REQUEST_DELAY_MS);
          detail = await fetchJson(BASE + '/organizations/' + ein + '.json');
          detailFetches++;
        } catch (e) {
          console.log('detail failed ein=' + ein + ': ' + e.message);
          continue;
        }
        const entry = toRegistryEntry(hit, detail);
        if (!isAcceptable(entry)) continue;
        byEin.set(ein, entry);
        added++;
      }
      (reg.progress.pages = reg.progress.pages || {})[q] = p + 1;
      const numPages = Number(search.num_pages || 0);
      if (numPages && p + 1 >= numPages) { reg.progress.pages[q] = 0; }
    }
    reg.progress.query_index = (qIdx + 1) % MISSION_QUERIES.length;
  }

  reg.orgs = Array.from(byEin.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '') || String(a.ein).localeCompare(String(b.ein)));
  reg.counts = { total: reg.orgs.length, with_recent_filing: reg.orgs.filter(o => o.verification && o.verification.has_recent_filing).length };
  reg.updated_at = new Date().toISOString();

  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  console.log('verified-orgs: scanned=' + scanned + ' detail_fetches=' + detailFetches + ' added=' + added + ' total=' + reg.orgs.length);
  console.log('wrote ' + REGISTRY_PATH);
}

main().catch(e => { console.error(e); process.exit(1); });
