// Polytab ID identification pipeline (bloc format)
// Bloc IDs are used for compartmentalization/routing only. Every auto-listed bounty ships
// DONATION-LOCKED with a placeholder wallet (chain ID 8453). Fundraising is disabled for
// unverified organizations. Verified organizations file an org-claim (registry + domain control)
// and get their own payout wallet, which unlocks the donation button for their page.
// Donations settle directly on-chain into the organization's wallet — Polytab never holds,
// pools, sweeps, or designates funds.
//   id:      "<number>" (category-compartmentalized block)
//   url:     "https://polytab.store/#<id>"
// Invariants: never reuse/renumber existing IDs; fundedUSD/votesCount honest-zero until real on-chain votes exist.

const ESCROW_WALLET = "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08";
const PARENT_CHARITIES = "Charities";
const PARENT_SPECULATIVE = "Speculative";
const PARENT_VOTING = "Voting";

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

const VOTING_BLOCKS = {
  "Community Referendums": 91000,
  "Public Office & Elections": 92000,
  "Policy & Governance Votes": 93000,
  "Global Outcome Votes": 94000
};

// Parent range summary (for docs/UI/pipeline). Charities occupy 10000-79999 (with reserved gaps for future sub-blocks);
// Speculative occupy 80000-89999 (allocated blocs + reserved); Voting occupy 90000-99999.
const PARENT_RANGES = {
  [PARENT_CHARITIES]: { min: 10000, max: 79999, note: "Encompasses existing charity subcategory blocks; gaps reserved for future charity blocs." },
  [PARENT_SPECULATIVE]: { min: 80000, max: 89999, note: "Speculative outcome/community proposal bounties. Subcategory blocks allocated; remaining ranges reserved for future speculative blocs." },
  [PARENT_VOTING]: { min: 90000, max: 99999, note: "Voting topics/categories. Subcategory blocks allocated; remaining ranges reserved for future voting blocs." }
};

const BLOCKS = Object.assign({}, CHARITY_BLOCKS, SPECULATIVE_BLOCKS, VOTING_BLOCKS);
const LEAF_TO_PARENT = {};
for (const k of Object.keys(CHARITY_BLOCKS)) LEAF_TO_PARENT[k] = PARENT_CHARITIES;
for (const k of Object.keys(SPECULATIVE_BLOCKS)) LEAF_TO_PARENT[k] = PARENT_SPECULATIVE;
for (const k of Object.keys(VOTING_BLOCKS)) LEAF_TO_PARENT[k] = PARENT_VOTING;

const CHARITY_CATEGORIES = Object.keys(CHARITY_BLOCKS);
const SPECULATIVE_CATEGORIES = Object.keys(SPECULATIVE_BLOCKS);
const VOTING_CATEGORIES = Object.keys(VOTING_BLOCKS);
const VALID_CATEGORIES = new Set(Object.keys(BLOCKS));

function walletFor(_id) {
  // Every auto-listed page ships donation-locked with this placeholder wallet.
  // A verified organization replaces it with its own payout wallet (claim flow) which unlocks its page.
  return ESCROW_WALLET;
}

function parentForCategory(category) {
  if (LEAF_TO_PARENT[category]) return LEAF_TO_PARENT[category];
  return null;
}

function blockForCategory(category) {
  return Object.prototype.hasOwnProperty.call(BLOCKS, category) ? BLOCKS[category] : null;
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
  if (n >= 80000 && n <= 89999) return PARENT_SPECULATIVE;
  if (n >= 90000 && n <= 99999) return PARENT_VOTING;
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
    version: 5,
    note: "Scaffolded ID identification pipeline (bloc format). Numeric IDs compartmentalize by parent range and leaf subcategory block for structure and routing only. Every auto-listed page ships donation-locked with a placeholder wallet (0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08); verified organizations replace it with their own payout wallet and unlock their page. Never renumber existing IDs.",
    bloc_format: {
      id: "<numeric string>",
      url: "https://polytab.store/#<id>",
      placeholder: ESCROW_WALLET
    },
    parents: {
      [PARENT_CHARITIES]: {
        range: "10000-79999",
        description: "Verified/audited/trustworthy charity bounties (evidence-backed, honest-zero).",
        blocks: Object.assign({}, CHARITY_BLOCKS)
      },
      [PARENT_SPECULATIVE]: {
        range: "80000-89999",
        description: "Speculative outcome/community proposal bounties. Funds directed to designated verified recipient/foundation per verified resolution conditions. Honest-zero until real on-chain votes/stakes.",
        blocks: Object.assign({}, SPECULATIVE_BLOCKS),
        reserved: ["80000-80999 (future speculative blocs)", "85000-89999 (future speculative blocs/subcategories)"]
      },
      [PARENT_VOTING]: {
        range: "90000-99999",
        description: "Voting topics/categories. Community votes on outcomes/questions; honest-zero until real on-chain votes.",
        blocks: Object.assign({}, VOTING_BLOCKS),
        reserved: ["90000-90999 (future voting blocs)", "95000-99999 (future voting blocs/subcategories)"]
      }
    },
    blocks: Object.assign({}, BLOCKS)
  };
}

module.exports = {
  ESCROW_WALLET,
  PARENT_CHARITIES,
  PARENT_SPECULATIVE,
  PARENT_VOTING,
  CHARITY_BLOCKS,
  SPECULATIVE_BLOCKS,
  VOTING_BLOCKS,
  BLOCKS,
  PARENT_RANGES,
  LEAF_TO_PARENT,
  CHARITY_CATEGORIES,
  SPECULATIVE_CATEGORIES,
  VOTING_CATEGORIES,
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
