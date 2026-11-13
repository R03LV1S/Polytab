const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const os = require('os');

const OUT = path.join(__dirname, '..', 'docs', 'data', 'location-index.json');
const BASE = 'https://download.geonames.org/export/dump/';

function fetch(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'polytab-location-index/1 (github actions; free)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetch(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function fetchText(name) {
  const res = await fetch(BASE + name);
  return await new Promise((resolve, reject) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => buf += c);
    res.on('end', () => resolve(buf));
    res.on('error', reject);
  });
}

async function fetchBuffer(name) {
  const res = await fetch(BASE + name);
  const chunks = [];
  await new Promise((resolve, reject) => {
    res.on('data', (c) => chunks.push(c));
    res.on('end', resolve);
    res.on('error', reject);
  });
  return Buffer.concat(chunks);
}

function extractZipEntry(buf, innerName) {
  // Parse central directory for reliable sizes/offsets
  // EOCD: signature 0x06054b50 at end (min 22 bytes)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('EOCD not found');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  let p = cdOff;
  const end = cdOff + cdSize;
  while (p + 46 <= end) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const fname = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (fname === innerName) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad local header');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return comp.toString('utf8');
      if (method === 8) return zlib.inflateRawSync(comp).toString('utf8');
      throw new Error('Unsupported compression ' + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Entry not found: ' + innerName);
}

async function fetchZipText(name, innerName) {
  const buf = await fetchBuffer(name);
  try {
    return extractZipEntry(buf, innerName);
  } catch (e) {
    // fallback: try system unzip if available
    const tmp = path.join(os.tmpdir(), 'polytab-' + name);
    fs.writeFileSync(tmp, buf);
    try {
      try {
        const out = execFileSync('unzip', ['-p', tmp, innerName], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 });
        return out;
      } catch (_) {
        // windows powershell fallback
        const outDir = path.join(os.tmpdir(), 'polytab-zip-' + Date.now());
        fs.mkdirSync(outDir, { recursive: true });
        execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${tmp}' -DestinationPath '${outDir}' -Force`], { stdio: 'ignore' });
        return fs.readFileSync(path.join(outDir, innerName), 'utf8');
      }
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }
}

function parseCountries(txt) {
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const p = line.split('\t');
    const iso2 = (p[0] || '').trim();
    const name = (p[4] || '').trim();
    if (!iso2 || !name || iso2.length !== 2) continue;
    out.push({ code: iso2.toUpperCase(), name, kind: 'country' });
  }
  return out.sort((a,b) => a.code.localeCompare(b.code));
}

function parseAdmin1(txt, countriesByCode) {
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const p = line.split('\t');
    const code = (p[0] || '').trim();
    const name = (p[1] || '').trim();
    const ascii = (p[2] || '').trim() || name;
    if (!code || !name) continue;
    const dot = code.indexOf('.');
    if (dot < 0) continue;
    const cc = code.slice(0, dot).toUpperCase();
    const adm = code.slice(dot + 1);
    const c = countriesByCode.get(cc);
    out.push({ code: adm, name, ascii, countryCode: cc, country: c ? c.name : cc, kind: 'state' });
  }
  return out;
}

function parseCities(txt, countriesByCode, admin1ByKey) {
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line) continue;
    const p = line.split('\t');
    const name = (p[1] || '').trim();
    const ascii = (p[2] || '').trim() || name;
    const cc = (p[8] || '').trim().toUpperCase();
    const adm1 = (p[10] || '').trim();
    const pop = parseInt(p[14] || '0', 10) || 0;
    const fcl = (p[6] || '').trim();
    if (!name || !cc || fcl !== 'P') continue;
    const c = countriesByCode.get(cc);
    const a1 = admin1ByKey.get(cc + '.' + adm1);
    out.push({
      name, ascii, countryCode: cc, country: c ? c.name : cc,
      admin1: a1 ? (a1.ascii || a1.name) : '', admin1Code: adm1 || '',
      kind: 'city', pop
    });
  }
  out.sort((a,b) => (b.pop - a.pop) || a.name.localeCompare(b.name));
  return out;
}

(async () => {
  console.log('Fetching GeoNames dumps...');
  const [countryTxt, admin1Txt, citiesTxt] = await Promise.all([
    fetchText('countryInfo.txt'),
    fetchText('admin1CodesASCII.txt'),
    fetchZipText('cities15000.zip', 'cities15000.txt')
  ]);
  console.log('Parsing...');
  const countries = parseCountries(countryTxt);
  const countriesByCode = new Map(countries.map(c => [c.code, c]));
  const admin1 = parseAdmin1(admin1Txt, countriesByCode);
  const admin1ByKey = new Map(admin1.map(a => [a.countryCode + '.' + a.code, a]));
  const cities = parseCities(citiesTxt, countriesByCode, admin1ByKey);

  // Build fresh snapshot from free sources, then update existing index file accordingly (additions/changes/removals)
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) {}
  const fresh = {
    countries: countries.map(c => ({ c: c.code, n: c.name })),
    admin1: admin1.map(a => ({ c: a.code, n: a.name, a: a.ascii !== a.name ? a.ascii : undefined, cc: a.countryCode, cn: a.country })),
    cities: cities.map(c => ({ n: c.name, a: c.ascii !== c.name ? c.ascii : undefined, cc: c.countryCode, cn: c.country, s: c.admin1 || undefined, sc: c.admin1Code || undefined, p: c.pop }))
  };
  const key = (kind, x) => kind === 'countries' ? ('c:'+x.c) : kind === 'admin1' ? ('a:'+x.cc+'.'+x.c) : ('p:'+x.cc+'|'+x.sc+'|'+x.n);
  const diffKind = (kind) => {
    const oldArr = Array.isArray(existing && existing[kind]) ? existing[kind] : [];
    const newArr = fresh[kind];
    const om = new Map(oldArr.map(x => [key(kind,x), JSON.stringify(x)]));
    const nm = new Map(newArr.map(x => [key(kind,x), JSON.stringify(x)]));
    let added=0, removed=0, changed=0;
    for (const [k,v] of nm) { if (!om.has(k)) added++; else if (om.get(k) !== v) changed++; }
    for (const k of om.keys()) { if (!nm.has(k)) removed++; }
    return {added, removed, changed};
  };
  const changes = { countries: diffKind('countries'), admin1: diffKind('admin1'), cities: diffKind('cities') };
  const index = Object.assign({}, existing || {}, {
    version: 1,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: 'GeoNames (CC BY 4.0) countryInfo.txt, admin1CodesASCII.txt, cities15000.txt',
    counts: { countries: fresh.countries.length, admin1: fresh.admin1.length, cities: fresh.cities.length },
    countries: fresh.countries,
    admin1: fresh.admin1,
    cities: fresh.cities
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(index));
  const stat = fs.statSync(OUT);
  console.log('Updated', OUT, 'bytes=', stat.size, 'counts=', index.counts, 'changes=', JSON.stringify(changes));
})().catch((e) => { console.error(e); process.exit(1); });
