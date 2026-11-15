#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const files = [
  'summary.json',
  'snapshot.json',
  'superpac-donors.csv',
  'expenditure-ledger.csv',
  'pre-primary-ledger.csv',
  'aipac-network-donors.csv'
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchToFile(url, outPath) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Polytab-VoteLog-Download/1.0' } });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { ok: true, status: res.status, bytes: buf.length };
}

(async () => {
  const repoRoot = process.cwd();
  const seedPath = path.join(repoRoot, 'docs/data/beta/winners-seed-2026.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const slugs = seed.races.map(r => r._seed_meta && r._seed_meta.votelog_data_slug).filter(Boolean);
  const baseOut = path.join(repoRoot, 'docs/data/beta/votelog');
  fs.mkdirSync(baseOut, { recursive: true });
  const manifest = { downloaded_at: new Date().toISOString(), races: [] };

  for (const slug of slugs) {
    const raceOut = path.join(baseOut, slug);
    const entry = { slug, files: {} };
    console.log(`[DL] ${slug}`);
    for (const f of files) {
      const url = `https://votelog.org/data/${slug}/${f}`;
      const outPath = path.join(raceOut, f);
      try {
        const r = await fetchToFile(url, outPath);
        entry.files[f] = r;
        if (r.ok) console.log(`  ok ${f} (${r.bytes} bytes)`); else console.log(`  skip ${f} (${r.status})`);
      } catch (e) {
        entry.files[f] = { ok: false, error: e.message };
        console.log(`  err ${f}: ${e.message}`);
      }
      await sleep(120);
    }
    manifest.races.push(entry);
  }

  const manifestPath = path.join(baseOut, 'download-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[DL] Wrote manifest ${manifestPath} for ${slugs.length} races`);
})().catch(e => { console.error(e); process.exit(1); });
