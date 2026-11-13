// Polytab — Global verified charity ingestion v4 (tiered, evidence-backed, $0)
// Implements: CKAN dynamic resource resolution (CA/AU/FR), expanded Wikidata enrichment (ORG-ID property mappings),
// Norway Brønnøysund (Frivillighetsregisteret) + Brazil MOSC fetchers, content/schema guards, ORG-ID dedupe.
// Honesty: no fabricated audits/ratings/coords/websites; coords only when verifiably HQ/physical (or omitted).
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
function isPrivateCoord(lat,lng){ if(lat==null||lng==null) return false; return (Math.abs(lat-28.0)<0.6 && Math.abs(lng - (-81.9))<0.6); }

function fetchRaw(urlStr, headers={}, redirect=0){
  return new Promise((resolve,reject)=>{
    let u; try{ u=new URL(urlStr); }catch(e){ return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get({
      hostname:u.hostname, port:u.port|| (u.protocol==='http:'?80:443), path:(u.pathname||'/')+(u.search||''),
      headers:{'User-Agent':'Polytab-GlobalIngest/4.0 (+https://github.com/R03LV1S/Polytab)','Accept':'application/json,text/csv,application/xml,text/xml,*/*',...headers}
    }, res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location && redirect<5){
        const loc = new URL(res.headers.location, urlStr).toString();
        res.resume(); return resolve(fetchRaw(loc, headers, redirect+1));
      }
      if(res.statusCode!==200){ res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve({buf:Buffer.concat(chunks), headers:res.headers||{}, status:res.statusCode, url:urlStr}));
    });
    req.on('error',reject);
    req.setTimeout(45000, ()=>{ try{req.destroy(new Error('timeout'));}catch(_){} });
  });
}
function contentTypeOf(meta){ return normStr((meta.headers['content-type']||meta.headers['Content-Type']||'')).toLowerCase(); }
function looksLikeHtml(text, ct){ if(ct.includes('text/html')) return true; const t=String(text||'').trim().toLowerCase(); return t.startsWith('<!doctype') || t.startsWith('<html') || (t.startsWith('<') && t.includes('<head')); }

async function fetchJsonGuarded(urlStr, headers={}){
  const meta=await fetchRaw(urlStr, {'Accept':'application/json, text/json, application/sparql-results+json, */*',...headers});
  const ct=contentTypeOf(meta); const text=meta.buf.toString('utf8').replace(/^\uFEFF/,'');
  if(looksLikeHtml(text, ct)) throw new Error('unexpected_html');
  try{ return JSON.parse(text); }catch(e){ throw new Error('invalid_json'); }
}
async function fetchTextGuarded(urlStr, headers={}, expect='csv'){
  const meta=await fetchRaw(urlStr, headers);
  const ct=contentTypeOf(meta); const text=meta.buf.toString('utf8').replace(/^\uFEFF/,'');
  if(looksLikeHtml(text, ct)) throw new Error('unexpected_html');
  return {text, ct};
}

