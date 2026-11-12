// Polytab ID identification pipeline (scaffolded, bloc format)
// Bloc format (shelf/active bounties): numeric compartmentalized string IDs + deterministic escrow/wallet
//   id:      "<number>" (category-compartmentalized block)
//   url:     "https://polytab.store/#<id>"
//   wallet:  "0x71C" + "0".repeat(40 - 3 - id.length) + id  (40-hex, prefix 0x71C)
// Parent ranges reserve ID space; leaf subcategories own blocks within the parent range.
// Invariants: never reuse/renumber existing IDs; fundedUSD/votesCount honest-zero until real on-chain votes.

const PARENT_CHARITIES = "Charities";
const PARENT_SPECULATIVE = "Speculative"; // normal "Voting" topics/categories (outcome/forecast-style community bounties)

// Leaf subcategory -> block base (start). Each block reserves base+1 .. base+9999 in this scheme.
const CHARITY_BLOCKS = {
  "Accessibility & Universal Design": 10000,
  "Environmental": 20000,
  "Civic Tech": 30000,
  "Classrooms": 40000,
  "Arts & Clubs": 45000,
  "Campus Grounds": 60000,
  "Athletics": 70000
};

const SPECULATIVE_BLOCKS = {
  "Policy & Local Outcomes": 81000,
  "Elections & Civic Accountability": 82000,
  "Public Safety & Infrastructure": 83000,
  "Global & Humanitarian Outcomes": 84000
};

// Parent range summary (for docs/UI/pipeline). Charities occupy 10000-79999 (with reserved gaps for future sub-blocks);
// Speculative/Voting occupy 80000+ (81000+ allocated in blocks, 80000-80999 and 85000+ reserved for future voting blocs).
const PARENT_RANGES = {
  [PARENT_CHARITIES]: { min: 10000, max: 79999, note: "Encompasses existing charity subcategory blocks; gaps reserved for future charity blocs." },
  [PARENT_SPECULATIVE]: { min: 80000, max: 99999, note: "Normal Voting topics/categories (Speculative). Subcategory blocks allocated; remaining ranges reserved for future voting blocs." }
};

const BLOCKS = Object.assign({}, CHARITY_BLOCKS, SPECULATIVE_BLOCKS);
const LEAF_TO_PARENT = {};
for (const k of Object.keys(CHARITY_BLOCKS)) LEAF_TO_PARENT[k] = PARENT_CHARITIES;
for (const k of Object.keys(SPECULATIVE_BLOCKS)) LEAF_TO_PARENT[k] = PARENT_SPECULATIVE;

const CHARITY_CATEGORIES = Object.keys(CHARITY_BLOCKS);
const SPECULATIVE_CATEGORIES = Object.keys(SPECULATIVE_BLOCKS);
const VALID_CATEGORIES = new Set(Object.keys(BLOCKS));

function walletFor(id) {
  const s = String(id);
  const body = "0".repeat(Math.max(0, 40 - 3 - s.length)) + s;
  return "0x71C" + body;
}

function parentForCategory(category) {
  if (LEAF_TO_PARENT[category]) return LEAF_TO_PARENT[category];
  // fallback by numeric range when category unknown
  return null;
}

function blockForCategory(category) {
  return BLOCKS.hasOwnProperty(category) ? BLOCKS[category] : null;
}

function categoryForId(id) {
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return null;
  for (const [cat, base] of Object.entries(BLOCKS)) {
    if (n > base && n < base + 10000) return cat;
  }
  return null;
}

function parentForId(id) {
  const cat = categoryForId(id);
  if (cat) return parentForCategory(cat);
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 10000 && n <= 79999) return PARENT_CHARITIES;
  if (n >= 80000) return PARENT_SPECULATIVE;
  return null;
}

function nextIdInBlock(category, usedNumericIds) {
  const base = blockForCategory(category);
  if (base == null) throw new Error("Unknown category block: " + category);
  let maxOffset = 0;
  const set = usedNumericIds instanceof Set ? usedNumericIds : new Set(usedNumericIds || []);
  for (const n of set) {
    if (Number.isFinite(n) && n > base && n < base + 10000) {
      const off = n - base;
      if (off > maxOffset) maxOffset = off;
    }
  }
  // also accept array of id strings
  if (Array.isArray(usedNumericIds)) {
    for (const v of usedNumericIds) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > base && n < base + 10000) {
        const off = n - base;
        if (off > maxOffset) maxOffset = off;
      }
    }
  }
  const next = base + maxOffset + 1;
  if (next >= base + 10000) throw new Error("Block exhausted for category: " + category);
  return String(next);
}

function collectNumericIds(items) {
  const out = [];
  for (const it of (items || [])) {
    const n = parseInt(it && it.id, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function idCompartmentalizationMeta() {
  return {
    version: 2,
    note: "Scaffolded ID identification pipeline (bloc format). Numeric IDs are compartmentalized by parent range and leaf subcategory block for structure and wallet/URL compatibility. wallet = 0x71C + zero-padded id. Never renumber existing IDs.",
    bloc_format: {
      id: "<numeric string>",
      url: "https://polytab.store/#<id>",
      wallet: "0x71C + zeroPad40hex(idNumeric)"
    },
    parents: {
      [PARENT_CHARITIES]: {
        range: "10000-79999",
        description: "Verified/audited/trustworthy charity bounties (evidence-backed, honest-zero).",
        blocks: Object.assign({}, CHARITY_BLOCKS)
      },
      [PARENT_SPECULATIVE]: {
        range: "80000-99999",
        description: "Normal Voting topics/categories (Speculative). Community outcome proposals; funds directed to designated verified recipient/foundation per verified resolution conditions. Honest-zero until real on-chain votes.",
        blocks: Object.assign({}, SPECULATIVE_BLOCKS),
        reserved: ["80000-80999 (future voting blocs)", "85000-99999 (future voting blocs/subcategories)"]
      }
    },
    blocks: Object.assign({}, BLOCKS)
  };
}

module.exports = {
  PARENT_CHARITIES,
  PARENT_SPECULATIVE,
  CHARITY_BLOCKS,
  SPECULATIVE_BLOCKS,
  BLOCKS,
  PARENT_RANGES,
  LEAF_TO_PARENT,
  CHARITY_CATEGORIES,
  SPECULATIVE_CATEGORIES,
  VALID_CATEGORIES,
  walletFor,
  parentForCategory,
  blockForCategory,
  categoryForId,
  parentForId,
  nextIdInBlock,
  collectNumericIds,
  idCompartmentalizationMeta
};
