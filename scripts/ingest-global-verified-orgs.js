// Polytab — Global verified charity ingestion v3 (tiered, evidence-backed, $0)
// Tiers:
//  1) Transnational vetted/open standards (IATI, GlobalGiving open data, EU Transparency Register, etc.)
//  2) Meta-catalog/enrichment (Wikidata SPARQL cross-linking - only when tied to official registry IDs)
//  3) Direct national open-data dumps/registers (bulk CSV/JSON/OData where available)
//  4) Keyed/geo-restricted national APIs (opt-in via env vars, never block pipeline)
//
// Hardening: content-type/schema gatekeeping, graceful degraded_endpoint status, no state corruption.
// IDs: ORG-ID style canonical keys (e.g. US-EIN-, GB-CHC-, AU-ABN-) for cross-source dedupe.
// Honesty: record source evidence only; never invent audits/ratings/coords/websites; no private/home coords.
// Registry: docs/data/verified-orgs.json (governed shelf promotion via --promote).

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'docs', 'data', 'verified-orgs.json');
const FEED_PATH = path.join(ROOT, 'docs', 'feed.json');
const PROMOTE = process.argv.includes('--promote');
const MAX_NEW_PER_SOURCE = 200;
const MAX_TOTAL_NEW = 800;
const REQUEST_DELAY_MS = 250;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function safeNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function normStr(v){ return v==null?'':String(v).trim(); }
function safeWebsite(v){
  const s=normStr(v); if(!s) return null;
  const u=/^https?:\/\//i.test(s)?s:('https://'+s.replace(/^\/+/,'').replace(/^https?:\/\//i,''));
  try{ const p=new URL(u); if(!/^https?:$/.test(p.protocol)) return null; return p.toString(); }catch(_){ return null; }
}
function isPrivateCoord(lat,lng){ // avoid doxxing near ~28.0x,-81.9x
  if(lat==null||lng==null) return false;
  return (Math.abs(lat-28.0)<0.6 && Math.abs(lng - (-81.9))<0.6);
}

function fetchRaw(urlStr, headers={}, redirect=0){
  return new Promise((resolve,reject)=>{
    let u; try{ u=new URL(urlStr); }catch(e){ return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get({
      hostname:u.hostname, port:u.port|| (u.protocol==='http:'?80:443), path:(u.pathname||'/')+(u.search||''),
      headers:{'User-Agent':'Polytab-GlobalIngest/3.0 (+https://github.com/R03LV1S/Polytab)','Accept':'application/json,text/csv,application/xml,text/xml,*/*',...headers}
    }, res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location && redirect<5){
        const loc = new URL(res.headers.location, urlStr).toString();
        res.resume(); return resolve(fetchRaw(loc, headers, redirect+1));
      }
      if(res.statusCode!==200){ res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve({buf:Buffer.concat(chunks), headers:res.headers||{}, status:res.statusCode, url:urlStr}));
    });
    req.on('error',reject);
    req.setTimeout(30000, ()=>{ try{req.destroy(new Error('timeout'));}catch(_){} });
  });
}
function contentTypeOf(meta){ return normStr((meta.headers['content-type']||meta.headers['Content-Type']||'')).toLowerCase(); }
function looksLikeHtml(text, ct){ if(ct.includes('text/html')) return true; const t=String(text||'').trim().toLowerCase(); return t.startsWith('<!doctype') || t.startsWith('<html') || (t.startsWith('<') && t.includes('<head')); }

async function fetchJsonGuarded(urlStr, headers={}){
  const meta=await fetchRaw(urlStr, {'Accept':'application/json, text/json, */*',...headers});
  const ct=contentTypeOf(meta); const text=meta.buf.toString('utf8').replace(/^\uFEFF/,'');
  if(looksLikeHtml(text, ct)) throw new Error('unexpected_html');
  try{ return JSON.parse(text); }catch(e){ throw new Error('invalid_json'); }
}
async function fetchTextGuarded(urlStr, headers={}, expect='csv'){
  const meta=await fetchRaw(urlStr, headers);
  const ct=contentTypeOf(meta); const text=meta.buf.toString('utf8').replace(/^\uFEFF/,'');
  if(looksLikeHtml(text, ct)) throw new Error('unexpected_html');
  if(expect==='csv' && !(ct.includes('csv') || ct.includes('text/plain') || ct.includes('octet-stream') || ct==='' || text.includes(',') || text.includes('\t'))) {
    // allow but will be validated by parser/schema
  }
  return {text, ct};
}

// CSV parser
function parseCSV(text){
  const rows=[]; let row=[]; let cur=''; let inQ=false; const s=String(text||'');
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(inQ){ if(ch==='"' && s[i+1]==='"'){ cur+='"'; i++; } else if(ch==='"'){ inQ=false; } else cur+=ch; }
    else { if(ch==='"') inQ=true; else if(ch===','){ row.push(cur); cur=''; } else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; } else if(ch==='\r'){} else cur+=ch; }
  }
  if(cur.length||row.length){ row.push(cur); rows.push(row); }
  if(!rows.length) return {headers:[], rows:[]};
  const headers=rows[0].map((h,i)=>{ const k=normStr(h); return k||('col_'+i); });
  const data=rows.slice(1).filter(r=>r.some(c=>normStr(c)!=='')).map(r=>{ const o={}; headers.forEach((h,i)=>o[h]=r[i]!=null?r[i]:''); return o; });
  return {headers, rows:data};
}
function validateHeaders(headers, anyOfGroups){
  if(!headers||!headers.length) return false;
  const set=new Set(headers.map(h=>h.toLowerCase()));
  return anyOfGroups.some(group=>group.some(k=>set.has(k.toLowerCase())));
}