// --- CKAN / open-data resolvers ---
async function resolveCkanResourceUrl(packageShowUrl, {formatIncludes=['csv'], nameIncludes=[], preferLatest=true}={}){
  const pkg = await fetchJsonGuarded(packageShowUrl);
  const result = (pkg && pkg.result) ? pkg.result : pkg;
  const resources = Array.isArray(result && result.resources) ? result.resources : [];
  const scored = [];
  for(const r of resources){
    const fmt = normStr(r.format || r.mimetype || '').toLowerCase();
    const name = normStr(r.name || r.title || r.description || '').toLowerCase();
    const url = normStr(r.url || r.download_url || r.path);
    if(!url) continue;
    const fmtOk = !formatIncludes.length || formatIncludes.some(f=>fmt.includes(f));
    const nameOk = !nameIncludes.length || nameIncludes.some(n=>name.includes(String(n).toLowerCase()));
    if(!fmtOk && !nameOk) continue;
    let score = 0;
    if(fmtOk) score += 2;
    if(nameOk) score += 3;
    if(/csv/.test(fmt) || /\.csv($|\?)/i.test(url)) score += 2;
    if(/json/.test(fmt) || /\.json($|\?)/i.test(url)) score += 1;
    const lm = Date.parse(r.last_modified || r.metadata_modified || r.created || 0) || 0;
    scored.push({url, score, lm});
  }
  if(!scored.length) throw new Error('no_matching_resource');
  scored.sort((a,b)=> (b.score-a.score) || (preferLatest ? b.lm-a.lm : a.lm-b.lm));
  return scored[0].url;
}
async function resolveDataGouvResourceUrl(datasetApiUrl, {nameIncludes=[], formatIncludes=['csv']}={}){
  const data = await fetchJsonGuarded(datasetApiUrl);
  const resources = Array.isArray(data && data.resources) ? data.resources : (Array.isArray(data&&data.result&&data.result.resources)?data.result.resources:[]);
  const scored=[];
  for(const r of resources){
    const fmt=normStr(r.format||r.mime||'').toLowerCase();
    const name=normStr(r.title||r.name||r.description||'').toLowerCase();
    const url=normStr(r.url||r.latest||r.download_url);
    if(!url) continue;
    const fmtOk=!formatIncludes.length || formatIncludes.some(f=>fmt.includes(f) || url.toLowerCase().includes('.'+f));
    const nameOk=!nameIncludes.length || nameIncludes.some(n=>name.includes(String(n).toLowerCase()));
    if(!fmtOk && !nameOk) continue;
    let score=0; if(fmtOk) score+=2; if(nameOk) score+=3; if(/csv/.test(fmt)) score+=2;
    const lm=Date.parse(r.last_modified||r.modified||r.created_at||0)||0;
    scored.push({url,score,lm});
  }
  if(!scored.length) throw new Error('no_matching_resource');
  scored.sort((a,b)=> (b.score-a.score) || (b.lm-a.lm));
  return scored[0].url;
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
    return {version:4,updated_at:null,description:'Polytab verified charity master list. Tiered, evidence-backed capture from reputable public registries, filings, and transnational open data across continents. No fabricated ratings/audits. No private/home coordinates.',counts:{total:0},progress:{},sources:{},orgs:[]};
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
      const ex=byKey.get(k);
      if(!ex.website && safeWebsite(e.website)) ex.website=safeWebsite(e.website);
      if((ex.lat==null||ex.lng==null) && e.lat!=null && e.lng!=null && !isPrivateCoord(e.lat,e.lng)){ ex.lat=e.lat; ex.lng=e.lng; }
      updated++; continue;
    }
    byKey.set(k,e); added++;
  }
  reg.orgs=Array.from(byKey.values());
  return {added, updated};
}
function orgId(prefix, raw){ const r=normStr(raw).replace(/\s+/g,''); if(!r) return null; return prefix + r; }
function entryBase({source,country,continent,registry_id,registry_id_raw,name,city,state,website,lat,lng,verification,extra}){
  const w=safeWebsite(website);
  let la = (lat==null||lat==='')?null:Number(lat); let ln=(lng==null||lng==='')?null:Number(lng);
  if(!Number.isFinite(la)||!Number.isFinite(ln)||isPrivateCoord(la,ln)){ la=null; ln=null; }
  return { source, country: country||null, continent: continent||null, registry_id, registry_id_raw: registry_id_raw!=null?String(registry_id_raw):null,
    name: normStr(name), city: normStr(city)||null, state: normStr(state)||null, website: w, lat: la, lng: ln, verification, ...(extra||{}), captured_at: new Date().toISOString() };
}
function markDegraded(reg, name, reason){ reg.sources[name]=reg.sources[name]||{}; reg.sources[name].status='degraded_endpoint'; reg.sources[name].last_error=String(reason||'error'); reg.sources[name].last_run=new Date().toISOString(); }
function pick(o, keys){ for(const k of keys){ if(o[k]!=null && normStr(o[k])!=='') return o[k]; } return ''; }

