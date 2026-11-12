// Build docs/data/endorsements.json — verifiable, anti-spam global endorsement snapshot.
// Source of truth: GitHub Issues labeled "endorsement" in R03LV1S/Polytab.
// Count = unique GitHub user logins per canonical shelf bounty_id (deduped). Honest: never fabricated.
// $0: uses GitHub REST API (GITHUB_TOKEN in Actions for higher rate limits; public read otherwise).
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = process.env.GITHUB_REPOSITORY_OWNER || 'R03LV1S';
const REPO = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : 'Polytab';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const LABEL = 'endorsement';
const FEED_PATH = path.join(__dirname, '..', 'docs', 'feed.json');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'endorsements.json');

function readJson(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return JSON.parse(s);
}

function loadValidIds() {
  try {
    const feed = readJson(FEED_PATH);
    const ids = new Set();
    for (const it of (feed.items || [])) {
      if (it && it.id != null) ids.add(String(it.id));
    }
    return ids;
  } catch (e) {
    console.error('Could not read feed.json:', e.message);
    return null; // fail honest/closed: do not emit unvalidated counts
  }
}

function apiGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      'User-Agent': 'polytab-endorsements-builder',
      'Accept': 'application/vnd.github+json'
    };
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const req = https.get(u, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ data: JSON.parse(body || '[]'), headers: res.headers, status: res.statusCode }); }
          catch (e) { reject(new Error('Invalid JSON from GitHub: ' + e.message)); }
        } else {
          reject(new Error('GitHub API ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
  });
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = String(linkHeader).split(',');
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function extractBountyId(issue) {
  const body = String((issue && issue.body) || '');
  // Prefer fenced/inline JSON with bounty_id
  const jsonBlocks = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fm;
  while ((fm = fenceRe.exec(body)) !== null) jsonBlocks.push(fm[1]);
  // also try to find a JSON object substring
  const objRe = /\{[\s\S]*?"bounty_id"[\s\S]*?\}/g;
  let om;
  while ((om = objRe.exec(body)) !== null) jsonBlocks.push(om[0]);
  for (const cand of jsonBlocks) {
    try {
      const j = JSON.parse(cand.trim());
      if (j && j.bounty_id != null) return String(j.bounty_id).trim();
    } catch (_) {}
  }
  // Fallback: title like [Endorse]: #12345 or #12345
  const title = String((issue && issue.title) || '');
  const tm = title.match(/#(\d{1,10})\b/);
  if (tm) return tm[1];
  const bm = body.match(/\bbounty_id["']?\s*[:=]\s*["']?(\d{1,10})/i);
  if (bm) return bm[1];
  return null;
}

async function fetchAllEndorsementIssues() {
  const issues = [];
  let url = `https://api.github.com/repos/${OWNER}/${REPO}/issues?labels=${encodeURIComponent(LABEL)}&state=all&per_page=100&sort=created&direction=asc`;
  let page = 0;
  while (url) {
    page++;
    const { data, headers } = await apiGet(url);
    if (!Array.isArray(data)) break;
    for (const it of data) {
      // /issues returns PRs too; PRs have pull_request key
      if (it && it.pull_request) continue;
      issues.push(it);
    }
    url = parseNextLink(headers.link);
    if (page > 50) break; // safety cap
  }
  return issues;
}

async function main() {
  const validIds = loadValidIds();
  if (!validIds) {
    console.error('Aborting: cannot validate bounty IDs (honest, no snapshot written).');
    process.exit(1);
  }

  let issues = [];
  try {
    issues = await fetchAllEndorsementIssues();
  } catch (e) {
    console.error('Failed to fetch endorsement issues:', e.message);
    // If we cannot read the ledger, do not fabricate: exit non-zero so workflow won't commit a fake empty state.
    process.exit(1);
  }

  // dedupe: unique (bounty_id, login)
  const seen = new Set();
  const counts = {}; // bounty_id -> count
  let considered = 0, accepted = 0, invalid = 0, duplicates = 0;
  for (const issue of issues) {
    considered++;
    const bid = extractBountyId(issue);
    const login = issue && issue.user && issue.user.login ? String(issue.user.login).toLowerCase() : null;
    if (!bid || !validIds.has(String(bid))) { invalid++; continue; }
    if (!login) { invalid++; continue; }
    const key = String(bid) + '|' + login;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    counts[String(bid)] = (counts[String(bid)] || 0) + 1;
    accepted++;
  }

  // stable, honest artifact referencing canonical shelf IDs
  const totals = {};
  const idsSorted = Object.keys(counts).sort((a,b) => (parseInt(a,10)-parseInt(b,10)));
  for (const id of idsSorted) totals[id] = { count: counts[id] };

  const out = {
    version: 1,
    updated_at: new Date().toISOString(),
    source: {
      type: 'github_issues',
      repository: `${OWNER}/${REPO}`,
      label: LABEL,
      method: 'unique_github_users_per_bounty_id',
      canonical_id_format: 'shelf numeric compartmentalized string id (docs/feed.json)'
    },
    integrity: {
      dedupe_key: 'bounty_id + user.login (case-insensitive)',
      ignores: ['issues missing/invalid bounty_id or not in feed', 'duplicate user per bounty', 'pull requests'],
      counts_fabricated: false
    },
    stats: { issues_considered: considered, endorsements_accepted: accepted, invalid_or_unmatched: invalid, duplicates_ignored: duplicates },
    totals
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`endorsements: ${accepted} accepted unique endorsements across ${Object.keys(totals).length} bounties (from ${considered} issues, ${duplicates} duplicates, ${invalid} invalid/unmatched) -> ${OUT_PATH}`);
}

main();