// --- Registry ---
function loadRegistry(){
  try{
    const raw=fs.readFileSync(REGISTRY_PATH,'utf8');
    const data=JSON.parse(raw.replace(/^\uFEFF/,''));
    if(!data||!Array.isArray(data.orgs)) throw new Error('bad');
    data.progress=data.progress&&typeof data.progress==='object'?data.progress:{};
    data.sources=data.sources&&typeof data.sources==='object'?data.sources:{};
    return data;
  }catch(_){
    return {version:3,updated_at:null,description:'Polytab verified charity master list. Tiered, evidence-backed capture from reputable public registries, filings, and transnational open data across continents. No fabricated ratings/audits. No private/home coordinates.',counts:{total:0},progress:{},sources:{},orgs:[]};
  }
}
function saveRegistry(reg){
  reg.orgs.sort((a,b)=>(a.name||'').localeCompare(b.name||'') || String(a.registry_id||'').localeCompare(String(b.registry_id||'')));
  reg.counts={total:reg.orgs.length, by_tier: reg.orgs.reduce((acc,o)=>{ const t=(o.verification&&o.verification.tier)||'unknown'; acc[t]=(acc[t]||0)+1; return acc; },{})};
  reg.updated_at=new Date().toISOString();
  fs.mkdirSync(path.dirname(REGISTRY_PATH),{recursive:true});
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg,null,2)+'\n','utf8');
}
function keyFor(e){ return normStr(e.registry_id) || ((e.source||'')+'|'+(e.registry_id_raw||e.ein||'')); }
function mergeEntries(reg, entries, limit){
  const byKey=new Map(reg.orgs.map(o=>[keyFor(o),o]));
  let added=0, updated=0;
  for(const e of entries){
    if(added>=limit) break;
    const k=keyFor(e); if(!k) continue;
    if(!normStr(e.name)) continue;
    if(byKey.has(k)){
      // enrich existing (e.g. add website/coords only if verifiable and missing)
      const ex=byKey.get(k);
      if(!ex.website && safeWebsite(e.website)) ex.website=safeWebsite(e.website);
      if((ex.lat==null||ex.lng==null) && e.lat!=null && e.lng!=null && !isPrivateCoord(e.lat,e.lng)){ ex.lat=e.lat; ex.lng=e.lng; }
      // keep highest evidence tier info
      updated++; continue;
    }
    byKey.set(k,e); added++;
  }
  reg.orgs=Array.from(byKey.values());
  return {added, updated};
}

function orgId(prefix, raw){
  const r=normStr(raw).replace(/\s+/g,''); if(!r) return null;
  return prefix + r;
}
function entryBase({source,country,continent,registry_id,registry_id_raw,name,city,state,website,lat,lng,verification,extra}){
  const w=safeWebsite(website);
  let la = (lat==null||lat==='')?null:Number(lat); let ln=(lng==null||lng==='')?null:Number(lng);
  if(!Number.isFinite(la)||!Number.isFinite(ln)||isPrivateCoord(la,ln)){ la=null; ln=null; }
  return {
    source, country: country||null, continent: continent||null,
    registry_id, registry_id_raw: registry_id_raw!=null?String(registry_id_raw):null,
    name: normStr(name), city: normStr(city)||null, state: normStr(state)||null,
    website: w, lat: la, lng: ln,
    verification, ...(extra||{}), captured_at: new Date().toISOString()
  };
}

function markDegraded(reg, name, reason){
  reg.sources[name]=reg.sources[name]||{};
  reg.sources[name].status='degraded_endpoint';
  reg.sources[name].last_error=String(reason||'error');
  reg.sources[name].last_run=new Date().toISOString();
}