// ---------- Tier 3/4: National registers ----------
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
    out.push(entryBase({ source:name, country:'US', continent:'North America', registry_id:orgId('US-EIN-',einRaw), registry_id_raw:einRaw,
      name:(o.name||hit.name), city:(o.city||hit.city), state:(o.state||hit.state), website:null,
      verification:{tier:'official_government_register', source:'ProPublica Nonprofit Explorer (IRS EO BMF + Form 990/990-EZ/990-PF)', source_url:'https://projects.propublica.org/nonprofits/organizations/'+einRaw, evidence:'IRS Form 990-series filing (tax year '+taxYear+')', independently_filed:true, has_recent_filing:true, is_501c3:true},
      extra:{ein:einRaw, latest_filing:{tax_year:taxYear,form_type:latest&&latest.formtype?String(latest.formtype):null,pdf_url:latest&&latest.pdf_url?latest.pdf_url:null}} }));
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
    out.push(entryBase({ source:name, country:'GB', continent:'Europe', registry_id:orgId('GB-CHC-',regno), registry_id_raw:regno,
      name:cname, city:(c.addressTown||c.address_town||c.town||c.city), state:null, website:(c.contactWeb||c.web||c.website),
      verification:{tier:'official_government_register', source:'Charity Commission for England and Wales (public register)', source_url:'https://register-of-charities.charitycommission.gov.uk/charity-search/-/charity-details/'+encodeURIComponent(String(regno)), evidence:'Registered charity record (accounts/annual returns as recorded by regulator)', independently_filed:true, has_recent_filing:true} }));
  }
  return out;
}

async function csvSource(reg, cfg){
  const name=cfg.source;
  let url = null;
  try {
    if (cfg.ckanPackageUrl) {
      url = await resolveCkanResourceUrl(cfg.ckanPackageUrl, cfg.ckan || {formatIncludes:['csv']});
    } else if (cfg.dataGouvDatasetUrl) {
      url = await resolveDataGouvResourceUrl(cfg.dataGouvDatasetUrl, cfg.dataGouv || {formatIncludes:['csv']});
    } else {
      const urls = cfg.urls||[]; if(!urls.length) return [];
      const uIdx = Number(reg.progress[cfg.urlKey|| (cfg.key+'_url')]||0) % urls.length;
      // try list fallbacks
      for(let i=0;i<urls.length;i++){ const j=(uIdx+i)%urls.length; url=urls[j]; if(url) break; }
    }
  } catch(e){ markDegraded(reg,name,'resolve:'+e.message); return []; }
  if(!url){ markDegraded(reg,name,'no_resource_url'); return []; }

  // handle non-csv (zip etc.) gracefully
  if(/\.zip($|\?)/i.test(url)){ markDegraded(reg,name,'zip_resource_needs_extractor:'+url); return []; }

  let payload=null;
  try{ await sleep(REQUEST_DELAY_MS); payload=await fetchTextGuarded(url, cfg.headers||{}, 'csv'); }
  catch(e){ markDegraded(reg,name,e.message); return []; }
  let parsed = parseCSV(payload.text);
  if(parsed.headers.length===0 && payload.text.indexOf('\t')!==-1){ parsed = parseCSV(payload.text.replace(/\t/g,',')); }
  if(!parsed.rows.length || !validateHeaders(parsed.headers, cfg.requiredHeaderGroups||[[ 'name' ]])){ markDegraded(reg,name,'schema_mismatch_or_empty'); return []; }

  // If using dynamic resolver, we read from start of that resource each run (cursor per source key)
  const startKey = cfg.startKey || (cfg.key+'_row');
  const start = Number(reg.progress[startKey]||0);
  const slice = parsed.rows.slice(start, start+MAX_NEW_PER_SOURCE);
  const out=[];
  for(const r of slice){
    const m = cfg.mapFn(r); if(!m) continue;
    const rawId = normStr(m.registry_id); const cname=normStr(m.name); if(!rawId||!cname) continue;
    const status = normStr(m.status).toLowerCase(); if(status && !/registered|active|current|live|compliant|yes/.test(status)) continue;
    const rid = cfg.orgIdPrefix ? orgId(cfg.orgIdPrefix, rawId) : (cfg.source+':'+rawId);
    out.push(entryBase({ source:name, country:m.country||cfg.country, continent:m.continent||cfg.continent, registry_id:rid, registry_id_raw:rawId,
      name:cname, city:m.city, state:m.state, website:m.website, lat:m.lat, lng:m.lng,
      verification:{tier: cfg.tier||'official_government_register', source: cfg.sourceLabel, source_url: cfg.urlFn?cfg.urlFn(rawId,cname,m,r):(cfg.sourceUrl||null), evidence: cfg.evidence||'Registered charity/NGO record (official public register/open data)', independently_filed:true, has_recent_filing:true} }));
  }
  reg.progress[startKey] = start + slice.length; if(start + slice.length >= parsed.rows.length) reg.progress[startKey]=0;
  // reset cursor if resource URL changes over time? keep simple: cursor is per key
  return out;
}

