#!/usr/bin/env node
/**
 * Enrich draft/final vote templates using downloaded VoteLog race data.
 * Fills missing finance.top_donors_cycle with top donors to outside groups (super PACs)
 * benefiting the subject/opponent context as available, sourced from VoteLog superpac-donors.csv.
 * Note: these are super PAC donors (cycle-wide, race-attributed via outside spending), not
 * necessarily direct campaign committee contributors. Provenance is recorded per donor.
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

function topDonorsFromCsv(csvPath, committeeIds, limit = 5) {
  if (!fs.existsSync(csvPath)) return [];
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const allow = committeeIds && committeeIds.size ? committeeIds : null;
  const agg = new Map();
  for (const r of rows) {
    const cid = String(r.committee_id || '').trim();
    if (allow && !allow.has(cid)) continue;
    const name = String(r.donor || r.donor_name || '').trim() || 'Unknown';
    const amt = Number(r.total_cents || r.total || 0) / 100; // CSV has total_cents
    if (!amt) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    const prev = agg.get(key) || { name, amount_usd: 0, committee_ids: new Set(), employer: r.employer || '', occupation: r.occupation || '' };
    prev.amount_usd += amt;
    if (cid) prev.committee_ids.add(cid);
    if (!prev.employer && r.employer) prev.employer = r.employer;
    if (!prev.occupation && r.occupation) prev.occupation = r.occupation;
    agg.set(key, prev);
  }
  return Array.from(agg.values())
    .sort((a, b) => b.amount_usd - a.amount_usd)
    .slice(0, limit)
    .map((d, idx) => ({
      rank: idx + 1,
      name: d.name,
      committee_id: d.committee_ids.size === 1 ? Array.from(d.committee_ids)[0] : null,
      amount_usd: Math.round(d.amount_usd),
      type: 'superpac_donor_via_votelog',
      employer: d.employer || undefined,
      occupation: d.occupation || undefined,
      source_url: null,
      source_note: 'Aggregated from VoteLog superpac-donors.csv for outside groups benefiting this side (cycle-wide, cents-converted).'
    }));
}

function benefitingCommittees(summary, side /* 'subject'|'opponent' */, subjectKeyGuess) {
  // outsideByCommittee: forPaxton/againstPaxton/forTalarico/againstTalarico keyed by entity short keys.
  // We don't know the entity key name reliably here, so use heuristic: subject is record.subject; in VoteLog entity keys vary.
  // Simpler: include committees where (forX - againstX) > 0 for the "benefiting" side by trying to map via totals? Hard without key.
  // Alternative: for subject, take committees with any "for" > 0 in entries that are not clearly opponent-only? Better: infer keys from snapshot entityLog if present.
  return null; // signal to use all committees in race
}