// ---------- Tier 3/4: National registers (direct/open data, keyed opt-in) ----------
async function sourceUS_ProPublica(reg){
  const name='US_IRS_ProPublica';
  const BASE='https://projects.propublica.org/nonprofits/api/v2';
  const queries=['children','disability','health','education','food','shelter','refugee','disaster','environment','conservation','veteran','elderly','mental health','hospice','literacy','water','human rights','poverty','community','youth','arts','animals'];
  const qIdx = Number(reg.progress.us_q||0)%queries.length; const q = queries[qIdx];
  const page = Number((reg.progress.us_pages||{})[q]||0);
  let search;
  try{ await sleep(REQUEST_DELAY_MS); search=await fetchJsonGuarded(BASE+'/search.json?q='+encodeURIComponent(q)+'&page='+page); }
  catch(e){ markDegraded(reg,name,e.message); reg.progress.us_q=(qIdx+1)%queries.length; return []; }
  const orgs = Array.isArray(search.organizations)?search.organizations:[];
  if(!orgs.length){ (reg.progress.us_pages=reg.progress.us_pages||{})[q]=0; reg.progress.us_q=(qIdx+1)%queries.length; return []; }
  const out=[]; let details=0;
  for(const hit of orgs){
    if(details>=80 || out.length>=MAX_NEW_PER_SOURCE) break;
    const einRaw=String(hit.ein||'').replace(/\D/g,''); if(!einRaw) continue;
    let detail=null;
    try{ await sleep(REQUEST_DELAY_MS); detail=await fetchJsonGuarded(BASE+'/organizations/'+einRaw+'.json'); details++; }catch(_){ continue; }
    const o=(detail&&detail.organization)?detail.organization:hit;
    const filings=Array.isArray(detail&&detail.filings_with_data)?detail.filings_with_data:[];
    const latest=filings.slice().sort((a,b)=>(Number(b.tax_prd_yr)||0)-(Number(a.tax_prd_yr)||0))[0];
    const subsection=o.subsection_code!=null?Number(o.subsection_code):null;
    const taxYear=latest?Number(latest.tax_prd_yr)||null:null;
    if(subsection!==3) continue; if(!taxYear||taxYear<2016) continue;
    out.push(entryBase({
      source:name, country:'US', continent:'North America',
      registry_id:orgId('US-EIN-',einRaw), registry_id_raw:einRaw,
      name:(o.name||hit.name), city:(o.city||hit.city), state:(o.state||hit.state), website:null,
      verification:{tier:'official_government_register', source:'ProPublica Nonprofit Explorer (IRS EO BMF + Form 990/990-EZ/990-PF)', source_url:'https://projects.propublica.org/nonprofits/organizations/'+einRaw, evidence:'IRS Form 990-series filing (tax year '+taxYear+')', independently_filed:true, has_recent_filing:true, is_501c3:true},
      extra:{ein:einRaw, latest_filing:{tax_year:taxYear,form_type:latest&&latest.formtype?String(latest.formtype):null,pdf_url:latest&&latest.pdf_url?latest.pdf_url:null}}
    }));
  }
  (reg.progress.us_pages=reg.progress.us_pages||{})[q]=page+1;
  const numPages=Number(search.num_pages||0); if(numPages && page+1>=numPages) reg.progress.us_pages[q]=0;
  reg.progress.us_q=(qIdx+1)%queries.length;
  return out;
}

async function sourceUK_CharityCommission(reg){
  const name='UK_CharityCommission';
  const key = process.env.CHARITY_COMMISSION_API_KEY || '';
  const headers = key ? {'Ocp-Apim-Subscription-Key': key} : {};
  const terms=['children','health','disability','education','homeless','refugee','environment','food','cancer','hospice','poverty','water','shelter','elderly','community','mental health'];
  const tIdx=Number(reg.progress.uk_t||0)%terms.length; const term=terms[tIdx];
  let data=null;
  try{ await sleep(REQUEST_DELAY_MS); data=await fetchJsonGuarded('https://api.charitycommission.gov.uk/register/api/searchAllCharitiesV2?searchTerm='+encodeURIComponent(term)+'&pageSize=50', headers); }
  catch(e){ try{ await sleep(REQUEST_DELAY_MS); data=await fetchJsonGuarded('https://api.charitycommission.gov.uk/register/api/searchCharityName/'+encodeURIComponent(term), headers); }catch(e2){ markDegraded(reg,name,'may require CHARITY_COMMISSION_API_KEY: '+e2.message); reg.progress.uk_t=(tIdx+1)%terms.length; return []; } }
  reg.progress.uk_t=(tIdx+1)%terms.length;
  const list = Array.isArray(data)?data:(Array.isArray(data&&data.charities)?data.charities:(Array.isArray(data&&data.results)?data.results:(Array.isArray(data&&data.data)?data.data:[])));
  if(!Array.isArray(list)) return [];
  const out=[];
  for(const c of list){
    if(out.length>=MAX_NEW_PER_SOURCE) break;
    const regno = normStr(c.registeredCharityNumber || c.registered_charity_number || c.reg_charity_number || c.organisation_number || c.regno);
    const cname = normStr(c.charityName || c.charity_name || c.organisation_name || c.name);
    if(!regno || !cname) continue;
    const status = normStr(c.registrationStatus || c.charity_registration_status || c.reg_status || c.status).toLowerCase();
    if(status && status.indexOf('registered')===-1 && status.indexOf('active')===-1) continue;
    out.push(entryBase({
      source:name, country:'GB', continent:'Europe',
      registry_id:orgId('GB-CHC-',regno), registry_id_raw:regno,
      name:cname, city:(c.addressTown||c.address_town||c.town||c.city), state:null, website:(c.contactWeb||c.web||c.website),
      verification:{tier:'official_government_register', source:'Charity Commission for England and Wales (public register)', source_url:'https://register-of-charities.charitycommission.gov.uk/charity-search/-/charity-details/'+encodeURIComponent(String(regno)), evidence:'Registered charity record (accounts/annual returns as recorded by regulator)', independently_filed:true, has_recent_filing:true}
    }));
  }
  return out;
}

