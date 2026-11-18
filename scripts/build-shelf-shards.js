/**
 * scripts/build-shelf-shards.js
 * Builds lightweight initial index and category shards for Polytab on-demand progressive loading.
 * Zero-cost, static files on GitHub Pages / Cloudflare Edge.
 * 
 * Output:
 *   docs/data/shelves/initial.json    (~100KB: Voting referendums + priority bounties + category counts)
 *   docs/data/shelves/<category-slug>.json  (on-demand category slice)
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const feedPath = path.join(repoRoot, 'docs/feed.json');
const shelvesDir = path.join(repoRoot, 'docs/data/shelves');

if (!fs.existsSync(shelvesDir)) {
  fs.mkdirSync(shelvesDir, { recursive: true });
}

const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
const items = Array.isArray(feed.items) ? feed.items : [];

// Slugify category for shard file name
function slugifyCategory(cat) {
  return String(cat || 'general')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Category mappings
const categories = new Map();
const parentCategories = new Map();

for (const item of items) {
  const meta = item._polytab || {};
  const cat = meta.category || 'Civic Tech';
  const pcat = meta.parentCategory || 'Charities';

  if (!categories.has(cat)) categories.set(cat, []);
  categories.get(cat).push(item);

  if (!parentCategories.has(pcat)) parentCategories.set(pcat, []);
  parentCategories.get(pcat).push(item);
}

// 1. Build category shards
const shardsManifest = {};

for (const [cat, catItems] of categories.entries()) {
  const slug = slugifyCategory(cat);
  const shardPath = path.join(shelvesDir, `${slug}.json`);
  fs.writeFileSync(shardPath, JSON.stringify({
    category: cat,
    slug,
    count: catItems.length,
    items: catItems
  }) + '\n', 'utf8');
  shardsManifest[cat] = {
    slug,
    count: catItems.length,
    file: `data/shelves/${slug}.json`
  };
}

// 2. Build initial lightweight bundle:
// All Voting referendums (35) + Speculative (2) + first 24 items of each charity category
const initialItems = [];
const seenIds = new Set();

// Add all Voting and Speculative first
for (const pcat of ['Voting', 'Speculative']) {
  const pItems = parentCategories.get(pcat) || [];
  for (const it of pItems) {
    if (!seenIds.has(it.id)) {
      seenIds.add(it.id);
      initialItems.push(it);
    }
  }
}

// Add top 12 of each charity category
for (const [cat, catItems] of categories.entries()) {
  const topSlice = catItems.slice(0, 12);
  for (const it of topSlice) {
    if (!seenIds.has(it.id)) {
      seenIds.add(it.id);
      initialItems.push(it);
    }
  }
}

const initialPayload = {
  version: 'polytab-shelf-v2',
  generated_at: new Date().toISOString(),
  total_items: items.length,
  shards: shardsManifest,
  initial_count: initialItems.length,
  items: initialItems
};

const initialPath = path.join(shelvesDir, 'initial.json');
fs.writeFileSync(initialPath, JSON.stringify(initialPayload) + '\n', 'utf8');

const initialStat = fs.statSync(initialPath);
console.log(`[Shelf Shards] Wrote ${Object.keys(shardsManifest).length} category shards to ${shelvesDir}`);
console.log(`[Shelf Shards] initial.json created with ${initialItems.length} items (${Math.round(initialStat.size / 1024)} KB)`);
