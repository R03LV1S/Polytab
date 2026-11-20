#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const FEED_PATH = path.join(ROOT, 'docs', 'feed.json');
const VOTES_PATH = path.join(ROOT, 'docs', 'data', 'votes.json');
const ACTIVE_PATH = path.join(ROOT, '.opencode', 'cache', 'active_legislators.json');
const EXISTING_INDIV_PATH = path.join(ROOT, '.opencode', 'cache', 'existing_poe_individuals.json');
const DEDUPE_PATH = path.join(ROOT, '.opencode', 'cache', 'dedupe_result.json');
const VOTELOG_CACHE_DIR = path.join(ROOT, '.opencode', 'cache', 'votelog');

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p,v){ fs.writeFileSync(p, JSON.stringify(v,null,2)+'\n','utf8'); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function fetchText(url, timeoutMs=25000, redirectCount=0, maxBytes=2_000_000){
  const MAX_REDIRECTS = 5;
  const ALLOWED_HOST = 'votelog.org';
  return new Promise((resolve,reject)=>{
    let u;
    try { u = new URL(url); } catch(e){ return reject(new Error('invalid url')); }
    if (u.protocol !== 'https:' || u.hostname !== ALLOWED_HOST) {
      return reject(new Error(`blocked outbound target: ${u.protocol}//${u.hostname}`));
    }
    const req = https.get(u, {headers:{'User-Agent':'polytab-campaign-generator/1.0','Accept':'text/html,text/plain,*/*'}}, (res)=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        if (redirectCount >= MAX_REDIRECTS) { res.resume(); return reject(new Error('too many redirects')); }
        const loc = new URL(res.headers.location, u).toString();
        res.resume();
        return resolve(fetchText(loc, timeoutMs, redirectCount + 1, maxBytes));
      }
      let data='';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', c=>{
        bytes += Buffer.byteLength(c,'utf8');
        if (bytes > maxBytes) { req.destroy(new Error('response too large')); return; }
        data += c;
      });
      res.on('end', ()=>resolve({status:res.statusCode, data, url: u.toString(), finalUrl: u.toString()}));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, ()=>{ req.destroy(new Error('timeout')); });
  });
}

function safeBioguide(id){
  const s = String(id || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(s)) throw new Error(`invalid bioguide: ${id}`);
  return s;
}