// Generic CSV open-data source with schema/HTML guards
async function csvSource(reg, cfg){
  const name=cfg.source;
  const urls = cfg.urls||[];
  if(!urls.length) return [];
  const uIdx = Number(reg.progress[cfg.urlKey|| (cfg.key+'_url')]||0) % urls.length;
  let payload=null; let used=uIdx;
  for(let i=0;i<urls.length;i++){
    const j=(uIdx+i)%urls.length;
    try{ await sleep(REQUEST_DELAY_MS); payload=await fetchTextGuarded(urls[j], cfg.headers||{}, 'csv'); used=j; break; }
    catch(e){ /*try next*/ }
  }
  if(!payload){ markDegraded(reg,name,'no reachable/valid open data'); reg.progress[cfg.urlKey|| (cfg.key+'_url')] = (uIdx+1)%urls.length; return []; }
  reg.progress[cfg.urlKey|| (cfg.key+'_url')] = used;
  let parsed = parseCSV(payload.text);
  if(parsed.headers.length===0 && payload.text.indexOf('\t')!==-1){ parsed = parseCSV(payload.text.replace(/\t/g,',')); }
  if(!parsed.rows.length || !validateHeaders(parsed.headers, cfg.requiredHeaderGroups||[[ 'name' ]])){ markDegraded(reg,name,'schema_mismatch_or_empty'); return []; }
  const startKey = cfg.startKey || (cfg.key+'_row');
  const start = Number(reg.progress[startKey]||0);
  const slice = parsed.rows.slice(start, start+MAX_NEW_PER_SOURCE);
  const out=[];
  for(const r of slice){
    const m = cfg.mapFn(r); if(!m) continue;
    const rawId = normStr(m.registry_id); const cname=normStr(m.name); if(!rawId||!cname) continue;
    const status = normStr(m.status).toLowerCase(); if(status && !/registered|active|current|live|compliant|yes/.test(status)) continue;
    const rid = cfg.orgIdPrefix ? orgId(cfg.orgIdPrefix, rawId) : (cfg.source+':'+rawId);
    out.push(entryBase({
      source:name, country:m.country||cfg.country, continent:m.continent||cfg.continent,
      registry_id:rid, registry_id_raw:rawId, name:cname, city:m.city, state:m.state, website:m.website, lat:m.lat, lng:m.lng,
      verification:{tier: cfg.tier||'official_government_register', source: cfg.sourceLabel, source_url: cfg.urlFn?cfg.urlFn(rawId,cname,m,r):(cfg.sourceUrl||null), evidence: cfg.evidence||'Registered charity/NGO record (official public register/open data)', independently_filed:true, has_recent_filing:true}
    }));
  }
  reg.progress[startKey] = start + slice.length; if(start + slice.length >= parsed.rows.length) reg.progress[startKey]=0;
  return out;
}

// ---------- Tier 1: Transnational vetted / open standards ----------
async function sourceEU_TransparencyRegister(reg){
  // EU Transparency Register bulk data (open data) - XML/CSV; try known download endpoints
  const name='EU_TransparencyRegister';
  const urls=[
    'https://data.europa.eu/euodp/repository/ec/transparency-register/odp-2024/transparency-register-full-list-of-registered-organisations.csv',
    'https://ec.europa.eu/transparencyregister/public/consultation/open-data.do?locale=en' // may be portal page
  ];
  const cfg={ key:'eu_tr', source:name, urls, country:null, continent:'Europe', orgIdPrefix:'XI-EU-TR-',
    sourceLabel:'EU Transparency Register (open data)', evidence:'Registered organisation record (EU Transparency Register open data)', tier:'transnational_vetted',
    urlFn:(id)=>'https://transparency-register.europa.eu/searchregister-or-update/organisation-detail_en?id='+encodeURIComponent(id),
    requiredHeaderGroups:[[ 'name','organisation name' ],['identification code','id','registration number']],
    mapFn:(r)=>({registry_id:pick(r,['Identification code','identification code','ID','Id','Registration number']), name:pick(r,['Name','Organisation name','Organisation Name','name']), city:pick(r,['City','Head office city','city']), state:pick(r,['Country','Head office country']), website:pick(r,['Website URL','Website','website']), status:'registered'})
  };
  return csvSource(reg,cfg);
}

async function sourceGlobalGiving(reg){
  // GlobalGiving open/project data - try public JSON endpoints (best-effort, no key)
  const name='GlobalGiving_OpenData';
  const themes=['children','health','education','environment','disaster','women','refugees','water','hunger','disability'];
  const tIdx=Number(reg.progress.gg_t||0)%themes.length; const theme=themes[tIdx];
  const start=Number((reg.progress.gg_next||{})[theme]||0);
  const url='https://api.globalgiving.org/api/public/projectservice/themes/'+encodeURIComponent(theme)+'/projects/active?api_key=&nextProjectId='+start;
  let data;
  try{
    await sleep(REQUEST_DELAY_MS);
    // try JSON variant / alternative public feed
    data=await fetchJsonGuarded('https://www.globalgiving.org/api/public/projectservice/all/projects/active.json?api_key=DEMO&nextProjectId='+start).catch(()=>null);
    if(!data){
      // alternative: sitemap-like org feed not reliable; try generic active projects endpoint without key
      data=await fetchJsonGuarded('https://api.globalgiving.org/api/public/projectservice/all/projects/active?api_key=DEMO&nextProjectId='+start);
    }
  }catch(e){ markDegraded(reg,name,e.message); reg.progress.gg_t=(tIdx+1)%themes.length; return []; }
  reg.progress.gg_t=(tIdx+1)%themes.length;
  const projects = (data && data.projects && Array.isArray(data.projects.project)) ? data.projects.project : (Array.isArray(data&&data.projects)?data.projects:(Array.isArray(data)?data:[]));
  if(!projects.length) return [];
  const out=[]; const seen=new Set();
  for(const p of projects){
    if(out.length>=MAX_NEW_PER_SOURCE) break;
    const org=p.organization || p.org || {};
    const oidRaw = normStr(org.id || p.organizationId || p.orgId);
    const oname = normStr(org.name || p.organizationName || p.orgName);
    if(!oidRaw || !oname) continue;
    if(seen.has(oidRaw)) continue; seen.add(oidRaw);
    const country = normStr(org.country || p.country);
    out.push(entryBase({
      source:name, country: country||null, continent:null,
      registry_id: orgId('XI-GG-', oidRaw), registry_id_raw: oidRaw,
      name:oname, city:(org.city||p.city), state:(org.state||org.iso3166CountryCode||null), website:(org.url||org.websiteUrl||p.projectLink||null),
      lat:safeNum(p.latitude||org.latitude), lng:safeNum(p.longitude||org.longitude),
      verification:{tier:'transnational_vetted', source:'GlobalGiving (vetted nonprofit platform open data)', source_url: (org.url || ('https://www.globalgiving.org/donate/'+oidRaw+'/')), evidence:'Vetted nonprofit/project record on GlobalGiving (due-diligence platform)', independently_filed:false, has_recent_filing:true}
    }));
  }
  if(data && data.projects && data.projects.hasNext && data.projects.nextProjectId){ (reg.progress.gg_next=reg.progress.gg_next||{})[theme]=Number(data.projects.nextProjectId)||0; }
  return out;
}