(async () => {
  const repoRoot = process.cwd();
  const draftCombinedPath = path.join(repoRoot, 'docs/data/beta/votes-2026-draft.json');
  const outDir = path.join(repoRoot, 'docs/data/beta/votes-2026');
  const votelogBase = path.join(repoRoot, 'docs/data/beta/votelog');
  if (!fs.existsSync(draftCombinedPath)) {
    console.error('No draft combined file found:', draftCombinedPath);
    process.exit(1);
  }
  const drafts = JSON.parse(fs.readFileSync(draftCombinedPath, 'utf8'));
  let patched = 0;

  for (const rec of drafts) {
    const slug = rec?.provenance?.votelog_data_slug || rec?._seed_meta?.votelog_data_slug || (() => {
      // derive from jurisdiction/state+race_type: us-fl + special => fl-senate-general/special? our slugs are like fl-senate-general
      const st = String(rec.jurisdiction?.state || '').replace('US-', '').toLowerCase();
      const rt = rec.jurisdiction?.race_type || 'regular';
      return rt === 'special' ? `${st}-senate-special` : `${st}-senate-general`;
    })();
    // but our downloaded folders use data slugs like fl-senate-general (even special in that naming?) - check actual
    let dataSlug = slug;
    if (!fs.existsSync(path.join(votelogBase, dataSlug))) {
      const st = String(rec.jurisdiction?.state || '').replace('US-', '').toLowerCase();
      const alt = `${st}-senate-general`;
      if (fs.existsSync(path.join(votelogBase, alt))) dataSlug = alt;
    }
    const csvPath = path.join(votelogBase, dataSlug, 'superpac-donors.csv');
    const summaryPath = path.join(votelogBase, dataSlug, 'summary.json');
    if (!fs.existsSync(csvPath)) { console.warn(`[enrich] no csv for ${rec.bounty_id} (${dataSlug})`); continue; }

    // Try to pick committees benefiting subject using outsideByCommittee + entity keys from snapshot
    let subjectCommitteeIds = null;
    try {
      const snapPath = path.join(votelogBase, dataSlug, 'snapshot.json');
      if (fs.existsSync(summaryPath) && fs.existsSync(snapPath)) {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
        const entities = snap.entityLog || {};
        // find entity key for subject by matching candidateId
        const subjFec = (rec.subject?.identifiers?.fec_candidate_ids || [])[0];
        let subjKey = null, oppKeys = [];
        for (const [k, v] of Object.entries(entities)) {
          if (!v || !v.candidateId) continue;
          const ids = [v.candidateId, ...(v.aliasCandidateIds || [])];
          if (subjFec && ids.includes(subjFec)) subjKey = k; else oppKeys.push(k);
        }
        if (subjKey && Array.isArray(summary.outsideByCommittee)) {
          const forField = `for${subjKey.charAt(0).toUpperCase() + subjKey.slice(1)}`;
          const againstField = `against${subjKey.charAt(0).toUpperCase() + subjKey.slice(1)}`;
          // committees benefiting subject: forSubject > 0 OR against any opponent > 0
          subjectCommitteeIds = new Set();
          for (const c of summary.outsideByCommittee) {
            let benefit = Number(c[forField] || 0);
            for (const ok of oppKeys) {
              const af = `against${ok.charAt(0).toUpperCase() + ok.slice(1)}`;
              benefit += Number(c[af] || 0);
            }
            if (benefit > 0 && c.committeeId) subjectCommitteeIds.add(c.committeeId);
          }
          if (subjectCommitteeIds.size === 0) subjectCommitteeIds = null;
        }
      }
    } catch (e) { /* fallback */ }

    const needSubject = !rec.finance.top_donors_cycle || rec.finance.top_donors_cycle.length === 0;
    if (needSubject) {
      const donors = topDonorsFromCsv(csvPath, subjectCommitteeIds, 5);
      if (donors.length) {
        donors.forEach(d => { d.source_url = `https://votelog.org/data/${dataSlug}/superpac-donors.csv`; });
        rec.finance.top_donors_cycle = donors;
        rec.finance.top_donors_source_note = subjectCommitteeIds
          ? 'Top donors to outside groups (super PACs) benefiting subject in this race, aggregated from VoteLog superpac-donors.csv (cycle-wide).'
          : 'Top donors to super PACs active in this race, aggregated from VoteLog superpac-donors.csv (cycle-wide; committee-to-candidate attribution unavailable).';
        if (Array.isArray(rec.finance.sources)) {
          rec.finance.sources.push({ label: `VoteLog super PAC donors (${dataSlug})`, url: `https://votelog.org/data/${dataSlug}/superpac-donors.csv`, as_of: new Date().toISOString().slice(0,10) });
        }
        patched++;
        console.log(`[enrich] ${rec.bounty_id}: filled ${donors.length} donor(s) from ${dataSlug}${subjectCommitteeIds ? ' (benefiting-subject committees)' : ' (race-wide fallback)'}`);
      } else {
        console.log(`[enrich] ${rec.bounty_id}: no donors found in ${dataSlug}`);
      }
    }

    // refresh review hints
    if (rec._review) {
      const missing = [];
      const placeholders = [];
      if (!rec.subject.identifiers.fec_candidate_ids || rec.subject.identifiers.fec_candidate_ids.length === 0) missing.push('subject.identifiers.fec_candidate_ids');
      if (rec.finance.career_total_receipts_usd === 0 && (rec.subject.identifiers.fec_candidate_ids || []).length > 0) missing.push('finance.career_total_receipts_usd (0 - check API/key/IDs)');
      if (!rec.finance.top_donors_cycle || rec.finance.top_donors_cycle.length === 0) missing.push('finance.top_donors_cycle');
      if (!rec.finance.coverage_end_date) missing.push('finance.coverage_end_date');
      if (!rec.opponents_nov_general || rec.opponents_nov_general.length === 0) missing.push('opponents_nov_general (none listed)');
      (rec.opponents_nov_general || []).forEach((o, i) => {
        if (!o.fec_candidate_id && !(o.fec_candidate_ids || []).length) missing.push(`opponents_nov_general[${i}].fec_candidate_id`);
        if (o.cycle_total_receipts_usd === 0) missing.push(`opponents_nov_general[${i}].cycle_total_receipts_usd (0 - verify)`);
      });
      if (String(rec.vote.question || '').includes('PLACEHOLDER')) placeholders.push('vote.question');
      if (String(rec.bounty_if_passed.description || '').includes('PLACEHOLDER')) placeholders.push('bounty_if_passed.description');
      if (String(rec.bounty_if_passed.destination_criteria || '').includes('PLACEHOLDER')) placeholders.push('bounty_if_passed.destination_criteria');
      rec._review = { missing, placeholders };
    }

    const draftPath = path.join(outDir, `${rec.bounty_id}.draft.json`);
    if (fs.existsSync(outDir)) fs.writeFileSync(draftPath, JSON.stringify(rec, null, 2) + '\n', 'utf8');
  }

  fs.writeFileSync(draftCombinedPath, JSON.stringify(drafts, null, 2) + '\n', 'utf8');
  console.log(`[enrich] Patched ${patched} record(s). Updated ${draftCombinedPath}`);
})().catch(e => { console.error(e); process.exit(1); });