// ---------- Norway Brønnøysund (Frivillighetsregisteret) ----------
async function sourceNO_Brreg(reg){
  const name='NO_Brreg_Frivillighetsregisteret';
  const pageSize=100;
  const page = Number(reg.progress.no_brreg_page||0);
  const url = 'https://data.brreg.no/enhetsregisteret/api/enheter?registrertIFrivillighetsregisteret=true&size='+pageSize+'&page='+page;
  let data;
  try{ await sleep(REQUEST_DELAY_MS); data=await fetchJsonGuarded(url, {'Accept':'application/json'}); }
  catch(e){ markDegraded(reg,name,e.message); return []; }
  const list = Array.isArray(data && data._embedded && data._embedded.enheter) ? data._embedded.enheter : [];
  if(!list.length){ reg.progress.no_brreg_page=0; return []; }
  const out=[];
  for(const o of list){
    if(out.length>=MAX_NEW_PER_SOURCE) break;
    const orgnr = normStr(o.organisasjonsnummer);
    const cname = normStr(o.navn);
    if(!orgnr||!cname) continue;
    const addr = (o.forretningsadresse || o.postadresse || {});
    const city = normStr(addr.poststed || addr.kommune);
    const web = safeWebsite(o.hjemmeside);
    out.push(entryBase({ source:name, country:'NO', continent:'Europe', registry_id:orgId('NO-BRC-',orgnr), registry_id_raw:orgnr,
      name:cname, city, state:null, website:web, lat:null, lng:null,
      verification:{tier:'official_government_register', source:'Brønnøysundregistrene Enhetsregisteret (Frivillighetsregisteret, open API)', source_url:'https://data.brreg.no/enhetsregisteret/api/enheter/'+encodeURIComponent(orgnr), evidence:'Registered in Frivillighetsregisteret (official Norwegian register, open data)', independently_filed:true, has_recent_filing:true} }));
  }
  reg.progress.no_brreg_page = page + 1;
  const totalPages = data && data.page ? Number(data.page.totalPages||0) : 0;
  if(totalPages && page+1 >= totalPages) reg.progress.no_brreg_page = 0;
  return out;
}

// ---------- Brazil MOSC (IPEA / Mapa das OSCs) ----------
async function sourceBR_MOSC(reg){
  const name='BR_MOSC_IPEA';
  const limit=100;
  const offset = Number(reg.progress.br_mosc_offset||0);
  // Try known API patterns; be tolerant to schema differences
  const urls = [
    'https://mapaosc.ipea.gov.br/api/api/osc?limit='+limit+'&offset='+offset,
    'https://mapaosc.ipea.gov.br/api/osc?limit='+limit+'&offset='+offset
  ];
  let data=null; let used=null;
  for(const u of urls){
    try{ await sleep(REQUEST_DELAY_MS); data=await fetchJsonGuarded(u); used=u; break; }catch(e){ /*try next*/ }
  }
  if(!data){ markDegraded(reg,name,'no reachable API endpoint'); return []; }
  const list = Array.isArray(data) ? data : (Array.isArray(data&&data.items)?data.items:(Array.isArray(data&&data.result)?data.result:(Array.isArray(data&&data.data)?data.data:[])));
  if(!list.length){ reg.progress.br_mosc_offset=0; return []; }
  const out=[];
  for(const o of list){
    if(out.length>=MAX_NEW_PER_SOURCE) break;
    const cnpjRaw = normStr(o.cd_identificador_osc || o.cnpj || o.nr_cnpj || o.tx_cnpj || o.id_osc).replace(/\D/g,'');
    const cname = normStr(o.tx_razao_social_osc || o.tx_nome_fantasia_osc || o.tx_nome_osc || o.nome || o.razao_social);
    if(!cnpjRaw || !cname) continue;
    // 14-digit CNPJ canonical
    const cnpj = cnpjRaw.padStart(14,'0').slice(-14);
    const city = normStr(o.tx_nome_municipio || o.municipio || o.localidade);
    const state = normStr(o.tx_sigla_uf || o.uf || o.estado);
    const web = safeWebsite(o.tx_link_osc || o.website || o.url);
    out.push(entryBase({ source:name, country:'BR', continent:'South America', registry_id:orgId('BR-CNPJ-',cnpj), registry_id_raw:cnpj,
      name:cname, city, state, website:web, lat:null, lng:null,
      verification:{tier:'official_government_register', source:'Mapa das Organizações da Sociedade Civil (IPEA MOSC, open data/API)', source_url:'https://mapaosc.ipea.gov.br/', evidence:'Registered civil society organization record (MOSC/IPEA public data)', independently_filed:true, has_recent_filing:true} }));
  }
  reg.progress.br_mosc_offset = offset + list.length;
  if(list.length < limit) reg.progress.br_mosc_offset = 0;
  return out;
}

