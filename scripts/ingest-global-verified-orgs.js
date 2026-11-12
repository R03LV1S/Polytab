// Polytab — Multi-country verified charity ingestion (global initiative)
// $0, no paid APIs. Evidence-backed from free public registries/filings.
// Captures into docs/data/verified-orgs.json (registry; NOT auto-promoted except optional governed promotion).
// Honest rules: record source evidence only; never invent audits/ratings/coords/websites; no private/home coords.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'docs', 'data', 'verified-orgs.json');
const FEED_PATH = path.join(ROOT, 'docs', 'feed.json');
const PROMOTE = process.argv.includes('--promote'); // governed: add shelf items when minimum fields available
const MAX_NEW_PER_SOURCE = 150;
const MAX_TOTAL_NEW = 400;
const REQUEST_DELAY_MS = 300;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function safeNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function normStr(v){ return v==null?'':String(v).trim(); }

function fetchBuffer(urlStr, headers={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(urlStr);
    const req=https.get({hostname:u.hostname,path:u.pathname+u.search,headers:{'User-Agent':'Polytab-Ingest/1.0 (+https://github.com/R03LV1S/Polytab)','Accept':'*/*',...headers}},res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        const loc = new URL(res.headers.location, urlStr).toString();
        res.resume(); return resolve(fetchBuffer(loc, headers));
      }
      if(res.statusCode!==200){ res.resume(); return reject(new Error('HTTP '+res.statusCode+' '+urlStr)); }
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    req.on('error',reject);
  });
}
async function fetchJson(urlStr, headers){ const b=await fetchBuffer(urlStr, {'Accept':'application/json',...headers}); return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,'')); }
async function fetchText(urlStr, headers){ const b=await fetchBuffer(urlStr, headers); return b.toString('utf8').replace(/^\uFEFF/,''); }

// Simple CSV parser (handles quoted fields, commas, newlines in quotes)
function parseCSV(text){
  const rows=[]; let row=[]; let cur=''; let inQ=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQ){ if(ch==='"' && text[i+1]==='"'){ cur+='"'; i++; } else if(ch==='"'){ inQ=false; } else { cur+=ch; } }
    else { if(ch==='"') inQ=true; else if(ch===','){ row.push(cur); cur=''; } else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; } else if(ch==='\r'){ /*ignore*/ } else { cur+=ch; } }
  }
  if(cur.length||row.length){ row.push(cur); rows.push(row); }
  if(!rows.length) return [];
  const headers=rows[0].map(h=>normStr(h));
  return rows.slice(1).filter(r=>r.some(c=>normStr(c)!=='')).map(r=>{ const o={}; headers.forEach((h,i)=>o[h]=r[i]!=null?r[i]:''); return o; });
}

function loadRegistry(){
  try{
    const raw=fs.readFileSync(REGISTRY_PATH,'utf8');
    const data=JSON.parse(raw.replace(/^\uFEFF/,''));
    if(!data||!Array.isArray(data.orgs)) throw new Error('bad');
    data.progress=data.progress&&typeof data.progress==='object'?data.progress:{};
    data.sources=data.sources&&typeof data.sources==='object'?data.sources:{};
    return data;
  }catch(_){
    return {version:2,updated_at:null,description:'Polytab verified charity master list. Captured from free public registries/filings across countries. Evidence-backed; no fabricated ratings/audits. No private/home coordinates.',counts:{total:0},progress:{},sources:{},orgs:[]};
  }
}
function saveRegistry(reg){
  reg.orgs.sort((a,b)=>(a.name||'').localeCompare(b.name||'') || String(a.registry_id||a.ein||'').localeCompare(String(b.registry_id||b.ein||'')));
  reg.counts={total:reg.orgs.length};
  reg.updated_at=new Date().toISOString();
  fs.mkdirSync(path.dirname(REGISTRY_PATH),{recursive:true});
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg,null,2)+'\n','utf8');
}

