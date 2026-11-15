#!/usr/bin/env node
/**
 * Build a consolidated JSON of all downloaded VoteLog donor data for offline use.
 * Sources: docs/data/beta/votelog/<slug>/superpac-donors.csv (+ summary/snapshot for attribution)
 * Output: docs/data/beta/votelog-donors-all.json
 */
const fs = require('fs');
const path = require('path');

function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(x => String(x || '').trim() !== '')).map(r => {
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j] !== undefined ? r[j] : '';
    return o;
  });
}

function aggTopDonors(rows, committeeIds, limit = 25) {
  const allow = committeeIds && committeeIds.size ? committeeIds : null;
  const agg = new Map();
  for (const r of rows) {
    const cid = String(r.committee_id || '').trim();
    if (allow && !allow.has(cid)) continue;
    const name = String(r.donor || r.donor_name || '').trim() || 'Unknown';
    const amountCents = Number(r.total_cents || 0);
    if (!amountCents) continue;
    const key = `${name.toLowerCase().replace(/\s+/g, ' ')}|${String(r.employer||'').toLowerCase()}|${String(r.occupation||'').toLowerCase()}`;
    const prev = agg.get(key) || { name, amount_cents: 0, amount_usd: 0, committee_ids: [], employer: r.employer || '', occupation: r.occupation || '' };
    prev.amount_cents += amountCents;
    prev.amount_usd = Math.round(prev.amount_cents / 100);
    if (cid && !prev.committee_ids.includes(cid)) prev.committee_ids.push(cid);
    if (!prev.employer && r.employer) prev.employer = r.employer;
    if (!prev.occupation && r.occupation) prev.occupation = r.occupation;
    agg.set(key, prev);
  }
  return Array.from(agg.values()).sort((a, b) => b.amount_cents - a.amount_cents).slice(0, limit)
    .map((d, idx) => ({ rank: idx + 1, ...d }));
}

(async () => {
  const repoRoot = process.cwd();
  const base = path.join(repoRoot, 'docs/data/beta/votelog');
  const seed = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/data/beta/winners-seed-2026.json'), 'utf8'));
  const out = {
    _comment: 'Consolidated VoteLog donor data (offline backup). Built from downloaded per-race superpac-donors.csv/summary/snapshot. Amounts in cents and USD. Use as fallback when OpenFEC by_contributor is unavailable.',
    generated_at: new Date().toISOString(),
    source: 'votelog.org race data downloads',
    races: {}
  };

  for (const race of seed.races) {
    const slug = race?._seed_meta?.votelog_data_slug;
    const st = String(race.state || '').replace('US-', '').toLowerCase();
    const dataSlug = (slug && fs.existsSync(path.join(base, slug))) ? slug : (fs.existsSync(path.join(base, `${st}-senate-general`)) ? `${st}-senate-general` : null);
    if (!dataSlug) continue;
    const dir = path.join(base, dataSlug);
    const csvPath = path.join(dir, 'superpac-donors.csv');
    const summaryPath = path.join(dir, 'summary.json');
    const snapPath = path.join(dir, 'snapshot.json');
    const raceOut = { data_slug: dataSlug, state: race.state, race_type: race.race_type, bounty_id: `${race.election_year}-${race.office_type}-${String(race.state||'').toLowerCase()}-${race.race_type||'regular'}` };

    let rows = [];
    if (fs.existsSync(csvPath)) {
      rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
      raceOut.superpac_donors_row_count = rows.length;
    } else {
      raceOut.superpac_donors_row_count = 0;
    }

    // race-wide top donors
    raceOut.top_donors_race_wide = aggTopDonors(rows, null, 25).map(d => ({ ...d, committee_id: d.committee_ids.length === 1 ? d.committee_ids[0] : null, committee_ids: d.committee_ids }));

    // by-entity (candidate side) top donors benefiting them, if mappable
    raceOut.by_entity = {};
    try {
      if (fs.existsSync(summaryPath) && fs.existsSync(snapPath)) {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
        const entities = snap.entityLog || {};
        const keys = Object.keys(entities).filter(k => entities[k] && entities[k].candidateId);
        for (const k of keys) {
          const forField = `for${k.charAt(0).toUpperCase() + k.slice(1)}`;
          const ids = new Set();
          if (Array.isArray(summary.outsideByCommittee)) {
            for (const c of summary.outsideByCommittee) {
              let benefit = Number(c[forField] || 0);
              for (const ok of keys) {
                if (ok === k) continue;
                const af = `against${ok.charAt(0).toUpperCase() + ok.slice(1)}`;
                benefit += Number(c[af] || 0);
              }
              if (benefit > 0 && c.committeeId) ids.add(c.committeeId);
            }
          }
          raceOut.by_entity[k] = {
            candidate_id: entities[k].candidateId,
            party: entities[k].party || null,
            benefiting_committee_ids: Array.from(ids),
            top_donors: aggTopDonors(rows, ids.size ? ids : null, 25).map(d => ({ ...d, committee_id: d.committee_ids.length === 1 ? d.committee_ids[0] : null, committee_ids: d.committee_ids }))
          };
        }
      }
    } catch (e) { raceOut.by_entity_error = e.message; }

    out.races[dataSlug] = raceOut;
    console.log(`[build] ${dataSlug}: rows=${rows.length}, entities=${Object.keys(raceOut.by_entity||{}).length}`);
  }

  const outPath = path.join(repoRoot, 'docs/data/beta/votelog-donors-all.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[build] Wrote ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
