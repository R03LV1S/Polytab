#!/usr/bin/env node
/**
 * Enrich charity website/social links in feed.json and global-charities.json.
 * $0/free sources only: fetches official websites and public ProPublica pages.
 * Honesty: only records links found on official websites or public registry pages.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FEED_PATH = path.join(__dirname, '..', 'docs', 'feed.json');
const GLOBAL_PATH = path.join(__dirname, '..', 'docs', 'data', 'global-charities.json');
const VERIFIED_PATH = path.join(__dirname, '..', 'docs', 'data', 'verified-orgs.json');

const USER_AGENT = 'Polytab-LinkEnrichment/1.0 (+https://github.com/R03LV1S/Polytab)';
const MAX_FETCHES_PER_RUN = Number(process.env.MAX_ENRICH_FETCHES || 120);
const REQUEST_DELAY_MS = Number(process.env.ENRICH_DELAY_MS || 350);
const FETCH_TIMEOUT_MS = 12000;

let fetchCount = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function safeUrl(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch (_) { return null; }
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchText(url) {
  if (fetchCount >= MAX_FETCHES_PER_RUN) return null;
  fetchCount++;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    await sleep(REQUEST_DELAY_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.includes('text/html') && !ct.includes('xhtml')) return null;
    const text = await res.text();
    return text.slice(0, 500000); // cap
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractSocialsFromHtml(html, baseUrl) {
  const out = {};
  if (!html) return out;
  const re = /href\s*=\s*["']([^"'<>]+)["']/ig;
  let m;
  const found = [];
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    try { href = new URL(href, baseUrl).toString(); } catch (_) { continue; }
    const u = safeUrl(href);
    if (u) found.push(u);
  }
  const patterns = [
    { key: 'x', test: u => /^(https?:\/\/)(www\.)?(twitter\.com|x\.com)\//i.test(u) && !/\/(intent|share|home|i\/|search|login|signup)/i.test(u) },
    { key: 'facebook', test: u => /^(https?:\/\/)(www\.|m\.)?facebook\.com\//i.test(u) && !/\/(sharer|share\.php|plugins|dialog|login)/i.test(u) },
    { key: 'instagram', test: u => /^(https?:\/\/)(www\.)?instagram\.com\//i.test(u) && !/\/(p|reel|explore|accounts)\//i.test(u) },
    { key: 'linkedin', test: u => /^(https?:\/\/)(www\.)?linkedin\.com\/(company|school|in)\//i.test(u) },
    { key: 'youtube', test: u => /^(https?:\/\/)(www\.)?youtube\.com\/(channel|c|user|@)/i.test(u) },
    { key: 'tiktok', test: u => /^(https?:\/\/)(www\.)?tiktok\.com\/@/i.test(u) }
  ];
  for (const { key, test } of patterns) {
    if (out[key]) continue;
    const match = found.find(test);
    if (match) out[key] = match;
  }
  return out;
}

function extractWebsiteFromProPublicaHtml(html) {
  if (!html) return null;
  // ProPublica nonprofit pages may include a website link; look for common patterns
  const patterns = [
    /Website[^<]*<a[^>]+href=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+)["'][^>]*>\s*Website\s*<\/a>/i,
    /class=["'][^"']*website[^"']*["'][^>]*href=["']([^"']+)["']/i,
    /href=["']([^"']+)["'][^>]*class=["'][^"']*website[^"']*["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const u = safeUrl(m[1]);
      if (u && !/propublica\.org/i.test(u)) return u;
    }
  }
  // fallback: sometimes listed as external link in profile sections
  const re = /href=["'](https?:\/\/[^"']+)["'][^>]*>(?:\s*Visit\s+Website|Official\s+Website|Website)\s*</ig;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = safeUrl(m[1]);
    if (u && !/propublica\.org|irs\.gov|guidestar|charitynavigator/i.test(u)) return u;
  }
  return null;
}

function mergeSocials(existing, found) {
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {};
  let changed = false;
  for (const [k, v] of Object.entries(found || {})) {
    const sv = safeUrl(v);
    if (!sv) continue;
    if (!base[k]) { base[k] = sv; changed = true; }
  }
  return { socials: base, changed };
}

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return null; }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function buildVerifiedWebsiteIndex(verified) {
  const byEin = new Map();
  const byNameState = new Map();
  const orgs = Array.isArray(verified && verified.orgs) ? verified.orgs : [];
  for (const o of orgs) {
    const ein = String(o.ein || '').replace(/\D/g, '');
    if (ein) byEin.set(ein, o);
    const key = normName(o.name) + '|' + String(o.state || '').toLowerCase();
    if (normName(o.name)) byNameState.set(key, o);
  }
  return { byEin, byNameState };
}

async function enrichItem(polytab, verifiedIndex) {
  if (!polytab || typeof polytab !== 'object') return false;
  let changed = false;

  // Try to discover website from ProPublica for matched US org without website
  if (!safeUrl(polytab.website) && verifiedIndex) {
    const key = normName(polytab.organization) + '|' + String((polytab.location || '').split(',').pop() || '').trim().toLowerCase().slice(0, 2);
    // fallback: try to extract state from location like "City, ST"
    const locStateMatch = String(polytab.location || '').match(/,\s*([A-Z]{2})(?:\b|$)/);
    const key2 = locStateMatch ? (normName(polytab.organization) + '|' + locStateMatch[1].toLowerCase()) : null;
    const match = (key2 && verifiedIndex.byNameState.get(key2)) || verifiedIndex.byNameState.get(key) || null;
    const ein = match && String(match.ein || '').replace(/\D/g, '');
    if (ein) {
      const html = await fetchText('https://projects.propublica.org/nonprofits/organizations/' + ein);
      const site = extractWebsiteFromProPublicaHtml(html);
      if (site) { polytab.website = site; changed = true; }
    }
  }

  // Extract socials from website if present
  const website = safeUrl(polytab.website);
  if (website) {
    const needsSocials = !polytab.socials || typeof polytab.socials !== 'object' || Array.isArray(polytab.socials) || Object.keys(polytab.socials).length === 0;
    if (needsSocials) {
      const html = await fetchText(website);
      const found = extractSocialsFromHtml(html, website);
      if (Object.keys(found).length) {
        const merged = mergeSocials(polytab.socials, found);
        polytab.socials = merged.socials;
        if (merged.changed) changed = true;
      } else if (!polytab.socials || typeof polytab.socials !== 'object') {
        polytab.socials = {};
      }
    } else {
      // fill missing keys only
      const html = await fetchText(website);
      const found = extractSocialsFromHtml(html, website);
      const merged = mergeSocials(polytab.socials, found);
      polytab.socials = merged.socials;
      if (merged.changed) changed = true;
    }
  } else {
    if (polytab.website === undefined) polytab.website = null;
    if (!polytab.socials || typeof polytab.socials !== 'object' || Array.isArray(polytab.socials)) polytab.socials = {};
  }

  return changed;
}

async function main() {
  const feed = loadJson(FEED_PATH);
  const global = loadJson(GLOBAL_PATH);
  const verified = loadJson(VERIFIED_PATH);
  if (!feed || !Array.isArray(feed.items)) {
    console.error('Missing or invalid feed.json');
    process.exit(1);
  }
  const verifiedIndex = buildVerifiedWebsiteIndex(verified || {});
  const globalById = new Map();
  if (global && Array.isArray(global.items)) {
    for (const it of global.items) globalById.set(String(it.id), it);
  }

  let changedFeed = 0, changedGlobal = 0;

  // Prioritize items missing website or missing socials but having website
  const items = feed.items.slice();
  items.sort((a, b) => {
    const ap = a && a._polytab || {}; const bp = b && b._polytab || {};
    const as = (safeUrl(ap.website) ? 1 : 0) + ((ap.socials && Object.keys(ap.socials).length) ? 1 : 0);
    const bs = (safeUrl(bp.website) ? 1 : 0) + ((bp.socials && Object.keys(bp.socials).length) ? 1 : 0);
    return as - bs; // least enriched first
  });

  for (const item of items) {
    if (fetchCount >= MAX_FETCHES_PER_RUN) break;
    const p = item && item._polytab;
    if (!p) continue;
    const hasSite = !!safeUrl(p.website);
    const hasSocials = p.socials && typeof p.socials === 'object' && !Array.isArray(p.socials) && Object.keys(p.socials).length > 0;
    if (hasSite && hasSocials) continue;

    const beforeSite = p.website;
    const beforeSocials = JSON.stringify(p.socials || {});
    const changed = await enrichItem(p, verifiedIndex);
    if (changed || beforeSite !== p.website || beforeSocials !== JSON.stringify(p.socials || {})) {
      changedFeed++;
      const g = globalById.get(String(item.id));
      if (g && g._polytab) {
        if (safeUrl(p.website)) g._polytab.website = p.website;
        if (p.socials && typeof p.socials === 'object') g._polytab.socials = { ...(g._polytab.socials || {}), ...p.socials };
        changedGlobal++;
      }
    }
  }

  if (changedFeed > 0) {
    feed.updated_at = new Date().toISOString();
    saveJson(FEED_PATH, feed);
  }
  if (changedGlobal > 0 && global) {
    global.updated_at = new Date().toISOString();
    saveJson(GLOBAL_PATH, global);
  }

  console.log(JSON.stringify({ fetchCount, changedFeed, changedGlobal, maxFetches: MAX_FETCHES_PER_RUN }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