function htmlToText(html){
  return String(html||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/p>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .replace(/\n +/g,'\n')
    .replace(/\n{2,}/g,'\n')
    .trim();
}

function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function slugifyName(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

function partyAbbrev(p, caucus){
  const s = String(p||'');
  if (s === 'Republican') return 'R';
  if (s === 'Democrat') return 'D';
  if (s === 'Independent') return caucus === 'Democrat' ? 'I' : 'I';
  return s ? s[0] : 'I';
}

function officeLabel(m){
  if (m.type === 'sen') return 'U.S. Senate';
  const d = m.district;
  if (d == null || d === 0) return `U.S. House (${m.state} At-Large)`;
  return `U.S. House (${m.state}-${String(d).padStart(2,'0')})`;
}

function seatIdKey(m){
  if (m.type === 'sen') return `sen-${m.state}`;
  const d = (m.district == null) ? 'AL' : String(m.district);
  return `rep-${m.state}-${d}`;
}

function votelogSlugCandidates(m){
  const st = String(m.state||'').toLowerCase();
  const first = slugifyName(m.first);
  const last = slugifyName(m.last);
  const nick = slugifyName(m.nickname);
  const official = slugifyName(m.official_full);
  const cands = new Set();
  if (first && last) cands.add(`${st}/${first}-${last}`);
  if (nick && last) cands.add(`${st}/${nick}-${last}`);
  if (last) cands.add(`${st}/${last}`);
  if (official) cands.add(`${st}/${official}`);
  // some known short forms
  if (last === 'ocasiocortez' || /ocasio/i.test(m.last||'')) cands.add(`${st}/alexandria-ocasio-cortez`);
  return Array.from(cands);
}

async function resolveVoteLogMember(m){
  ensureDir(VOTELOG_CACHE_DIR);
  const bio = safeBioguide(m.bioguide);
  const cachePath = path.join(VOTELOG_CACHE_DIR, `${bio}.json`);
  if (!cachePath.startsWith(VOTELOG_CACHE_DIR + path.sep)) throw new Error('cache path escape');
  if (fs.existsSync(cachePath)) {
    try { return readJson(cachePath); } catch(e){}
  }
  const cands = votelogSlugCandidates(m);
  let found = null;
  for (const slug of cands){
    const safeSlug = String(slug || '').replace(/[^a-z0-9\/-]/gi,'').replace(/^\/+|\/+$/g,'');
    if (!safeSlug) continue;
    const url = `https://votelog.org/members/${safeSlug}`;
    try {
      const r = await fetchText(url);
      if (r.status === 200 && /Full .* Voting Record|Israel\/Palestine|VoteLog/i.test(r.data)) {
        found = { slug: safeSlug, profileUrl: r.finalUrl || r.url, profileStatus: r.status, profileHtml: r.data };
        break;
      }
    } catch(e){}
    await sleep(250);
  }
  let allFunding = null;
  if (found) {
    const afUrl = `${found.profileUrl}/all-funding`;
    try {
      const r = await fetchText(afUrl);
      if (r.status === 200) allFunding = { url: r.finalUrl || r.url, status: r.status, html: r.data };
    } catch(e){}
  }
  const result = { bioguide: bio, resolvedAt: new Date().toISOString(), member: {official_full:m.official_full || null, first:m.first || null, last:m.last || null, state:m.state,type:m.type,district:m.district}, found, allFunding };
  // store parsed text only to keep cache smaller
  if (result.found) { result.found.text = htmlToText(result.found.profileHtml).slice(0,20000); delete result.found.profileHtml; }
  if (result.allFunding) { result.allFunding.text = htmlToText(result.allFunding.html).slice(0,20000); delete result.allFunding.html; }
  writeJson(cachePath, result);
  return result;
}

function parseFunding(vl){
  const out = { totalRaisedText:null, totalRaisedAmount:null, cycleText:null, allFundingSummary:null, pacCommitteeCount:null, syncDate:null };
  if (!vl || !vl.found) return out;
  const p = vl.found.text || '';
  // e.g. "Total raised: $4,024,636. Total spent: $4,051,556. Cash on hand: $407,001."
  const mRaised = p.match(/Total raised:\s*\$([0-9,]+)/i);
  if (mRaised) { out.totalRaisedText = mRaised[0]; out.totalRaisedAmount = Number(mRaised[1].replace(/,/g,'')); }
  const mCycle = p.match(/(20\d{2}) cycle,\s*source:\s*FEC[^.]*\./i);
  if (mCycle) out.cycleText = mCycle[0];
  const mSync = p.match(/Data last synced:\s*([0-9-]+)/i);
  if (mSync) out.syncDate = mSync[1];
  if (vl.allFunding && vl.allFunding.text) {
    const a = vl.allFunding.text;
    // "raised $7.2M from 213 PACs and committees"
    const mAf = a.match(/raised\s+(\$[0-9.,]+[KMB]?)\s+from\s+([0-9,]+)\s+PACs and committees/i);
    if (mAf) { out.allFundingSummary = mAf[0]; out.pacCommitteeCount = Number(mAf[2].replace(/,/g,'')); }
    const mSync2 = a.match(/Data last synced:\s*([0-9-]+)/i);
    if (mSync2 && !out.syncDate) out.syncDate = mSync2[1];
  }
  return out;
}

function formatMoney(n){
  if (!Number.isFinite(n)) return null;
  return '$' + n.toLocaleString('en-US');
}

async function main(){
  const args = process.argv.slice(2);
  const limit = (()=>{ const i=args.indexOf('--limit'); return i>=0 ? Number(args[i+1]||'0') : 0; })();
  const offset = (()=>{ const i=args.indexOf('--offset'); return i>=0 ? Number(args[i+1]||'0') : 0; })();
  const only = (()=>{ const i=args.indexOf('--bioguide'); return i>=0 ? String(args[i+1]||'') : ''; })();

  const feed = readJson(FEED_PATH);
  const dedupe = readJson(DEDUPE_PATH);
  let uncovered = dedupe.uncovered || [];
  if (only) uncovered = uncovered.filter(m=>m.bioguide===only);
  uncovered = uncovered.slice(offset || 0, limit ? (offset||0)+limit : undefined);

  console.log('processing uncovered members:', uncovered.length);
  const results = [];
  for (const m of uncovered){
    try {
      const vl = await resolveVoteLogMember(m);
      const funding = parseFunding(vl);
      results.push({ member: m, votelog: { resolved: !!(vl&&vl.found), profileUrl: vl&&vl.found?vl.found.profileUrl:null, allFundingUrl: vl&&vl.allFunding?vl.allFunding.url:null }, funding });
      console.log('ok', m.bioguide, m.official_full, funding.allFundingSummary || funding.totalRaisedText || '(no funding parsed)');
    } catch(e){
      console.error('err', m.bioguide, e.message);
      results.push({ member: m, error: e.message });
    }
    await sleep(350);
  }
  const outPath = path.join(ROOT, '.opencode', 'cache', 'generated_members_funding_batch.json');
  writeJson(outPath, results);
  console.log('wrote', outPath, results.length);
}

if (require.main === module) {
  main().catch(e=>{ console.error(e); process.exit(1); });
}
