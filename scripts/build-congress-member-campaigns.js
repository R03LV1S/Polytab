#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FEED_PATH = path.join(ROOT, 'docs', 'feed.json');
const VOTES_PATH = path.join(ROOT, 'docs', 'data', 'votes.json');
const CACHE_DIR = path.join(ROOT, '.opencode', 'cache');
const VOTELOG_CACHE_DIR = path.join(CACHE_DIR, 'votelog');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p,v){ fs.writeFileSync(p, JSON.stringify(v,null,2)+'\n','utf8'); }

const NATIONAL_RECIPIENTS = 'MEMORIAL HERMANN HEALTH SYSTEM (US-EIN:741152597); STORMONT-VAIL HEALTHCARE INC (US-EIN:480543789); CENTRAL IOWA HOSPITAL CORPORATION (US-EIN:420680452); ADVANCED TECHNOLOGY INTERNATIONAL (US-EIN:571067151); CLEVELAND CLINIC FOUNDATION (US-EIN:912153073)';

function loadRecipientsByState(){
  const p = path.join(CACHE_DIR, 'recipients_by_state.json');
  if (fs.existsSync(p)) return readJson(p);
  return {};
}

function partyAbbrev(p, caucus){
  const s = String(p||'');
  if (s === 'Republican') return 'R';
  if (s === 'Democrat') return 'D';
  if (s === 'Independent') return (caucus === 'Democrat' ? 'I' : 'I');
  return s ? s[0] : 'I';
}

function partyDisplay(p, caucus){
  const s = String(p||'');
  if (s === 'Independent' && caucus === 'Democrat') return 'Independent';
  return s || 'Independent';
}

function memberDisplayName(m){
  const fromOfficial = String((m && m.official_full) || '').trim();
  if (fromOfficial) return fromOfficial;
  const parts = [m && m.first, m && m.middle, m && m.last, m && m.suffix].filter(Boolean).map(x=>String(x).trim()).filter(Boolean);
  const joined = parts.join(' ').trim();
  return joined;
}

