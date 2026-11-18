#!/usr/bin/env node
/**
 * scripts/generate-local-vote-template.js
 * Generator for State, County, and City Election/Candidate Accountability Referendums.
 *
 * Enforces Honest-Zero Invariants (INV-DATA-01 through INV-DATA-04):
 *  - 15-field frozen block structure
 *  - fundedUSD = 0, votesCount = 0
 *  - lat: null, lng: null
 *  - 100% Futarchy Escrow wallet (0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08)
 *  - Localized 501(c)(3) charities matched to the state, county, and city
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SEED_FILE = path.join(ROOT_DIR, "docs", "data", "beta", "local-races-seed.json");
const FEED_FILE = path.join(ROOT_DIR, "docs", "feed.json");
const ORGS_DIR = path.join(ROOT_DIR, "docs", "data", "orgs", "US");

const ESCROW_WALLET = "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08";

function fmtUSD(n) {
  if (n == null || isNaN(n)) return "$0";
  return "$" + Number(n).toLocaleString("en-US");
}

function getLocalCharities(stateCode, city, limit = 5) {
  const stateFile = path.join(ORGS_DIR, `${stateCode.toUpperCase()}.json`);
  if (!fs.existsSync(stateFile)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw.organizations || []);
    let matches = [];
    if (city) {
      const cNorm = city.trim().toLowerCase();
      matches = list.filter(o => o.city && o.city.trim().toLowerCase() === cNorm);
    }
    if (matches.length < limit) {
      // Fallback to top revenue orgs in state
      const existingEin = new Set(matches.map(m => m.ein || m.registry_id));
      for (const o of list) {
        if (!existingEin.has(o.ein || o.registry_id)) {
          matches.push(o);
          if (matches.length >= limit) break;
        }
      }
    }
    return matches.slice(0, limit);
  } catch (e) {
    return [];
  }
}

function buildLocalVoteCampaign(race, assignedId) {
  const subj = race.subject;
  const fin = subj.finance || {};
  const stateAbbrev = (race.state || "US-XX").replace(/^US-/, "");
  
  let jurisdictionTag = "";
  let locString = "";
  if (race.jurisdiction_level === "city" && race.city) {
    jurisdictionTag = `${stateAbbrev}-${race.city} - ${race.office_title || "Mayor"}`;
    locString = `${race.city}, ${stateAbbrev}, USA`;
  } else if (race.jurisdiction_level === "county" && race.county) {
    jurisdictionTag = `${stateAbbrev}-${race.county} County - ${race.office_title || "County Executive"}`;
    locString = `${race.county} County, ${stateAbbrev}, USA`;
  } else {
    jurisdictionTag = `${stateAbbrev} - ${race.office_title || "Governor"}`;
    locString = `${stateAbbrev}, USA`;
  }

  const careerStr = fmtUSD(fin.total_contributions_usd);
  let cycleDetails = "";
  if (fin.cycle_contributions_usd && fin.outside_pac_usd) {
    cycleDetails = ` (with ${fmtUSD(fin.cycle_contributions_usd)} this cycle, alongside ${fmtUSD(fin.outside_pac_usd)} in outside PAC support led by ${fin.top_pac || "Independent PACs"})`;
  } else if (fin.cycle_contributions_usd) {
    cycleDetails = ` (with ${fmtUSD(fin.cycle_contributions_usd)} this cycle)`;
  } else if (fin.outside_pac_usd) {
    cycleDetails = ` (alongside ${fmtUSD(fin.outside_pac_usd)} in outside PAC support led by ${fin.top_pac || "Independent PACs"})`;
  }
  const sectorStr = fin.donor_capture_sector ? `—linked to "${fin.donor_capture_sector}"` : "";

  const premise = subj.rebuke_premise || "prioritizing private donor interests & failing to represent constituents by upholding core civic duties";

  const title = `[${jurisdictionTag}]: ${subj.name} (${subj.party || "Ind"}) has received ${careerStr} in campaign contributions${cycleDetails}${sectorStr ? " " + sectorStr : ""}. Do you vote to formally rebuke ${subj.name} for ${premise}?`;

  const localOrgs = getLocalCharities(stateAbbrev, race.city, 5);
  const orgRecipientsStr = localOrgs.length > 0
    ? localOrgs.map(o => `${o.name} (${o.registry_id || "US-EIN:" + o.ein})`).join("; ")
    : `Verified local 501(c)(3) charities in ${race.city || race.county || stateAbbrev}`;

  const summary = `Community Fund for ${jurisdictionTag}: Delivers 100% of funds to verified, IRS-registered 501(c)(3) public charities serving ${locString} dedicated to local clean water remediation, community clinics, youth literacy, and neighborhood resilience. Verified local recipients: ${orgRecipientsStr}. Once the pool hits $10,000, a 60-day timer starts. If YES wins, funds go to these verified local charities; if NO wins, funds go to local community commons (volunteer fire/EMS, veterans, community food banks).`;

  const plainSummary = `Resolution: Official censure & conflict-of-interest sanction for ${subj.name} (${jurisdictionTag}).\nTimer: Starts a 60-day countdown once $10,000 is reached in community votes.\nOutcome: If YES wins, 100% goes to verified local charities; if NO wins, 100% goes to essential community services (fire/EMS/veterans/food banks).`;

  const bountySlugParts = [race.election_year, race.office_type, stateAbbrev.toLowerCase()];
  if (race.county) bountySlugParts.push(race.county.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  if (race.city) bountySlugParts.push(race.city.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  bountySlugParts.push(race.race_type || "regular");
  const bountyId = bountySlugParts.join("-");

  return {
    id: String(assignedId),
    title,
    content_html: `<p>${summary}</p>`,
    url: `https://polytab.store/project.html?id=${assignedId}`,
    date_published: new Date().toISOString(),
    _polytab: {
      bounty_id: bountyId,
      category: "Public Office & Elections",
      organization: `${subj.name} (${subj.party || "Ind"}-${stateAbbrev}) Accountability Pool`,
      location: locString,
      summary,
      plainSummary,
      votePriceUSD: 0.5,
      targetUSD: null,
      activation_threshold_usd: 10000,
      settlement_epoch_days: 60,
      fundedUSD: 0,
      votesCount: 0,
      contract: ESCROW_WALLET,
      status: "Active",
      campaignType: "open_ended",
      lat: null,
      lng: null,
      website: fin.source ? `https://polytab.store/project.html?id=${assignedId}` : null,
      socials: {},
      parentCategory: "Voting"
    }
  };
}

function main() {
  if (!fs.existsSync(SEED_FILE)) {
    console.error("Local races seed file not found:", SEED_FILE);
    process.exit(1);
  }

  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const feed = JSON.parse(fs.readFileSync(FEED_FILE, "utf8"));

  const existingBounties = new Set(feed.items.map(it => it._polytab?.bounty_id || it.title));
  const existingIds = new Set(feed.items.map(it => Number(it.id)).filter(n => !isNaN(n)));

  // State, County & City Voting IDs start at 93001
  let nextId = 93001;
  function getNextLocalId() {
    while (existingIds.has(nextId)) {
      nextId++;
    }
    existingIds.add(nextId);
    return nextId;
  }

  let added = 0;
  for (const race of seed.races || []) {
    if (!race.subject || !race.subject.active_campaign) continue;
    
    const assignedId = getNextLocalId();
    const item = buildLocalVoteCampaign(race, assignedId);

    // Check if already in feed
    const existingIndex = feed.items.findIndex(it => it._polytab?.bounty_id === item._polytab.bounty_id);
    if (existingIndex >= 0) {
      console.log(`[Update] ${item._polytab.bounty_id} (ID ${feed.items[existingIndex].id})`);
      item.id = feed.items[existingIndex].id;
      item.url = `https://polytab.store/project.html?id=${item.id}`;
      feed.items[existingIndex] = item;
    } else {
      console.log(`[Add] ${item._polytab.bounty_id} -> ID ${item.id}`);
      feed.items.push(item);
      added++;
    }
  }

  feed.updated_at = new Date().toISOString();
  fs.writeFileSync(FEED_FILE, JSON.stringify(feed, null, 2), "utf8");
  console.log(`[Complete] Processed state/county/city races. Added ${added} new campaigns. Total feed items: ${feed.items.length}`);
}

main();