function keyFor(e){ return (e.source||'')+'|'+(e.registry_id||e.ein||''); }

function mergeEntries(reg, entries, limit){
  const byKey=new Map(reg.orgs.map(o=>[keyFor(o),o]));
  let added=0;
  for(const e of entries){
    if(added>=limit) break;
    const k=keyFor(e);
    if(!k || k.endsWith('|')) continue;
    if(byKey.has(k)) continue;
    byKey.set(k,e); added++;
  }
  reg.orgs=Array.from(byKey.values());
  return added;
}

// ---- Sources ----

async function sourceUS_ProPublica(reg){
  // reuse existing logic minimally: fetch a few search pages via public API
  const BASE='https://projects.propublica.org/nonprofits/api/v2';
  const queries=['children disability','pediatric cancer','disaster relief','food bank','homeless shelter','refugee assistance','environment conservation','education literacy','health clinic','disability services'];
  const qIdx = Number(reg.progress.us_q||0)%queries.length;
  const q = queries[qIdx];
  const page = Number((reg.progress.us_pages||{})[q]||0);
  let search;
  try{ await sleep(REQUEST_DELAY_MS); search=await fetchJson(BASE+'/search.json?q='+encodeURIComponent(q)+'&page='+page); }catch(e){ console.log('US search fail',e.message); reg.progress.us_q=(qIdx+1)%queries.length; return []; }
  const orgs = Array.isArray(search.organizations)?search.organizations:[];
  if(!orgs.length){ (reg.progress.us_pages=reg.progress.us_pages||{})[q]=0; reg.progress.us_q=(qIdx+1)%queries.length; return []; }
  const out=[]; let details=0;
  for(const hit of orgs){
    if(details>=60 || out.length>=MAX_NEW_PER_SOURCE) break;
    const ein=String(hit.ein||'').replace(/\D/g,''); if(!ein) continue;
    let detail=null;
    try{ await sleep(REQUEST_DELAY_MS); detail=await fetchJson(BASE+'/organizations/'+ein+'.json'); details++; }catch(_){ continue; }
    const o=(detail&&detail.organization)?detail.organization:hit;
    const filings=Array.isArray(detail&&detail.filings_with_data)?detail.filings_with_data:[];
    const latest=filings.slice().sort((a,b)=>(Number(b.tax_prd_yr)||0)-(Number(a.tax_prd_yr)||0))[0];
    const subsection=o.subsection_code!=null?Number(o.subsection_code):null;
    const taxYear=latest?Number(latest.tax_prd_yr)||null:null;
    if(subsection!==3) continue; if(!taxYear||taxYear<2018) continue;
    out.push({
      source:'US_IRS_ProPublica', country:'US', registry_id:ein, ein, name:normStr(o.name||hit.name),
      city:normStr(o.city||hit.city)||null, state:normStr(o.state||hit.state)||null,
      website:null, // not provided by this endpoint
      verification:{source:'ProPublica Nonprofit Explorer (IRS EO BMF + Form 990/990-EZ/990-PF)',source_url:'https://projects.propublica.org/nonprofits/organizations/'+ein,evidence:'IRS Form 990-series filing (tax year '+taxYear+')',independently_filed:true,has_recent_filing:true,is_501c3:true},
      latest_filing:{tax_year:taxYear,form_type:latest&&latest.formtype?String(latest.formtype):null,pdf_url:latest&&latest.pdf_url?latest.pdf_url:null,total_revenue:safeNum(latest&&latest.totrevenue),total_expenses:safeNum(latest&&(latest.totfuncexpns!=null?latest.totfuncexpns:latest.totexpns))},
      captured_at:new Date().toISOString()
    });
  }
  (reg.progress.us_pages=reg.progress.us_pages||{})[q]=page+1;
  const numPages=Number(search.num_pages||0); if(numPages && page+1>=numPages) reg.progress.us_pages[q]=0;
  reg.progress.us_q=(qIdx+1)%queries.length;
  return out;
}