function sanitizeInline(s, max=300){
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

function isTerritory(st){ return ['AS','DC','GU','MP','PR','VI'].includes(String(st||'').toUpperCase()); }
function territoryOfficeLabel(m){
  return String(m.state||'').toUpperCase() === 'PR' ? 'U.S. House Resident Commissioner' : 'U.S. House Delegate';
}
function officeLabel(m){
  if (m.type === 'sen') return 'U.S. Senate';
  if (isTerritory(m.state)) return territoryOfficeLabel(m);
  const d = m.district;
  if (d == null || d === 0) return 'U.S. House (At-Large)';
  return `U.S. House (${m.state}-${String(d).padStart(2,'0')})`;
}
function shortOfficeLabel(m){
  if (m.type === 'sen') return 'U.S. Senate';
  if (isTerritory(m.state)) return territoryOfficeLabel(m);
  const d = m.district;
  if (d == null || d === 0) return 'U.S. House At-Large';
  return `U.S. House ${m.state}-${String(d).padStart(2,'0')}`;
}
function districtLocation(m){
  if (m.type === 'sen') return `${m.state}, USA`;
  if (isTerritory(m.state)) return `${m.state}, USA`;
  const d = m.district;
  if (d == null || d === 0) return `${m.state} At-Large, USA`;
  return `${m.state}-${String(d).padStart(2,'0')}, USA`;
}
function titleLoc(m){
  if (m.type === 'sen') return `${m.state}`;
  if (isTerritory(m.state)) return `${m.state} ${territoryOfficeLabel(m).replace('U.S. House ','')}`;
  const d = m.district;
  if (d == null || d === 0) return `${m.state} At-Large`;
  return `${m.state}-${String(d).padStart(2,'0')}`;
}
function bountyId(m){
  const st = String(m.state||'').toLowerCase();
  const bio = String(m.bioguide||'').toLowerCase();
  if (m.type === 'sen') return `2026-us_senate-us-${st}-${bio}-active-member-accountability`;
  if (isTerritory(m.state)) {
    const seat = String(m.state||'').toUpperCase() === 'PR' ? 'resident-commissioner' : 'delegate';
    return `2026-us_house-us-${st}-${seat}-${bio}-active-member-accountability`;
  }
  const d = (m.district == null || m.district === 0) ? 'atlarge' : String(m.district).padStart(2,'0');
  return `2026-us_house-us-${st}-${d}-${bio}-active-member-accountability`;
}

function parseFundingFromCache(bioguide){
  const bio = String(bioguide || '');
  if (!/^[A-Z0-9]{4,10}$/i.test(bio)) return null;
  const p = path.join(VOTELOG_CACHE_DIR, `${bio.toUpperCase()}.json`);
  const fallback = path.join(VOTELOG_CACHE_DIR, `${bio}.json`);
  const fp = fs.existsSync(p) ? p : (fs.existsSync(fallback) ? fallback : null);
  if (!fp) return null;
  try {
    const vl = readJson(fp);
    if (!vl || !vl.found) return { votelog: vl };
    const txt = sanitizeInline(vl.found.text || '', 20000);
    const aft = sanitizeInline((vl.allFunding && vl.allFunding.text) || '', 20000);
    const funding = {
      profileUrl: vl.found.profileUrl,
      allFundingUrl: vl.allFunding ? vl.allFunding.url : null,
      syncDate: null,
      totalRaisedAmount: null,
      totalRaisedText: null,
      cycleText: null,
      allFundingSummary: null,
      pacCommitteeCount: null
    };
    const mRaised = txt.match(/Total raised:\s*\$([0-9,]+)/i);
    if (mRaised) { funding.totalRaisedAmount = Number(mRaised[1].replace(/,/g,'')); funding.totalRaisedText = sanitizeInline(mRaised[0], 80); }
    const mCycle = txt.match(/(20\d{2}) cycle,\s*source:\s*FEC[^.]*\./i);
    if (mCycle) funding.cycleText = sanitizeInline(mCycle[0], 120);
    const mSync = txt.match(/Data last synced:\s*([0-9-]+)/i) || aft.match(/Data last synced:\s*([0-9-]+)/i);
    if (mSync && /^\d{4}-\d{2}-\d{2}$/.test(mSync[1])) funding.syncDate = mSync[1];
    const mAf = aft.match(/raised\s+(\$[0-9.,]+[KMBkmb]?)\s+from\s+([0-9,]+)\s+PACs and committees/i);
    if (mAf) { funding.allFundingSummary = sanitizeInline(mAf[0], 120); funding.pacCommitteeCount = Number(mAf[2].replace(/,/g,'')); }
    return { votelog: vl, funding };
  } catch(e){ return null; }
}

function fmtUSD(n){
  if (!Number.isFinite(n)) return null;
  return '$' + n.toLocaleString('en-US');
}

function normalizeMoneyToken(tok){
  // "$7.2M" -> "$7.2M" keep; "$1,234,567" -> keep
  return tok;
}

function buildFundingNarrative(f){
  const parts = [];
  if (f && f.allFundingSummary) {
    parts.push(`${f.allFundingSummary} in tracked campaign funding per VoteLog (FEC-sourced public ledger${f.syncDate ? ', synced ' + f.syncDate : ''})`);
  }
  if (f && f.totalRaisedAmount && f.cycleText) {
    parts.push(`including ${fmtUSD(f.totalRaisedAmount)} reported raised in the ${f.cycleText.replace(/\.$/,'')}`);
  } else if (f && f.totalRaisedAmount && !parts.length) {
    parts.push(`has ${fmtUSD(f.totalRaisedAmount)} in reported campaign funding per VoteLog (FEC-sourced public ledger${f.syncDate ? ', synced ' + f.syncDate : ''})`);
  }
  if (!parts.length) {
    parts.push('has campaign-funding records tracked by VoteLog (FEC-sourced public ledger; see member profile for totals and sources)');
  }
  return parts.join(', ');
}

function buildTitle(m, fundingInfo){
  const p = partyAbbrev(m.party, m.caucus);
  const office = officeLabel(m);
  const loc = titleLoc(m);
  const name = memberDisplayName(m);
  if (!name) throw new Error(`missing member name for ${m.bioguide || 'unknown'}`);
  const fundingNarr = sanitizeInline(buildFundingNarrative(fundingInfo && fundingInfo.funding), 500);
  return `[US-${loc} - ${office}]: ${name} (${p}) ${fundingNarr}. Do you vote to formally rebuke ${name} for prioritizing donor and special-interest influence over constituents and failing to uphold core civic duties?`;
}

function pickRecipients(state, recipientsByState){
  if (recipientsByState[state]) return { text: recipientsByState[state], scope: 'state', state };
  return { text: NATIONAL_RECIPIENTS, scope: 'national', state };
}

function buildCampaignItem(m, newId, recipientsByState, nowIso){
  const p = partyAbbrev(m.party, m.caucus);
  const fundingInfo = parseFundingFromCache(m.bioguide);
  const funding = fundingInfo && fundingInfo.funding;
  const profileUrl = (funding && funding.profileUrl) || `https://votelog.org/members`;
  const name = memberDisplayName(m);
  if (!name) throw new Error(`missing member name for ${m.bioguide || 'unknown'}`);
  const office = officeLabel(m);
  const rec = pickRecipients(m.state, recipientsByState);
  const orgName = `${name} (${p}-${m.state}) Accountability Pool`;
  const title = buildTitle(m, fundingInfo);
  const servingText = rec.scope === 'state' ? `serving ${m.state}` : 'serving the United States (national verified fallback list)';
  const fundLead = rec.scope === 'state' ? `Community Fund for ${m.state}:` : `Community Fund for ${m.state} constituents:`;
  const summary = `${fundLead} Delivers 100% of funds to verified, IRS-registered 501(c)(3) public charities ${servingText} dedicated to community health, resilience, and public-benefit services. Verified recipients: ${rec.text}. Once the pool hits $5,000, a 60-day timer starts. If YES wins, funds go to these verified charities; if NO wins, funds go to local community commons (volunteer fire/EMS, veterans, community food banks). Funding context sourced from VoteLog/FEC public records${profileUrl ? `: ${profileUrl}` : ''}.`;
  const plain = `Resolution: Official censure & accountability sanction for ${name} (${m.state} ${shortOfficeLabel(m)}).\nFunding context: ${buildFundingNarrative(funding)} (source: VoteLog/FEC public ledger${profileUrl ? `, ${profileUrl}` : ''}).\nTimer: Starts a 60-day countdown once $5,000 is reached in community votes.\nOutcome: If YES wins, 100% goes to verified charities; if NO wins, 100% goes to essential community services (fire/EMS/veterans/food banks).`;
  const loc = districtLocation(m);
  const idStr = String(newId);
  const positionA = {
    key: 'A',
    label: 'Censure / Rebuke (Yes — hold accountable)',
    shortLabel: 'Censure / Rebuke',
    description: `Back formal rebuke/censure and accountability for ${name} as stated in this resolution.`,
    intent: 'censure_rebuke',
    beneficiary: { type: 'campaign_escrow', organization: orgName, wallet: null },
    settlement: { mode: 'unified_escrow', walletSource: 'escrow' }
  };
  const positionB = {
    key: 'B',
    label: 'Exonerate / Reject censure (No)',
    shortLabel: 'Reject censure',
    description: `Oppose this rebuke/censure and reject the proposed sanction for ${name} as stated in this resolution.`,
    intent: 'exonerate_reject_censure',
    beneficiary: { type: 'campaign_escrow', organization: orgName, wallet: null },
    settlement: { mode: 'unified_escrow', walletSource: 'escrow' }
  };
  return {
    id: idStr,
    title,
    content_html: `<p>${summary.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`,
    url: `https://polytab.store/project.html?id=${idStr}`,
    date_published: nowIso,
    _polytab: {
      bounty_id: bountyId(m),
      category: 'Public Office & Elections',
      organization: orgName,
      location: loc,
      summary,
      plainSummary: plain,
      votePriceUSD: 0.5,
      targetUSD: null,
      activation_threshold_usd: 5000,
      settlement_epoch_days: 60,
      fundedUSD: 0,
      votesCount: 0,
      contract: '0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08',
      status: 'Active',
      campaignType: 'open_ended',
      lat: null,
      lng: null,
      website: profileUrl,
      socials: {},
      parentCategory: 'Voting',
      voteMode: 'binary_referendum',
      positions: [positionA, positionB],
      positionAccounting: { version: 1, positions: { A: { fundedUSD: 0, votesCount: 0 }, B: { fundedUSD: 0, votesCount: 0 } }, total: { fundedUSD: 0, votesCount: 0 } },
      selectionPolicy: { requiresSelection: true, multiSelect: false }
    }
  };
}

function main(){
  const args = process.argv.slice(2);
  const limit = (()=>{ const i=args.indexOf('--limit'); return i>=0 ? Number(args[i+1]||'0') : 0; })();
  const only = (()=>{ const i=args.indexOf('--bioguide'); return i>=0 ? String(args[i+1]||'') : ''; })();
  const write = args.includes('--write');
  const dedupe = readJson(path.join(CACHE_DIR, 'dedupe_result.json'));
  const recipientsByState = loadRecipientsByState();
  let uncovered = dedupe.uncovered || [];
  if (only) uncovered = uncovered.filter(m=>m.bioguide===only);
  if (limit) uncovered = uncovered.slice(0, limit);
  const feed = readJson(FEED_PATH);
  // POE campaigns live in 92xxx range; continue after highest existing 92xxx id
  const maxPoeId = Math.max(...feed.items.filter(i=>String(i.id).startsWith('92')).map(i=>Number(i.id)).filter(Number.isFinite));
  let nextId = (Number.isFinite(maxPoeId) ? maxPoeId : 92044) + 1;
  const nowIso = new Date().toISOString();
  const newItems = uncovered.map(m => buildCampaignItem(m, nextId++, recipientsByState, nowIso));
  for (const it of newItems) {
    const blob = JSON.stringify(it);
    if (/\bundefined\b/.test(blob) || /"organization":"\s*\(/.test(blob)) {
      throw new Error(`refusing to write corrupted item ${it.id}`);
    }
  }
  const outPath = path.join(CACHE_DIR, 'generated_congress_campaigns.json');
  writeJson(outPath, newItems);
  console.log('generated', newItems.length, 'starting at', (Number.isFinite(maxPoeId) ? maxPoeId : 92044) + 1, 'wrote', outPath);
  if (write && newItems.length){
    // avoid duplicates by id
    const existingIds = new Set(feed.items.map(i=>String(i.id)));
    const toAdd = newItems.filter(i=>!existingIds.has(String(i.id)));
    feed.items.push(...toAdd);
    writeJson(FEED_PATH, feed);
    // add votes scaffolding
    const votes = readJson(VOTES_PATH);
    for (const it of toAdd){
      const id = String(it.id);
      if (!votes[id]) votes[id] = { total_votes: 0, total_raised_usd: 0, records: [], voteMode: 'binary_referendum', positions: { A:{total_votes:0,total_raised_usd:0,records:[]}, B:{total_votes:0,total_raised_usd:0,records:[]} } };
    }
    writeJson(VOTES_PATH, votes);
    console.log('merged into feed/votes:', toAdd.length);
  }
}

if (require.main === module) main();
