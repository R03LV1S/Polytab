const fs = require('fs');
const path = require('path');

const FEC_KEY = process.env.FEC_API_KEY || 'mCJHrC97Km7CWzwTmtqbh6NBfndLMNQGnDK6NcpB';
const states = ['al','ak','ar','co','de','fl','ga','id','il','ia','ks','ky','la','me','ma','mi','mn','ms','mt','ne','nh','nj','nm','nc','oh','ok','or','ri','sc','sd','tn','tx','va','wv','wy'];
const regularClass2 = new Set(['AL','AK','AR','CO','DE','GA','ID','IL','IA','KS','KY','LA','ME','MA','MI','MN','MS','MT','NE','NH','NJ','NM','NC','OK','OR','RI','SC','SD','TN','TX','VA','WV','WY']);
const specialClass = { FL: 3, OH: 3 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, retries = 4) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Polytab-Seed-Gen/1.0' } });
      if (r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    } catch (e) { last = e; await sleep(1000 * (i + 1)); }
  }
  throw last;
}

function properName(fecName) {
  if (!fecName) return null;
  const parts = fecName.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return fecName;
  const last = parts[0];
  const rest = parts.slice(1).join(' ').trim();
  const suffixes = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
  const toTitle = (w) => w.split(/\s+/).map(t => {
    const clean = t.replace(/\./g, '').toUpperCase();
    if (suffixes.has(clean)) return clean.charAt(0) + clean.slice(1).toLowerCase();
    if (t.length <= 2 && /^[A-Z]+$/.test(t)) return t;
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }).join(' ');
  const lastT = toTitle(last);
  if (!rest) return lastT;
  const tokens = rest.split(/\s+/);
  const suf = []; const firsts = [];
  for (const t of tokens) { if (suffixes.has(t.replace(/\./g, '').toUpperCase())) suf.push(t.replace(/\./g, '')); else firsts.push(t); }
  let name = (firsts.map(toTitle).join(' ') + ' ' + lastT).trim();
  if (suf.length) name += ' ' + suf.map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ');
  return name.replace(/\s+/g, ' ').trim();
}

function partyCode(p) {
  const u = String(p || '').toUpperCase();
  if (u.startsWith('REP') || u === 'R') return 'R';
  if (u.startsWith('DEM') || u === 'D' || u.startsWith('DFL')) return 'D';
  if (u.startsWith('IND') || u === 'I') return 'I';
  if (u.startsWith('LIB') || u === 'L') return 'L';
  if (u.startsWith('GRE') || u === 'G') return 'G';
  return (p || '').toString().slice(0, 3).toUpperCase() || null;
}