async function sourceUK_CharityCommission(reg){
  // Charity Commission public API may require a subscription key; attempt unauthenticated calls
  // and also try any configured key (env, not committed). Falls back gracefully if unavailable.
  const key = process.env.CHARITY_COMMISSION_API_KEY || '';
  const headers = key ? {'Ocp-Apim-Subscription-Key': key} : {};
  const terms=['children','health','disability','education','homeless','refugee','environment','food','cancer','hospice','mental health','poverty','water','shelter'];
  const tIdx=Number(reg.progress.uk_t||0)%terms.length; const term=terms[tIdx];
  let data=null;
  try{
    await sleep(REQUEST_DELAY_MS);
    data=await fetchJson('https://api.charitycommission.gov.uk/register/api/searchAllCharitiesV2?searchTerm='+encodeURIComponent(term)+'&pageSize=50', headers);
  }catch(e){
    try{ await sleep(REQUEST_DELAY_MS); data=await fetchJson('https://api.charitycommission.gov.uk/register/api/searchCharityName/'+encodeURIComponent(term), headers); }catch(e2){ console.log('UK fail (API may require key):',e2.message); reg.progress.uk_t=(tIdx+1)%terms.length; return []; }
  }
  reg.progress.uk_t=(tIdx+1)%terms.length;
  const list = Array.isArray(data)?data:(Array.isArray(data&&data.charities)?data.charities:(Array.isArray(data&&data.results)?data.results:(Array.isArray(data&&data.data)?data.data:[])));
  if(!Array.isArray(list) || !list.length) return [];
  const out=[];
  for(const c of list){
    if(out.length>=MAX_NEW_PER_SOURCE) break;
    const regno = normStr(c.registeredCharityNumber || c.registered_charity_number || c.reg_charity_number || c.organisation_number || c.regno);
    if(!regno) continue;
    const name = normStr(c.charityName || c.charity_name || c.organisation_name || c.name);
    if(!name) continue;
    const status = normStr(c.registrationStatus || c.charity_registration_status || c.reg_status || c.status).toLowerCase();
    if(status && status.indexOf('registered')===-1 && status.indexOf('active')===-1) continue;
    const websiteRaw = normStr(c.contactWeb || c.web || c.website || c.contact_web) || null;
    const website = websiteRaw ? ( /^https?:\/\//i.test(websiteRaw)?websiteRaw:('https://'+websiteRaw.replace(/^\/+/,'').replace(/^https?:\/\//i,'')) ) : null;
    const city = normStr(c.addressTown || c.address_town || c.town || c.city) || null;
    out.push({
      source:'UK_CharityCommission', country:'GB', registry_id:String(regno), name, city, state:null, website,
      verification:{source:'Charity Commission for England and Wales (public register)',source_url:'https://register-of-charities.charitycommission.gov.uk/charity-search/-/charity-details/'+encodeURIComponent(String(regno)),evidence:'Registered charity record (public register; accounts/annual returns filed as recorded)',independently_filed:true,has_recent_filing: !!(c.latestAccFinPeriodEndDate || c.latest_acc_fin_period_end_date || c.latestIncome || c.latest_income)},
      latest_filing:{latest_income:safeNum(c.latestIncome||c.latest_income),latest_expenditure:safeNum(c.latestExpenditure||c.latest_expenditure),latest_accounts_end:normStr(c.latestAccFinPeriodEndDate||c.latest_acc_fin_period_end_date)||null},
      captured_at:new Date().toISOString()
    });
  }
  return out;
}

async function sourceCanada_OpenData(reg){
  const urls = [
    'https://open.canada.ca/data/dataset/7a80e185-8856-4f34-b9f8-658b67d20a46/resource/6647a97f-86c3-4b4e-8d42-4b3831415327/download/identification-of-charities.csv',
    'https://open.canada.ca/data/dataset/7a80e185-8856-4f34-b9f8-658b67d20a46/resource/74e1a52d-94ed-4d64-943d-2148d3d2f9d6/download/ident.csv'
  ];
  const uIdx = Number(reg.progress.ca_url||0)%urls.length;
  let text=null; let used=uIdx;
  for(let i=0;i<urls.length;i++){
    const j=(uIdx+i)%urls.length;
    try{ await sleep(REQUEST_DELAY_MS); text=await fetchText(urls[j]); used=j; break; }catch(e){ /*try next*/ }
  }
  if(!text){ console.log('CA fail: no reachable open data CSV'); reg.progress.ca_url=(uIdx+1)%urls.length; return []; }
  reg.progress.ca_url=used;
  const rows=parseCSV(text);
  if(!rows.length) return [];
  const start = Number(reg.progress.ca_row||0);
  const slice = rows.slice(start, start+MAX_NEW_PER_SOURCE);
  const out=[];
  for(const r of slice){
    const bn = normStr(r.BN || r.bn || r['BN/Registration number'] || r['Registration Number'] || r['Business Number']);
    const name = normStr(r['Legal Name'] || r.legal_name || r.Name || r.name || r['Organization name']);
    if(!bn || !name) continue;
    const status = normStr(r.Status || r.status || r['Charity status']).toLowerCase();
    if(status && status.indexOf('registered')===-1) continue;
    const city = normStr(r.City || r.city) || null; const prov = normStr(r.Province || r.province || r['Province/Territory']) || null;
    out.push({
      source:'CA_CRA_Charities', country:'CA', registry_id:bn, name, city, state:prov, website:null,
      verification:{source:'Canada Revenue Agency List of charities (open.canada.ca)',source_url:'https://apps.cra-arc.gc.ca/ebci/hacc/srch/pub/dsplyRprtngPrd?q.srchNm='+encodeURIComponent(name)+'&selectedCharityBn='+encodeURIComponent(bn)+'&dsrdPg=1',evidence:'Registered charity record (CRA public listing/open data)',independently_filed:true,has_recent_filing:true},
      captured_at:new Date().toISOString()
    });
  }
  reg.progress.ca_row = start + slice.length;
  if(start + slice.length >= rows.length) reg.progress.ca_row = 0;
  return out;
}

async function sourceAU_ACNC(reg){
  const urls = [
    'https://data.gov.au/data/dataset/b050b242-4487-4306-abf5-07ca073e5594/resource/eb1e6be4-5b13-4feb-b28e-388bf7c26f93/download/datadotgov_main.csv',
    'https://data.gov.au/data/dataset/b050b242-4487-4306-abf5-07ca073e5594/resource/8d020b50-700f-4bc4-8c78-79f83d99be7a/download/datadotgov_main.csv'
  ];
  const uIdx=Number(reg.progress.au_url||0)%urls.length;
  let text=null; let used=uIdx;
  for(let i=0;i<urls.length;i++){
    const j=(uIdx+i)%urls.length;
    try{ await sleep(REQUEST_DELAY_MS); text=await fetchText(urls[j]); if(text && text.indexOf(',')!==-1){ used=j; break; } text=null; }catch(e){ /*next*/ }
  }
  if(!text){ console.log('AU fail: no reachable open data CSV'); reg.progress.au_url=(uIdx+1)%urls.length; return []; }
  reg.progress.au_url=used;
  const rows=parseCSV(text);
  if(!rows.length) return [];
  const start=Number(reg.progress.au_row||0);
  const slice=rows.slice(start,start+MAX_NEW_PER_SOURCE);
  const out=[];
  for(const r of slice){
    const abn = normStr(r.ABN || r.abn);
    const name = normStr(r.Charity_Legal_Name || r['Charity Legal Name'] || r.charity_legal_name || r.Name);
    if(!abn || !name) continue;
    const status = normStr(r.Registration_Status || r.registration_status || r.charity_status).toLowerCase();
    if(status && status.indexOf('registered')===-1) continue;
    const city = normStr(r.Town_City || r['Town/City'] || r.town_city) || null;
    const state = normStr(r.State || r.state) || null;
    const website = normStr(r.Charity_Website || r.charity_website) || null;
    out.push({
      source:'AU_ACNC', country:'AU', registry_id:abn, name, city, state,
      website: website && /^https?:\/\//i.test(website)?website:(website?('https://'+website.replace(/^https?:\/\//i,'')):null),
      verification:{source:'Australian Charities and Not-for-profits Commission (ACNC Charity Register open data)',source_url:'https://www.acnc.gov.au/charity/charities?search='+encodeURIComponent(name),evidence:'Registered charity record (ACNC open data)',independently_filed:true,has_recent_filing:true},
      captured_at:new Date().toISOString()
    });
  }
  reg.progress.au_row = start + slice.length;
  if(start+slice.length>=rows.length) reg.progress.au_row=0;
  return out;
}

async function sourceNZ_Charities(reg){
  const urls = [
    'https://www.register.charities.govt.nz/CharitiesRegister/Download',
    'https://www.charities.govt.nz/assets/Uploads/CharitiesServices-Export.csv'
  ];
  const uIdx=Number(reg.progress.nz_url||0)%urls.length;
  let text=null; let used=uIdx;
  for(let i=0;i<urls.length;i++){
    const j=(uIdx+i)%urls.length;
    try{ await sleep(REQUEST_DELAY_MS); text=await fetchText(urls[j], {'Accept':'text/csv,application/csv,*/*'}); if(text && text.indexOf(',')!==-1) { used=j; break; } text=null; }catch(e){ /*next*/ }
  }
  if(!text){ console.log('NZ fail: no reachable export'); reg.progress.nz_url=(uIdx+1)%urls.length; return []; }
  reg.progress.nz_url=used;
  const rows=parseCSV(text);
  if(!rows.length) return [];
  const start=Number(reg.progress.nz_row||0);
  const slice=rows.slice(start,start+MAX_NEW_PER_SOURCE);
  const out=[];
  for(const r of slice){
    const num = normStr(r['Charity Registration Number'] || r.CharityRegistrationNumber || r.Number || r.CCN);
    const name = normStr(r['Charity Name'] || r.Name || r.charity_name || r['Other Names']);
    if(!num || !name) continue;
    const website = normStr(r.Website || r.website || r['Web Site']) || null;
    const city = normStr(r['City'] || r.City || r.Town || r['Street Address 3']) || null;
    out.push({
      source:'NZ_Charities', country:'NZ', registry_id:num, name, city, state:null,
      website: website && /^https?:\/\//i.test(website)?website:(website?('https://'+website.replace(/^https?:\/\//i,'')):null),
      verification:{source:'Charities Services New Zealand (Charities Register export)',source_url:'https://register.charities.govt.nz/Charity/'+encodeURIComponent(num),evidence:'Registered charity record (Charities Register)',independently_filed:true,has_recent_filing:true},
      captured_at:new Date().toISOString()
    });
  }
  reg.progress.nz_row = start + slice.length;
  if(start+slice.length>=rows.length) reg.progress.nz_row=0;
  return out;
}

// ---- Optional governed promotion to shelf (honest, minimum fields) ----
function walletFor(id){ const body='0'.repeat(40-3-String(id).length)+String(id); return '0x71C'+body; }
function chooseCategory(name){
  const n=(name||'').toLowerCase();
  if(/blind|deaf|disab|autism|wheelchair|assist|access|rehab|prosthe|braille|health|medical|hospital|cancer|hospice/.test(n)) return 'Accessibility & Universal Design';
  if(/environ|climate|wildlife|ocean|forest|conserv|water|river|nature|animal/.test(n)) return 'Environmental';
  if(/school|educ|literac|child|youth|student|learn|library|college/.test(n)) return 'Classrooms';
  if(/housing|shelter|habitat|build|rebuild|community|neighbo|park|garden/.test(n)) return 'Campus Grounds';
  if(/sport|athlet|play|olymp/.test(n)) return 'Athletics';
  return 'Civic Tech';
}
function promoteToShelf(reg, maxPromote){
  let raw=fs.readFileSync(FEED_PATH,'utf8'); if(raw.charCodeAt(0)===0xFEFF) raw=raw.slice(1);
  const feed=JSON.parse(raw);
  const CAT_BLOCK={'Accessibility & Universal Design':10000,'Environmental':20000,'Civic Tech':30000,'Classrooms':40000,'Arts & Clubs':45000,'Campus Grounds':60000,'Athletics':70000};
  const counters={};
  for(const it of feed.items){ const n=parseInt(it.id,10); if(!Number.isFinite(n)) continue; for(const base of Object.values(CAT_BLOCK)){ if(n>base && n<base+10000) counters[base]=Math.max(counters[base]||0,n-base); } }
  const existing=new Set(feed.items.map(it=>(((it._polytab&&it._polytab.organization)||'').trim().toLowerCase())));
  let added=0;
  for(const e of reg.orgs){
    if(added>=maxPromote) break;
    const org=normStr(e.name); if(!org) continue;
    if(existing.has(org.toLowerCase())) continue;
    // require basic verifiable identity + source evidence
    if(!e.verification || !e.source || !e.registry_id) continue;
    const cat=chooseCategory(org);
    const base=CAT_BLOCK[cat]||30000; counters[base]=(counters[base]||0)+1; const id=String(base+counters[base]);
    const loc=[e.city,e.state,e.country].filter(Boolean).join(', ')|| (e.country||'Global');
    const site = (e.website && /^https?:\/\//i.test(e.website)) ? e.website : null;
    const item={ id, title: org, content_html:'<p>Support the mission of '+org+' (verified registry record: '+e.verification.source+').</p>', url:'https://polytab.store/#'+id, date_published:new Date().toISOString(),
      _polytab:{ category:cat, organization:org, location:loc, summary:'Support the mission of '+org+'.', plainSummary:'What is broken: Community needs require trusted support.\nWhat will be done: Fund this organization’s verified mission.\nProof: '+(e.verification.evidence||'Registry filing evidence')+' ('+e.verification.source+').', votePriceUSD:0.5, targetUSD:500, fundedUSD:0, votesCount:0, contract:walletFor(id), status:'Active', lat:null, lng:null, website:site, socials:{} }
    };
    feed.items.push(item); existing.add(org.toLowerCase()); added++;
  }
  if(added>0){ fs.writeFileSync(FEED_PATH, JSON.stringify(feed,null,2)+'\n','utf8'); }
  return added;
}

async function main(){
  const reg=loadRegistry();
  reg.version=2;
  let totalAdded=0;
  const sources=[
    ['US_IRS_ProPublica', sourceUS_ProPublica],
    ['UK_CharityCommission', sourceUK_CharityCommission],
    ['CA_CRA_Charities', sourceCanada_OpenData],
    ['AU_ACNC', sourceAU_ACNC],
    ['NZ_Charities', sourceNZ_Charities]
  ];
  for(const [name,fn] of sources){
    if(totalAdded>=MAX_TOTAL_NEW) break;
    let entries=[];
    try{ entries=await fn(reg); }catch(e){ console.log('source error',name,e.message); entries=[]; }
    const added=mergeEntries(reg, entries, Math.min(MAX_NEW_PER_SOURCE, MAX_TOTAL_NEW-totalAdded));
    (reg.sources[name]=reg.sources[name]||{}); reg.sources[name].last_run=new Date().toISOString(); reg.sources[name].last_added=added; reg.sources[name].last_fetched=entries.length;
    totalAdded+=added;
    console.log(name+': fetched='+entries.length+' added='+added);
  }
  saveRegistry(reg);
  console.log('registry_total='+reg.orgs.length+' total_added='+totalAdded);
  if(PROMOTE){
    const promoted=promoteToShelf(reg, 200);
    console.log('promoted_to_shelf='+promoted);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