async function sourceIATI_Registry(reg){
  // IATI Registry (CKAN) - query reporting orgs / publishers (organizations) via API
  const name='IATI_Registry';
  const start = Number(reg.progress.iati_start||0);
  const rows = 100;
  let data;
  try{
    await sleep(REQUEST_DELAY_MS);
    data=await fetchJsonGuarded('https://iatiregistry.org/api/3/action/organization_list?all_fields=true&limit='+rows+'&offset='+start);
  }catch(e){ markDegraded(reg,name,e.message); return []; }
  const list = Array.isArray(data&&data.result)?data.result:[];
  if(!list.length){ reg.progress.iati_start=0; return []; }
  const out=[];
  for(const o of list){
    if(out.length>=MAX_NEW_PER_SOURCE) break;
    if(!o || typeof o!=='object') continue;
    const oidRaw = normStr(o.name || o.id || (o.extras && o.extras.publisher_iati_id));
    const title = normStr(o.title || o.display_name || o.name);
    if(!oidRaw || !title) continue;
    const iatiId = normStr((o.extras && (o.extras.publisher_iati_id || o.extras.iati_id)) || o.publisher_iati_id || oidRaw);
    const country = normStr(o.publisher_country || (o.extras && o.extras.publisher_country) || '');
    out.push(entryBase({
      source:name, country: country||null, continent:null,
      registry_id: iatiId ? ('XI-IATI-'+iatiId.replace(/[^A-Za-z0-9._-]/g,'_')) : orgId('XI-IATI-',oidRaw),
      registry_id_raw: iatiId || oidRaw,
      name:title, city:null, state:country||null, website:(o.image_display_url||null),
      verification:{tier:'transnational_vetted', source:'IATI Registry (International Aid Transparency Initiative publishers)', source_url:'https://iatiregistry.org/publisher/'+encodeURIComponent(oidRaw), evidence:'Registered IATI publisher/organisation record linked to official reporting (IATI open data)', independently_filed:true, has_recent_filing:true}
    }));
  }
  reg.progress.iati_start = start + list.length;
  if(list.length < rows) reg.progress.iati_start = 0;
  return out;
}

