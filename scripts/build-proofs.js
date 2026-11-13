#!/usr/bin/env node
// Build docs/data/proofs.json - public, GitHub-based proof/spending updates.
// Source of truth: GitHub Issues labeled "proof" in R03LV1S/Polytab.
// Honest: only includes proofs matched to canonical project IDs in docs/feed.json.
// $0: GitHub REST API (GITHUB_TOKEN in Actions for higher rate limits).
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = process.env.GITHUB_REPOSITORY_OWNER || 'R03LV1S';
const REPO = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : 'Polytab';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const LABEL = 'proof';
const FEED_PATH = path.join(__dirname, '..', 'docs', 'feed.json');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'proofs.json');

function readJson(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return JSON.parse(s);
}

function loadValidIds() {
  try {
    const feed = readJson(FEED_PATH);
    const ids = new Set();
    for (const it of (feed.items || [])) { if (it && it.id != null) ids.add(String(it.id)); }
    return ids;
  } catch (e) {
    console.error('Could not read feed.json:', e.message);
    return null;
  }
}

function apiGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent': 'polytab-proofs-builder', 'Accept': 'application/vnd.github+json' };
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const req = https.get(u, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ data: JSON.parse(body || '[]'), headers: res.headers }); }
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
  for (const p of String(linkHeader).split(',')) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function getFormField(body, label) {
  const s = String(body || '');
  // GitHub issue forms render: ### Label\n\nvalue
  const re = new RegExp('###\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|$)', 'i');
  const m = s.match(re);
  if (!m) return '';
  let v = m[1].trim();
  if (v === '_No response_') return '';
  return v;
}

function extractUrls(text) {
  const urls = new Set();
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let m; const s = String(text || '');
  while ((m = re.exec(s)) !== null) {
    let u = m[0].replace(/[),.;]+$/, '');
    urls.add(u);
  }
  return Array.from(urls);
}

function extractImages(text) {
  const imgs = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m; const s = String(text || '');
  while ((m = re.exec(s)) !== null) imgs.push(m[1]);
  // also GitHub user-attachments direct image links often appear as plain urls
  for (const u of extractUrls(s)) {
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(u) || /user-attachments\/assets\//i.test(u)) imgs.push(u);
  }
  return Array.from(new Set(imgs));
}

function extractProjectId(issue) {
  const body = String((issue && issue.body) || '');
  const f = getFormField(body, 'Project ID');
  if (f && /^\d{1,10}$/.test(f.trim())) return f.trim();
  // JSON fallback
  const objRe = /\{[\s\S]*?"(?:project_id|bounty_id)"[\s\S]*?\}/g;
  let om;
  while ((om = objRe.exec(body)) !== null) {
    try { const j = JSON.parse(om[0]); const id = j.project_id != null ? j.project_id : j.bounty_id; if (id != null) return String(id).trim(); } catch (_) {}
  }
  const title = String((issue && issue.title) || '');
  const tm = title.match(/#(\d{1,10})\b/);
  if (tm) return tm[1];
  const bm = body.match(/\b(?:project_id|bounty_id)["']?\s*[:=]\s*["']?(\d{1,10})/i);
  if (bm) return bm[1];
  return null;
}

async function fetchAllProofIssues() {
  const issues = [];
  let url = `https://api.github.com/repos/${OWNER}/${REPO}/issues?labels=${encodeURIComponent(LABEL)}&state=all&per_page=100&sort=created&direction=desc`;
  let page = 0;
  while (url) {
    page++;
    const { data, headers } = await apiGet(url);
    if (!Array.isArray(data)) break;
    for (const it of data) { if (it && !it.pull_request) issues.push(it); }
    url = parseNextLink(headers.link);
    if (page > 50) break;
  }
  return issues;
}

async function main() {
  const validIds = loadValidIds();
  if (!validIds) { console.error('Aborting: cannot validate project IDs.'); process.exit(1); }

  let issues = [];
  try { issues = await fetchAllProofIssues(); }
  catch (e) { console.error('Failed to fetch proof issues:', e.message); process.exit(1); }

  const byProject = {};
  let considered = 0, accepted = 0, invalid = 0;
  for (const issue of issues) {
    considered++;
    const pid = extractProjectId(issue);
    if (!pid || !validIds.has(String(pid))) { invalid++; continue; }
    const body = String(issue.body || '');
    const summary = getFormField(body, 'Summary') || String(issue.title || '').replace(/^\[Proof\]:\s*/i, '');
    const proofType = getFormField(body, 'Proof Type') || 'Update';
    const details = getFormField(body, 'Details / How funds were spent') || '';
    const evidence = getFormField(body, 'Evidence (links, attachments, images)') || '';
    const amount = getFormField(body, 'Amount (USD, if applicable)');
    const date = getFormField(body, 'Date');
    const tx = getFormField(body, 'Transaction hash / release reference (if applicable)');
    const beneficiary = getFormField(body, 'Benefactor / recipient (optional)');
    const urls = extractUrls(evidence + '\n' + body);
    const images = extractImages(evidence + '\n' + body);
    const entry = {
      issue_number: issue.number,
      issue_url: issue.html_url,
      project_id: String(pid),
      title: summary,
      type: proofType,
      details: details || null,
      amount: amount || null,
      date: date || null,
      tx_hash: tx || null,
      beneficiary: beneficiary || null,
      links: urls,
      images: images,
      state: issue.state, // open/closed
      author: issue.user && issue.user.login ? issue.user.login : null,
      created_at: issue.created_at || null,
      updated_at: issue.updated_at || null
    };
    if (!byProject[pid]) byProject[pid] = [];
    byProject[pid].push(entry);
    accepted++;
  }

  const out = {
    version: 1,
    updated_at: new Date().toISOString(),
    source: { type: 'github_issues', repository: `${OWNER}/${REPO}`, label: LABEL },
    integrity: { counts_fabricated: false, note: 'Proof entries are sourced from public GitHub issues matched to canonical project IDs. Review issue state/contents for verification status.' },
    stats: { issues_considered: considered, proofs_accepted: accepted, invalid_or_unmatched: invalid, projects_with_proofs: Object.keys(byProject).length },
    projects: byProject
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`proofs: ${accepted} accepted across ${Object.keys(byProject).length} projects (from ${considered} issues, ${invalid} invalid/unmatched) -> ${OUT_PATH}`);
}

main();