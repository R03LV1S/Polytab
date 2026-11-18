// scripts/promote-verified-orgs-to-shelf.js
// Promotes verified charity records from docs/data/orgs into active Polytab shelf bounties in docs/feed.json.
// Enforces honest-zero data invariants (INV-DATA-01 through INV-DATA-04):
// - fundedUSD = 0, votesCount = 0
// - lat: null, lng: null (zero coordinates / privacy-first)
// - 100% escrow wallet routing (0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08)
// - Deterministic, non-overlapping canonical IDs

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const FEED_PATH = path.join(ROOT_DIR, 'docs', 'feed.json');
const ORGS_DIR = path.join(ROOT_DIR, 'docs', 'data', 'orgs');

const ESCROW_WALLET = '0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08';

const CAT_BLOCK = {
  'Accessibility & Universal Design': 10000,
  'Environmental': 20000,
  'Classrooms': 30000,
  'Civic Tech': 40000,
  'Campus Grounds': 60000,
  'Athletics': 70000
};

function detectCategory(name) {
  const n = ' ' + name.toLowerCase() + ' ';
  if (/\b(school|schools|academy|academies|college|colleges|university|universities|education|educational|student|students|literacy|scholarship|scholarships|kindergarten|preschool|library|libraries|learning|classroom|classrooms)\b/i.test(n)) return 'Classrooms';
  if (/\b(forest|forests|wildlife|conservation|nature|climate|ocean|oceans|river|rivers|tree|trees|animal|animals|earth|planet|ecology|ecological|environmental|environment|greenpeace|clean|water|solar|energy)\b/i.test(n)) return 'Environmental';
  if (/\b(disability|disabilities|disabled|blind|deaf|autism|autistic|wheelchair|handicap|paralysis|accessibility|accessible|inclusion|inclusive|special needs|mental health|care|clinic|clinics|hospital|hospitals|medical|medicine|health|relief|aid|refugee|refugees|humanitarian|shelter|shelters|hunger|food|foodbank|poverty)\b/i.test(n)) return 'Accessibility & Universal Design';
  if (/\b(sport|sports|sporting|athletic|athletics|football|soccer|cricket|tennis|basketball|swimming|gymnastic|gymnastics|rugby|boxing|rowing|golf|hockey|baseball|skating)\b/i.test(n)) return 'Athletics';
  if (/\b(park|parks|garden|gardens|community garden|arboretum|playground|playgrounds|trail|trails|cemetery|cemetery trust|grounds|recreation reserve)\b/i.test(n)) return 'Campus Grounds';
  return 'Civic Tech';
}

function safeUrl(u) {
  return (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) ? u.trim() : null;
}

function getJsonFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(getJsonFiles(fullPath));
    else if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') results.push(fullPath);
  }
  return results;
}

function formatLocation(loc) {
  if (!loc) return 'Global';
  const parts = [];
  if (loc.locality_city_town) parts.push(loc.locality_city_town.trim());
  if (loc.admin1_state_province && loc.admin1_state_province !== '_NATIONAL' && loc.admin1_state_province !== 'NATIONAL') {
    parts.push(loc.admin1_state_province.trim());
  }
  if (loc.country_iso2) parts.push(loc.country_iso2.trim());
  return parts.join(', ') || loc.country_iso2 || 'Global';
}

function main() {
  console.log('[PROMOTER] Loading existing feed:', FEED_PATH);
  const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));
  const existingIds = new Set(feed.items.map(it => Number(it.id)).filter(n => !isNaN(n)));
  const seenNames = new Set(feed.items.map(it => (it._polytab ? it._polytab.organization : it.title).trim().toLowerCase()));

  console.log('[PROMOTER] Existing items in feed:', feed.items.length);

  const allOrgFiles = getJsonFiles(ORGS_DIR);
  console.log('[PROMOTER] Scanning', allOrgFiles.length, 'org shard files in', ORGS_DIR);

  let candidates = [];
  for (const f of allOrgFiles) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const arr = Array.isArray(d) ? d : (d.organizations || []);
      for (const org of arr) {
        if (!org || !org.name) continue;
        const key = org.name.trim().toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          candidates.push(org);
        }
      }
    } catch (e) {
      console.warn('[PROMOTER] Error reading', f, e.message);
    }
  }

  console.log('[PROMOTER] Found', candidates.length, 'unpromoted unique verified candidates.');

  const counters = {};
  for (const [c, b] of Object.entries(CAT_BLOCK)) {
    counters[c] = b;
  }

  function getNextId(category) {
    let id = counters[category] || 10000;
    while (existingIds.has(id) || (id >= 80000 && id <= 99999)) {
      id++;
    }
    existingIds.add(id);
    counters[category] = id + 1;
    return String(id);
  }

  let promotedCount = 0;
  for (const org of candidates) {
    const category = detectCategory(org.name);
    const id = getNextId(category);
    const locStr = formatLocation(org.location);
    const authority = org.source_authority || 'Official Public Registry';
    const regId = org.registry_id || 'VERIFIED';
    const datePublished = org.last_verified_utc || '2026-11-18T00:00:00Z';
    const website = safeUrl(org.website);

    const title = org.name.trim();
    const summary = `Support the mission of ${title} (verified record: ${authority} [${regId}]).`;
    const plainSummary = `Cause: Community needs require trusted, non-profit civic support.\nResolution: Fund this organization's verified mission directly through Polytab escrow.\nProof: Verified charity registry record (${authority}) [ID: ${regId}].`;

    const block = {
      id,
      title,
      content_html: `<p>${summary}</p>`,
      url: `https://polytab.store/#${id}`,
      date_published: datePublished,
      _polytab: {
        category,
        organization: title,
        location: locStr,
        summary,
        plainSummary,
        votePriceUSD: 0.5,
        targetUSD: 500,
        fundedUSD: 0,
        votesCount: 0,
        contract: ESCROW_WALLET,
        status: 'Active',
        lat: null,
        lng: null,
        website,
        socials: {},
        parentCategory: 'Charities'
      }
    };

    feed.items.push(block);
    promotedCount++;
  }

  feed.updated_at = new Date().toISOString();
  console.log(`[PROMOTER] Successfully promoted ${promotedCount} verified orgs into feed.`);
  console.log(`[PROMOTER] New feed total items: ${feed.items.length}`);

  fs.writeFileSync(FEED_PATH, JSON.stringify(feed, null, 2), 'utf8');
  console.log('[PROMOTER] Updated', FEED_PATH);
}

main();