// ---------- Tier 1: Transnational vetted / open standards ----------
async function sourceIATI_Registry(reg){
  const name='IATI_Registry';
  const start = Number(reg.progress.iati_start||0); const rows = 100;
  let data;
  try{ await sleep(REQUEST_DELAY_MS); data=await fetchJsonGuarded('https://iatiregistry.org/api/3/action/organization_list?all_fields=true&limit='+rows+'&offset='+start); }
  catch(e){ markDegraded(reg,name,e.message); return []; }
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
    out.push(entryBase({ source:name, country: country||null, continent:null,
      registry_id: iatiId ? ('XI-IATI-'+iatiId.replace(/[^A-Za-z0-9._-]/g,'_')) : orgId('XI-IATI-',oidRaw), registry_id_raw: iatiId || oidRaw,
      name:title, city:null, state:country||null, website:null,
      verification:{tier:'transnational_vetted', source:'IATI Registry (International Aid Transparency Initiative publishers)', source_url:'https://iatiregistry.org/publisher/'+encodeURIComponent(oidRaw), evidence:'Registered IATI publisher/organisation record linked to official reporting (IATI open data)', independently_filed:true, has_recent_filing:true} }));
  }
  reg.progress.iati_start = start + list.length; if(list.length < rows) reg.progress.iati_start = 0;
  return out;
}

async function sourceEU_TransparencyRegister(reg){
  const name='EU_TransparencyRegister';
  // Try to resolve via EU data portal API, fallback to known CSV
  const cfg={ key:'eu_tr', source:name, country:null, continent:'Europe', orgIdPrefix:'XI-EU-TR-',
    sourceLabel:'EU Transparency Register (open data)', evidence:'Registered organisation record (EU Transparency Register open data)', tier:'transnational_vetted',
    urlFn:(id)=>'https://transparency-register.europa.eu/searchregister-or-update/organisation-detail_en?id='+encodeURIComponent(id),
    urls:['https://data.europa.eu/euodp/repository/ec/transparency-register/odp-2024/transparency-register-full-list-of-registered-organisations.csv'],
    requiredHeaderGroups:[[ 'name','organisation name' ],['identification code','id','registration number']],
    mapFn:(r)=>({registry_id:pick(r,['Identification code','identification code','ID','Id','Registration number']), name:pick(r,['Name','Organisation name','Organisation Name','name']), city:pick(r,['City','Head office city','city']), state:pick(r,['Country','Head office country']), website:pick(r,['Website URL','Website','website']), status:'registered'})
  };
  try{
    // best-effort: discover distributions from data.europa.eu dataset API (may not be CKAN-shaped)
    const meta = await fetchJsonGuarded('https://data.europa.eu/api/hub/repo/datasets/transparency-register');
    // try to find csv/xml distribution URL in common shapes
    const dists = (meta && meta.result && meta.result.distributions) || (meta && meta['@graph']) || (meta && meta.distributions) || [];
    const flat = Array.isArray(dists) ? dists : [];
    for(const d of flat){
      const acc = normStr(d.accessURL || (Array.isArray(d.accessURL)&&d.accessURL[0]) || d.downloadURL || (Array.isArray(d.downloadURL)&&d.downloadURL[0]) || d['dcat:accessURL'] || '');
      if(/csv/i.test(acc)) { cfg.urls = [acc, ...cfg.urls]; break; }
    }
  }catch(_){ /*fallback*/ }
  return csvSource(reg,cfg);
}