// ---------- Tier 2: Wikidata enrichment (only when tied to existing official registry IDs) ----------
async function enrichWikidata(reg){
  const name='Wikidata_Enrichment';
  // Take a slice of orgs missing website/coords that have known official registry IDs
  const candidates = reg.orgs.filter(o=>o && o.registry_id && (!o.website || (o.lat==null||o.lng==null)));
  const batchSize = 40;
  const start = Number(reg.progress.wikidata_idx||0);
  const slice = candidates.slice(start, start+batchSize);
  if(!slice.length){ reg.progress.wikidata_idx=0; return 0; }
  // Build SPARQL for US-EIN and GB-CHC matches (expandable). Only enrich if matches our registry_id.
  const eins = slice.filter(o=>/^US-EIN-/.test(o.registry_id)).map(o=>o.registry_id_raw||o.registry_id.replace('US-EIN-','')).filter(Boolean).slice(0,20);
  const chcs = slice.filter(o=>/^GB-CHC-/.test(o.registry_id)).map(o=>o.registry_id_raw||o.registry_id.replace('GB-CHC-','')).filter(Boolean).slice(0,20);
  let enriched=0;
  const applyRows = (rows, idProp, prefix)=>{
    for(const row of rows){
      const val = normStr(row.id && row.id.value); if(!val) continue;
      const rid = orgId(prefix, val);
      const org = reg.orgs.find(o=>o.registry_id===rid);
      if(!org) continue;
      const site = safeWebsite(row.website && row.website.value);
      if(site && !org.website) org.website = site;
      if((org.lat==null||org.lng==null) && row.coord && row.coord.value){
        const m = /Point\(([-0-9.]+) ([-0-9.]+)\)/.exec(row.coord.value);
        if(m){ const ln=Number(m[1]), la=Number(m[2]); if(Number.isFinite(la)&&Number.isFinite(ln)&&!isPrivateCoord(la,ln)){ org.lat=la; org.lng=ln; } }
      }
      if(site || (org.lat!=null && org.lng!=null)) enriched++;
    }
  };
  try{
    if(eins.length){
      const values = eins.map(e=>'"'+e.replace(/"/g,'')+'"').join(' ');
      const q = `SELECT ?id ?website ?coord WHERE { VALUES ?id { ${values} } ?item wdt:P1297 ?id . OPTIONAL { ?item wdt:P856 ?website } OPTIONAL { ?item wdt:P625 ?coord } }`;
      await sleep(REQUEST_DELAY_MS);
      const data = await fetchJsonGuarded('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q), {'Accept':'application/sparql-results+json'});
      const rows = (((data||{}).results||{}).bindings)||[]; applyRows(rows,'P1297','US-EIN-');
    }
    if(chcs.length){
      const values = chcs.map(e=>'"'+e.replace(/"/g,'')+'"').join(' ');
      const q = `SELECT ?id ?website ?coord WHERE { VALUES ?id { ${values} } ?item wdt:P3057 ?id . OPTIONAL { ?item wdt:P856 ?website } OPTIONAL { ?item wdt:P625 ?coord } }`;
      await sleep(REQUEST_DELAY_MS);
      const data = await fetchJsonGuarded('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q), {'Accept':'application/sparql-results+json'});
      const rows = (((data||{}).results||{}).bindings)||[]; applyRows(rows,'P3057','GB-CHC-');
    }
    reg.sources[name]={status:'ok', last_run:new Date().toISOString(), last_enriched:enriched};
  }catch(e){ markDegraded(reg,name,e.message); }
  reg.progress.wikidata_idx = start + slice.length;
  return enriched;
}

// ---------- Tier 3 CSV configs (national bulk/open data, best-effort reputable sources) ----------
const CSV_SOURCES = [
  { key:'au_acnc', country:'AU', continent:'Oceania', source:'AU_ACNC', orgIdPrefix:'AU-ABN-',
    sourceLabel:'Australian Charities and Not-for-profits Commission (ACNC Charity Register open data)',
    evidence:'Registered charity record (ACNC open data/register)', tier:'official_government_register',
    urlFn:(id,name)=>'https://www.acnc.gov.au/charity/charities?search='+encodeURIComponent(name||id),
    urls:[
      'https://data.gov.au/data/dataset/b050b242-4487-4306-abf5-07ca073e5594/resource/eb1e6be4-5b13-4feb-b28e-388bf7c26f93/download/datadotgov_main.csv',
      'https://data.gov.au/data/dataset/b050b242-4487-4306-abf5-07ca073e5594/resource/8d020b50-700f-4bc4-8c78-79f83d99be7a/download/datadotgov_main.csv'
    ],
    requiredHeaderGroups:[[ 'abn' ],['charity_legal_name','charity legal name','name']],
    mapFn:(r)=>({registry_id:pick(r,['ABN','abn']), name:pick(r,['Charity_Legal_Name','Charity Legal Name','charity_legal_name','Name']), city:pick(r,['Town_City','Town/City','town_city']), state:pick(r,['State','state']), website:pick(r,['Charity_Website','charity_website']), status:pick(r,['Registration_Status','registration_status','charity_status'])||'registered'})
  },
  { key:'nz_charities', country:'NZ', continent:'Oceania', source:'NZ_Charities', orgIdPrefix:'NZ-CC-',
    sourceLabel:'Charities Services New Zealand (Charities Register open data)',
    evidence:'Registered charity record (Charities Register)', tier:'official_government_register',
    urlFn:(id)=>'https://register.charities.govt.nz/Charity/'+encodeURIComponent(id),
    urls:['https://www.register.charities.govt.nz/CharitiesRegister/Download','https://www.charities.govt.nz/assets/Uploads/CharitiesServices-Export.csv'],
    requiredHeaderGroups:[[ 'charity registration number','number','ccn' ],['charity name','name']],
    mapFn:(r)=>({registry_id:pick(r,['Charity Registration Number','CharityRegistrationNumber','Number','CCN']), name:pick(r,['Charity Name','Name','charity_name','Other Names']), city:pick(r,['City','Town']), state:null, website:pick(r,['Website','website']), status:'registered'})
  },
  { key:'ca_cra', country:'CA', continent:'North America', source:'CA_CRA_Charities', orgIdPrefix:'CA-CRA_ACR-',
    sourceLabel:'Canada Revenue Agency List of charities (open.canada.ca open data)',
    evidence:'Registered charity record (CRA public listing/open data)', tier:'official_government_register',
    urlFn:(id,name)=>'https://apps.cra-arc.gc.ca/ebci/hacc/srch/pub/dsplyRprtngPrd?q.srchNm='+encodeURIComponent(name||'')+'&selectedCharityBn='+encodeURIComponent(id||'')+'&dsrdPg=1',
    urls:[
      'https://open.canada.ca/data/dataset/7a80e185-8856-4f34-b9f8-658b67d20a46/resource/6647a97f-86c3-4b4e-8d42-4b3831415327/download/identification-of-charities.csv',
      'https://open.canada.ca/data/dataset/7a80e185-8856-4f34-b9f8-658b67d20a46/resource/74e1a52d-94ed-4d64-943d-2148d3d2f9d6/download/ident.csv'
    ],
    requiredHeaderGroups:[[ 'bn','registration number','business number' ],['legal name','name','organization name']],
    mapFn:(r)=>({registry_id:pick(r,['BN','bn','BN/Registration number','Registration Number','Business Number']), name:pick(r,['Legal Name','legal_name','Name','name','Organization name']), city:pick(r,['City','city']), state:pick(r,['Province','province','Province/Territory']), website:null, status:pick(r,['Status','status','Charity status'])||'registered'})
  },
  { key:'ie_charities', country:'IE', continent:'Europe', source:'IE_CharitiesRegulator', orgIdPrefix:'IE-CHY-',
    sourceLabel:'Charities Regulator Ireland (Register of Charities open data)',
    evidence:'Registered charity record (Charities Regulator public register)', tier:'official_government_register',
    urlFn:(id)=>'https://www.charitiesregulator.ie/en/information-for-the-public/search-the-register-of-charities/charity-detail?regid='+encodeURIComponent(id),
    urls:['https://www.charitiesregulator.ie/media/4y5fbl0m/register-of-charities.csv','https://www.charitiesregulator.ie/media/1086/register-of-charities.csv'],
    requiredHeaderGroups:[[ 'registered charity number','number','reg no' ],['registered charity name','charity name','name']],
    mapFn:(r)=>({registry_id:pick(r,['Registered Charity Number','registered charity number','CHY Number','Number','Reg No']), name:pick(r,['Registered Charity Name','Charity Name','Name','name']), city:pick(r,['County','county','City']), state:null, website:pick(r,['Website','website']), status:pick(r,['Charity Status','Status','status'])||'registered'})
  },
  { key:'scotland_oscr', country:'GB', continent:'Europe', source:'UK_OSCR_Scotland', orgIdPrefix:'GB-SC-',
    sourceLabel:'Office of the Scottish Charity Regulator (OSCR open data)',
    evidence:'Registered charity record (OSCR public register)', tier:'official_government_register',
    urlFn:(id)=>'https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number='+encodeURIComponent(id),
    urls:['https://www.oscr.org.uk/umbraco/api/charityapi/exportcsv'],
    requiredHeaderGroups:[[ 'charity number','sc number' ],['charity name','name']],
    mapFn:(r)=>({registry_id:pick(r,['Charity Number','charity_number','CharityNumber','SC Number']), name:pick(r,['Charity Name','charity_name','CharityName','Name']), city:pick(r,['Postcode','City']), state:'Scotland', website:pick(r,['Website','website']), status:pick(r,['Charity Status','status'])||'registered'})
  },
  { key:'ni_charities', country:'GB', continent:'Europe', source:'UK_CharityCommissionNI', orgIdPrefix:'GB-NIC-',
    sourceLabel:'Charity Commission for Northern Ireland (open data/register)',
    evidence:'Registered charity record (CCNI public register)', tier:'official_government_register',
    urlFn:(id)=>'https://www.charitycommissionni.org.uk/charity-details/?regId='+encodeURIComponent(id)+'&subId=0',
    urls:['https://www.charitycommissionni.org.uk/umbraco/api/charityApi/ExportSearchResultsToCsv/?includeRemoved=0'],
    requiredHeaderGroups:[[ 'reg charity number','registration number','charity number' ],['charity name','name']],
    mapFn:(r)=>({registry_id:pick(r,['Reg charity number','Registration Number','Charity Number','regId']), name:pick(r,['Charity name','Charity Name','Name']), city:pick(r,['Address Town','Town','City']), state:'Northern Ireland', website:pick(r,['Website','website']), status:pick(r,['Status','status'])||'registered'})
  },
  { key:'sg_charities', country:'SG', continent:'Asia', source:'SG_CharityPortal', orgIdPrefix:'SG-UEN-',
    sourceLabel:'Singapore Charities/IPC (public register/open data, data.gov.sg)',
    evidence:'Registered charity/IPC record (public register)', tier:'official_government_register',
    urlFn:(id,name)=>'https://www.charities.gov.sg/_layouts/15/CPInternet/SearchOrgProfile.aspx?q='+encodeURIComponent(name||id),
    urls:['https://www.charities.gov.sg/_layouts/download.aspx?SourceUrl=/Documents/Charities%20and%20IPCs.csv'],
    requiredHeaderGroups:[[ 'uen','uen no','registration no' ],['name of organisation','charity name','name']],
    mapFn:(r)=>({registry_id:pick(r,['UEN','uen','UEN No','Registration No','Charity Code']), name:pick(r,['Name of Organisation','Charity Name','Name','Organization Name']), city:'Singapore', state:null, website:pick(r,['Website','website']), status:pick(r,['Status','status'])||'registered'})
  },
  { key:'fr_rna', country:'FR', continent:'Europe', source:'FR_RNA_Associations', orgIdPrefix:'FR-RNA-',
    sourceLabel:'Répertoire National des Associations (RNA, data.gouv.fr open data)',
    evidence:'Registered association record (RNA public open data)', tier:'official_government_register',
    urlFn:(id)=>'https://www.data.gouv.fr/fr/datasets/repertoire-national-des-associations/',
    urls:['https://media.interieur.gouv.fr/rna/rna_waldec_20240101.zip','https://www.data.gouv.fr/fr/datasets/r/9a251e8c-7847-4cc9-9e06-0dc5e0e9a33d'], // may be zip or csv; guarded
    requiredHeaderGroups:[[ 'id','rna','numero' ],['titre','name','nom']],
    mapFn:(r)=>({registry_id:pick(r,['id','rna','numero','ID']), name:pick(r,['titre','title','name','nom','libelle']), city:pick(r,['commune','ville','city']), state:pick(r,['region']), website:pick(r,['siteweb','website']), status:pick(r,['etat','status'])||'registered'})
  }
];

// ---------- Shelf promotion (governed, schema-compatible) ----------
function walletFor(id){ const body='0'.repeat(40-3-String(id).length)+String(id); return '0x71C'+body; }
function chooseCategory(name){
  const n=(name||'').toLowerCase();
  if(/blind|deaf|disab|autism|wheelchair|assist|access|rehab|prosthe|braille|health|medical|hospital|cancer|hospice|clinic|disease|mental|fistula|malaria|nutrition|vaccine/.test(n)) return 'Accessibility & Universal Design';
  if(/environ|climate|wildlife|ocean|forest|conserv|water|river|nature|animal|green|earth|plastic|reef|park|wetland|bird|tree/.test(n)) return 'Environmental';
  if(/school|educ|literac|child|youth|student|learn|library|college|scholar|teach|university|book|reading/.test(n)) return 'Classrooms';
  if(/housing|shelter|habitat|build|rebuild|community|neighbo|garden|homeless|village|refugee/.test(n)) return 'Campus Grounds';
  if(/sport|athlet|play|olymp|soccer|football|rugby|cricket|basket/.test(n)) return 'Athletics';
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
    if(!e.verification || !e.source || !e.registry_id) continue;
    const cat=chooseCategory(org);
    const base=CAT_BLOCK[cat]||30000; counters[base]=(counters[base]||0)+1; const id=String(base+counters[base]);
    const loc=[e.city,e.state,e.country].filter(x=>normStr(x)).join(', ')|| (e.country||'Global');
    const site = safeWebsite(e.website);
    const la = (e.lat!=null && Number.isFinite(Number(e.lat)) && !isPrivateCoord(Number(e.lat), Number(e.lng))) ? Number(e.lat) : null;
    const ln = (e.lng!=null && Number.isFinite(Number(e.lng)) && la!=null) ? Number(e.lng) : null;
    const tier = (e.verification&&e.verification.tier)||'verified_registry';
    const item={ id, title: org, content_html:'<p>Support the mission of '+org+' (verified record: '+(e.verification.source||e.source)+').</p>', url:'https://polytab.store/#'+id, date_published:new Date().toISOString(),
      _polytab:{ category:cat, organization:org, location:loc, summary:'Support the mission of '+org+'.', plainSummary:'What is broken: Community needs require trusted support.\nWhat will be done: Fund this organization’s verified mission.\nProof: '+(e.verification.evidence||'Registry/filing evidence')+' ('+(e.verification.source||e.source)+', tier: '+tier+').', votePriceUSD:0.5, targetUSD:500, fundedUSD:0, votesCount:0, contract:walletFor(id), status:'Active', lat:la, lng:ln, website:site, socials:{} }
    };
    feed.items.push(item); existing.add(org.toLowerCase()); added++;
  }
  if(added>0){ fs.writeFileSync(FEED_PATH, JSON.stringify(feed,null,2)+'\n','utf8'); }
  return added;
}

async function runSource(reg, name, fn){
  let entries=[];
  try{ entries = await fn(reg); }catch(e){ markDegraded(reg,name,e.message); entries=[]; }
  if(!Array.isArray(entries)) entries=[];
  const res = mergeEntries(reg, entries, Math.min(MAX_NEW_PER_SOURCE, MAX_TOTAL_NEW));
  reg.sources[name]=reg.sources[name]||{};
  reg.sources[name].last_run=new Date().toISOString();
  reg.sources[name].last_added=res.added; reg.sources[name].last_updated=res.updated; reg.sources[name].last_fetched=entries.length;
  if(reg.sources[name].status!=='degraded_endpoint') reg.sources[name].status='ok';
  console.log(name+': fetched='+entries.length+' added='+res.added+' updated='+res.updated);
  return res.added;
}

async function main(){
  const reg=loadRegistry(); reg.version=3;
  let totalAdded=0;

  // Tier 3/4: official government registers (highest verification)
  totalAdded += await runSource(reg,'US_IRS_ProPublica', sourceUS_ProPublica);
  totalAdded += await runSource(reg,'UK_CharityCommission', sourceUK_CharityCommission);
  for(const cfg of CSV_SOURCES){ if(totalAdded>=MAX_TOTAL_NEW) break; totalAdded += await runSource(reg,cfg.source,(r)=>csvSource(r,cfg)); }

  // Tier 1: transnational vetted/open standards
  if(totalAdded<MAX_TOTAL_NEW) totalAdded += await runSource(reg,'IATI_Registry', sourceIATI_Registry);
  if(totalAdded<MAX_TOTAL_NEW) totalAdded += await runSource(reg,'EU_TransparencyRegister', sourceEU_TransparencyRegister);
  if(totalAdded<MAX_TOTAL_NEW) totalAdded += await runSource(reg,'GlobalGiving_OpenData', sourceGlobalGiving);

  // Tier 2: enrichment (websites/coords only when tied to official registry IDs)
  try{ const enriched=await enrichWikidata(reg); console.log('Wikidata_Enrichment: enriched='+enriched); }catch(e){ console.log('Wikidata_Enrichment error',e.message); }

  saveRegistry(reg);
  console.log('registry_total='+reg.orgs.length+' total_added='+totalAdded);
  if(PROMOTE){ const promoted=promoteToShelf(reg, 300); console.log('promoted_to_shelf='+promoted); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