(async () => {
  console.log('[SeedGen] Loading members, legislators, snapshots...');
  const [membersRaw, legCurRaw, legHistRaw] = await Promise.all([
    fetchJson('https://votelog.org/data/members-all.json'),
    fetchJson('https://unitedstates.github.io/congress-legislators/legislators-current.json').catch(e => { console.warn('[SeedGen] legislators-current failed:', e.message); return []; }),
    fetchJson('https://unitedstates.github.io/congress-legislators/legislators-historical.json').catch(e => { console.warn('[SeedGen] legislators-historical failed:', e.message); return []; })
  ]);
  const members = Array.isArray(membersRaw) ? membersRaw : (membersRaw.members || []);
  const legs = [...(Array.isArray(legCurRaw) ? legCurRaw : []), ...(Array.isArray(legHistRaw) ? legHistRaw : [])];
  const legByBioguide = new Map();
  const legByFec = new Map();
  for (const leg of legs) {
    const bio = leg?.id?.bioguide;
    if (bio && !legByBioguide.has(bio.toUpperCase())) legByBioguide.set(bio.toUpperCase(), leg);
    for (const f of (leg?.id?.fec || [])) { if (f && !legByFec.has(f)) legByFec.set(f, leg); }
  }
  const membersByBioguide = new Map();
  for (const m of members) { if (m.bioguideId) membersByBioguide.set(String(m.bioguideId).toUpperCase(), m); }

  const racesOut = [];
  for (const s of states) {
    for (const t of ['senate-general', 'senate-special']) {
      let snap;
      try { snap = await fetchJson(`https://votelog.org/data/${s}-${t}/snapshot.json`, 2); } catch (e) { continue; }
      if (!snap) continue;
      const race = snap.race || {};
      const stateCode = (race.state || s).toUpperCase();
      const stateKey = `US-${stateCode}`;
      const special = !!race.special;
      const raceType = special ? 'special' : 'regular';
      const senateClass = special ? (specialClass[stateCode] ?? null) : (regularClass2.has(stateCode) ? 2 : null);

      const ents = Object.entries(snap.entityLog || {}).filter(([k, v]) => v && v.candidateId && /^S/.test(String(v.candidateId)));
      const candInfos = [];
      for (const [key, v] of ents) {
        let info = null;
        try {
          const cj = await fetchJson(`https://api.open.fec.gov/v1/candidates/search/?api_key=${FEC_KEY}&candidate_id=${encodeURIComponent(v.candidateId)}`);
          info = (cj.results || [])[0] || null;
        } catch (e) { console.warn(`[SeedGen] FEC lookup failed for ${v.candidateId}: ${e.message}`); }
        await sleep(250);
        const fecIds = Array.from(new Set([v.candidateId, ...(v.aliasCandidateIds || [])])).filter(Boolean);
        const leg = legByFec.get(v.candidateId) || fecIds.map(id => legByFec.get(id)).find(Boolean) || null;
        const bioguide = leg?.id?.bioguide || null;
        const member = bioguide ? membersByBioguide.get(bioguide.toUpperCase()) : null;
        const name = properName(info?.name) || (member ? member.name : key.replace(/(^|\s)\S/g, c => c.toUpperCase()));
        candInfos.push({
          key, fecIds,
          party: partyCode(v.party || info?.party),
          name,
          bioguide,
          opensecrets: leg?.id?.opensecrets || null,
          member,
          incumbentChallenge: info?.incumbent_challenge || null
        });
      }

      if (candInfos.length < 1) continue;
      function score(c) {
        let sc = 0;
        if (c.member) sc += 10;
        if (c.member && c.member.currentMember) sc += 5;
        if (c.incumbentChallenge === 'I') sc += 4;
        if (c.bioguide) sc += 2;
        return sc;
      }
      candInfos.sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
      const subject = candInfos[0];
      const opponents = candInfos.slice(1).map(o => ({ name: o.name, party: o.party, fec_candidate_id: o.fecIds[0] || null }));

      const listed = !!subject.member || !!subject.bioguide;
      const subj = {
        name: subject.name,
        party: subject.party,
        incumbent: subject.incumbentChallenge === 'I' || !!(subject.member && subject.member.currentMember),
        won_race: true,
        fec_candidate_ids: subject.fecIds,
        votelog_slug: subject.key,
        votelog_listed: listed
      };
      if (subject.bioguide) subj.bioguide_id = subject.bioguide;
      if (subject.opensecrets) subj.opensecrets_cid = subject.opensecrets;

      racesOut.push({
        office_type: 'us_senate',
        election_year: 2026,
        state: stateKey,
        district: null,
        race_type: raceType,
        senate_class: senateClass,
        subject: subj,
        opponents_nov_general: opponents,
        _seed_meta: {
          source: 'auto-generated from VoteLog race snapshots + OpenFEC candidates + congress-legislators',
          votelog_data_slug: `${s}-${t}`,
          votelog_race_slug: race.slug || null,
          special,
          note: 'won_race set true for draft emission; verify certified winner/opponent set before finalizing.'
        }
      });
      console.log(`[SeedGen] ${stateKey} ${raceType} class ${senateClass}: subject=${subject.name} (${subject.party}) vs ${opponents.map(o => o.name).join(', ')}`);
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const r of racesOut) {
    const k = `${r.state}|${r.race_type}|${r.office_type}`;
    if (seen.has(k)) continue; seen.add(k); deduped.push(r);
  }

  const out = {
    _comment: 'Auto-generated seed for 2026 US Senate races (VoteLog snapshots + OpenFEC + congress-legislators). won_race=true enables draft emission; review/verify certified winners and opponent sets before finalizing. Vote/bounty text is fully synthesized by generate-vote-template.js from FEC finance data and IRS EO BMF charity shards.',
    generated_at: new Date().toISOString(),
    races: deduped
  };
  const outPath = path.join(process.cwd(), 'docs/data/beta/winners-seed-2026.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[SeedGen] Wrote ${deduped.length} races to ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