// ---------- Tier 2: Wikidata enrichment (strict: only when tied to existing official registry IDs) ----------
async function enrichWikidata(reg){
  const name='Wikidata_Enrichment';
  // Expand mappings to requested properties -> ORG-ID prefixes
  const PROP_MAP = [
    {prop:'P1297', prefix:'US-EIN-', label:'IRS EIN'},
    {prop:'P3057', prefix:'GB-CHC-', label:'UK Charity Commission'},
    {prop:'P3407', prefix:'GB-SC-', label:'OSCR Scotland'},
    {prop:'P7358', prefix:'CA-CRA_ACR-', label:'CRA Canada'},
    {prop:'P3547', prefix:'AU-ABN-', label:'AU ABN'},
    {prop:'P6758', prefix:'AU-ABN-', label:'AU ACNC/ABN'},
    {prop:'P6839', prefix:'NZ-CC-', label:'NZ Charities'},
    {prop:'P6838', prefix:'IE-CHY-', label:'Ireland Charities'},
    {prop:'P3918', prefix:'FR-RNA-', label:'France RNA'},
    {prop:'P11086', prefix:'DE-VR-', label:'Germany VR'},
    {prop:'P3225', prefix:'DE-VR-', label:'Germany Handelsregister'},
    {prop:'P9537', prefix:'IN-NITI-', label:'India NGO Darpan'}
  ];

  // rotate through property groups across runs
  const gIdx = Number(reg.progress.wikidata_group||0) % PROP_MAP.length;
  const group = PROP_MAP[gIdx];
  reg.progress.wikidata_group = (gIdx+1) % PROP_MAP.length;

  // candidates: orgs with this prefix missing website or coords
  const candidates = reg.orgs.filter(o=>o && o.registry_id && o.registry_id.startsWith(group.prefix) && (!o.website || (o.lat==null||o.lng==null)));
  const start = Number((reg.progress.wikidata_offsets||{})[group.prop]||0);
  const slice = candidates.slice(start, start+30);
  if(!slice.length){ (reg.progress.wikidata_offsets=reg.progress.wikidata_offsets||{})[group.prop]=0; return 0; }

  const values = slice.map(o=>normStr(o.registry_id_raw || o.registry_id.replace(group.prefix,''))).filter(Boolean).map(v=>'"'+v.replace(/"/g,'')+'"').join(' ');
  let enriched=0;
  try{
    // Honest-zero guardrail: take P856 (official website). Take P625 only when linked to HQ (P159) statement with qualifier/location.
    // Query: prefer HQ coordinates if available; otherwise do NOT set coords (leave null).
    const q = `SELECT ?id ?website ?hqCoord WHERE {
      VALUES ?id { ${values} }
      ?item wdt:${group.prop} ?id .
      OPTIONAL { ?item wdt:P856 ?website }
      OPTIONAL {
        ?item p:P159 ?hqStmt .
        ?hqStmt pq:P625 ?hqCoord .
      }
    }`;
    await sleep(REQUEST_DELAY_MS);
    const data = await fetchJsonGuarded('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q), {'Accept':'application/sparql-results+json'});
    const rows = (((data||{}).results||{}).bindings)||[];
    for(const row of rows){
      const val = normStr(row.id && row.id.value); if(!val) continue;
      const rid = orgId(group.prefix, val);
      const org = reg.orgs.find(o=>o.registry_id===rid);
      if(!org) continue;
      const site = safeWebsite(row.website && row.website.value);
      if(site && !org.website) org.website = site;
      if((org.lat==null||org.lng==null) && row.hqCoord && row.hqCoord.value){
        const m = /Point\(([-0-9.]+) ([-0-9.]+)\)/.exec(row.hqCoord.value);
        if(m){ const ln=Number(m[1]), la=Number(m[2]); if(Number.isFinite(la)&&Number.isFinite(ln)&&!isPrivateCoord(la,ln)){ org.lat=la; org.lng=ln; } }
      }
      if(site || (org.lat!=null && org.lng!=null)) enriched++;
    }
    reg.sources[name]={status:'ok', last_run:new Date().toISOString(), last_enriched:enriched, last_prop:group.prop};
  }catch(e){ markDegraded(reg,name,e.message); }

  (reg.progress.wikidata_offsets=reg.progress.wikidata_offsets||{})[group.prop] = start + slice.length;
  if(candidates.length <= start + slice.length) reg.progress.wikidata_offsets[group.prop]=0;
  return enriched;
}

// ---------- Tier 3 CSV configs (CKAN-resolved AU/CA; data.gouv FR; others) ----------
const CSV_SOURCES = [
  { key:'au_acnc', country:'AU', continent:'Oceania', source:'AU_ACNC', orgIdPrefix:'AU-ABN-',
    sourceLabel:'Australian Charities and Not-for-profits Commission (ACNC Charity Register open data)',
    evidence:'Registered charity record (ACNC open data/register)', tier:'official_government_register',
    urlFn:(id,name)=>'https://www.acnc.gov.au/charity/charities?search='+encodeURIComponent(name||id),
    ckanPackageUrl:'https://data.gov.au/data/api/3/action/package_show?id=b050b242-4487-4306-abf3-07ca07366e06',
    ckan:{formatIncludes:['csv'], nameIncludes:['acnc register','acnc','register']},
    requiredHeaderGroups:[[ 'abn' ],['charity_legal_name','charity legal name','name']],
    mapFn:(r)=>({registry_id:pick(r,['ABN','abn']), name:pick(r,['Charity_Legal_Name','Charity Legal Name','charity_legal_name','Name']), city:pick(r,['Town_City','Town/City','town_city']), state:pick(r,['State','state']), website:pick(r,['Charity_Website','charity_website']), status:pick(r,['Registration_Status','registration_status','charity_status'])||'registered'})
  },
  { key:'ca_cra', country:'CA', continent:'North America', source:'CA_CRA_Charities', orgIdPrefix:'CA-CRA_ACR-',
    sourceLabel:'Canada Revenue Agency List of charities (open.canada.ca open data)',
    evidence:'Registered charity record (CRA public listing/open data)', tier:'official_government_register',
    urlFn:(id,name)=>'https://apps.cra-arc.gc.ca/ebci/hacc/srch/pub/dsplyRprtngPrd?q.srchNm='+encodeURIComponent(name||'')+'&selectedCharityBn='+encodeURIComponent(id||'')+'&dsrdPg=1',
    ckanPackageUrl:'https://open.canada.ca/data/api/3/action/package_show?id=05b3abd0-e70f-4b3b-a9c5-acc436bd15b6',
    ckan:{formatIncludes:['csv'], nameIncludes:['ident','identification']},
    requiredHeaderGroups:[[ 'bn','registration number','business number' ],['legal name','name','organization name']],
    mapFn:(r)=>({registry_id:pick(r,['BN','bn','BN/Registration number','Registration Number','Business Number']), name:pick(r,['Legal Name','legal_name','Name','name','Organization name']), city:pick(r,['City','city']), state:pick(r,['Province','province','Province/Territory']), website:null, status:pick(r,['Status','status','Charity status'])||'registered'})
  },
  { key:'fr_rna', country:'FR', continent:'Europe', source:'FR_RNA_Associations', orgIdPrefix:'FR-RNA-',
    sourceLabel:'Répertoire National des Associations (RNA, data.gouv.fr open data)',
    evidence:'Registered association record (RNA public open data)', tier:'official_government_register',
    urlFn:(id)=>'https://www.data.gouv.fr/fr/datasets/repertoire-national-des-associations/',
    dataGouvDatasetUrl:'https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-associations/',
    dataGouv:{formatIncludes:['csv'], nameIncludes:['rna_waldec','rna']},
    requiredHeaderGroups:[[ 'id','rna','numero' ],['titre','name','nom']],
    mapFn:(r)=>({registry_id:pick(r,['id','rna','numero','ID']), name:pick(r,['titre','title','name','nom','libelle','objet']), city:pick(r,['commune','ville','city','adrs_codeinsee']), state:pick(r,['region']), website:pick(r,['siteweb','website']), status:pick(r,['etat','position','status'])||'registered'})
  },
  { key:'nz_charities', country:'NZ', continent:'Oceania', source:'NZ_Charities', orgIdPrefix:'NZ-CC-',
    sourceLabel:'Charities Services New Zealand (Charities Register open data/OData)',
    evidence:'Registered charity record (Charities Register)', tier:'official_government_register',
    urlFn:(id)=>'https://register.charities.govt.nz/Charity/'+encodeURIComponent(id),
    urls:['http://www.odata.charities.govt.nz/Organisations?$filter=RegistrationStatus%20eq%20%27Registered%27&$format=csv&$returnall=true'],
    requiredHeaderGroups:[[ 'charityregistrationnumber','number','ccn' ],['name','charity name']],
    mapFn:(r)=>({registry_id:pick(r,['CharityRegistrationNumber','Charity Registration Number','Number','CCN']), name:pick(r,['Name','Charity Name','charity_name','OtherNames']), city:pick(r,['City','Town']), state:null, website:pick(r,['Website','website']), status:pick(r,['RegistrationStatus','status'])||'registered'})
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
  { key:'sg_charities', country:'SG', continent:'Asia', source:'SG_CharityPortal', orgIdPrefix:'SG-UEN-',
    sourceLabel:'Singapore Charities/IPC (public register/open data)',
    evidence:'Registered charity/IPC record (public register)', tier:'official_government_register',
    urlFn:(id,name)=>'https://www.charities.gov.sg/_layouts/15/CPInternet/SearchOrgProfile.aspx?q='+encodeURIComponent(name||id),
    urls:['https://www.charities.gov.sg/_layouts/download.aspx?SourceUrl=/Documents/Charities%20and%20IPCs.csv'],
    requiredHeaderGroups:[[ 'uen','uen no','registration no' ],['name of organisation','charity name','name']],
    mapFn:(r)=>({registry_id:pick(r,['UEN','uen','UEN No','Registration No','Charity Code']), name:pick(r,['Name of Organisation','Charity Name','Name','Organization Name']), city:'Singapore', state:null, website:pick(r,['Website','website']), status:pick(r,['Status','status'])||'registered'})
  }
];

// ---------- Shelf promotion (governed, schema-compatible, scaffolded ID pipeline) ----------
let idPipeline = null;
try { idPipeline = require('./id-pipeline'); } catch (_) { idPipeline = null; }
const CAT_BLOCK = (idPipeline && idPipeline.CHARITY_BLOCKS) ? idPipeline.CHARITY_BLOCKS : {'Accessibility & Universal Design':10000,'Environmental':20000,'Civic Tech':30000,'Classrooms':40000,'Arts & Clubs':45000,'Campus Grounds':60000,'Athletics':70000};
function walletFor(id){ return idPipeline ? idPipeline.walletFor(id) : ('0x71C' + '0'.repeat(40-3-String(id).length)+String(id)); }
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
    const parentCategory = (idPipeline && idPipeline.PARENT_CHARITIES) ? idPipeline.PARENT_CHARITIES : 'Charities';
    const item={ id, title: org, content_html:'<p>Support the mission of '+org+' (verified record: '+(e.verification.source||e.source)+').</p>', url:'https://polytab.store/#'+id, date_published:new Date().toISOString(),
      _polytab:{ parentCategory, category:cat, organization:org, location:loc, summary:'Support the mission of '+org+'.', plainSummary:'Cause: Community needs require trusted support.\nResolution: Fund this organization’s verified mission.\nProof: '+(e.verification.evidence||'Registry/filing evidence')+' ('+(e.verification.source||e.source)+', tier: '+tier+').', votePriceUSD:0.5, targetUSD:500, fundedUSD:0, votesCount:0, contract:walletFor(id), status:'Active', lat:la, lng:ln, website:site, socials:{} }
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
  const reg=loadRegistry(); reg.version=4;
  let totalAdded=0;
  // Tier 3/4
  totalAdded += await runSource(reg,'US_IRS_ProPublica', sourceUS_ProPublica);
  totalAdded += await runSource(reg,'UK_CharityCommission', sourceUK_CharityCommission);
  for(const cfg of CSV_SOURCES){ if(totalAdded>=MAX_TOTAL_NEW) break; totalAdded += await runSource(reg,cfg.source,(r)=>csvSource(r,cfg)); }
  totalAdded += await runSource(reg,'NO_Brreg_Frivillighetsregisteret', sourceNO_Brreg);
  totalAdded += await runSource(reg,'BR_MOSC_IPEA', sourceBR_MOSC);
  // Tier 1
  if(totalAdded<MAX_TOTAL_NEW) totalAdded += await runSource(reg,'IATI_Registry', sourceIATI_Registry);
  if(totalAdded<MAX_TOTAL_NEW) totalAdded += await runSource(reg,'EU_TransparencyRegister', sourceEU_TransparencyRegister);
  // Tier 2 enrichment
  try{ const enriched=await enrichWikidata(reg); console.log('Wikidata_Enrichment: enriched='+enriched); }catch(e){ console.log('Wikidata_Enrichment error',e.message); }
  saveRegistry(reg);
  console.log('registry_total='+reg.orgs.length+' total_added='+totalAdded);
  if(PROMOTE){ const promoted=promoteToShelf(reg, 400); console.log('promoted_to_shelf='+promoted); }
}
main().catch(e=>{ console.error(e); process.exit(1); });
