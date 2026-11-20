#!/usr/bin/env node
/**
 * apply-vote-positions.js
 * Idempotently materializes voteMode/positions/positionAccounting/selectionPolicy
 * for all 77 voting/referendum campaigns in docs/feed.json (additive patch-merge).
 * Direct campaigns are left unchanged (default direct_funding derived by UI/build).
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const feedPath = path.join(repoRoot, 'docs', 'feed.json');

function isVotingItem(item) {
  const p = (item && item._polytab) || {};
  const idNum = Number(item && item.id);
  return String(p.parentCategory || '') === 'Voting'
    || String(p.category || '') === 'Public Office & Elections'
    || String(p.category || '') === 'Policy & Governance Votes'
    || (Number.isFinite(idNum) && idNum >= 90000 && idNum < 100000);
}

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function baseAccounting() {
  return {
    version: 1,
    positions: {
      A: { fundedUSD: 0, votesCount: 0 },
      B: { fundedUSD: 0, votesCount: 0 }
    },
    total: { fundedUSD: 0, votesCount: 0 }
  };
}

function selectionPolicy() {
  return { requiresSelection: true, multiSelect: false };
}

const POE_OVERRIDES = {
  '92036': {
    a: { label: 'Mandate: Deliver real wins for Alaska families', shortLabel: 'Deliver mandate', description: 'Back Senator-elect Mary Peltola to deliver tangible gains for Alaska families and resist donor-captured Washington politics, as framed by this resolution.', intent: 'mandate_deliver' },
    b: { label: 'Reject mandate: Tolerate donor-captured politics', shortLabel: 'Reject mandate', description: 'Oppose this mandate and accept the risk of Washington donor politics overriding real wins for Alaska families.', intent: 'reject_mandate' }
  },
  '92037': {
    a: { label: 'Mandate: Put working families before power brokers', shortLabel: 'Families-first mandate', description: 'Back Senator-elect Scott Colom to force Mississippi power brokers to prioritize working families, as framed by this resolution.', intent: 'mandate_families' },
    b: { label: 'Reject mandate: Preserve broker-first status quo', shortLabel: 'Reject mandate', description: 'Oppose this mandate and accept continued prioritization of entrenched power brokers over working families.', intent: 'reject_mandate' }
  },
  '92038': {
    a: { label: 'Mandate: Use 56-44 majority for affordability relief', shortLabel: 'Deliver affordability', description: 'Back the Democratic 56-44 Senate majority to deliver real affordability relief and concrete results, not business-as-usual.', intent: 'mandate_results' },
    b: { label: 'Reject mandate: Accept business-as-usual gridlock', shortLabel: 'Business-as-usual', description: 'Oppose this mandate and accept business-as-usual instead of urgent affordability relief.', intent: 'reject_mandate' }
  },
  '92039': {
    a: { label: 'Firewall: Block extreme/unfit Trump nominees', shortLabel: 'Block extreme nominees', description: 'Back rigorous scrutiny and rejection of extreme or unfit executive/judicial nominees using the Senate confirmation firewall.', intent: 'block_nominees' },
    b: { label: 'Rubber-stamp: Let the confirmation firewall crack', shortLabel: 'Let firewall crack', description: 'Oppose this firewall stance and allow confirmation of extreme nominees without firm resistance.', intent: 'allow_nominees' }
  },
  '92040': {
    a: { label: 'Oversight: Use subpoenas to expose corruption & waste', shortLabel: 'Aggressive oversight', description: 'Back aggressive Senate oversight and subpoena use to expose corruption, abuse, and waste.', intent: 'aggressive_oversight' },
    b: { label: 'Dormancy: Let subpoena power gather dust', shortLabel: 'No real oversight', description: 'Oppose aggressive oversight and accept weak scrutiny that lets corruption and waste persist.', intent: 'weak_oversight' }
  },
  '92041': {
    a: { label: 'Mandate: Turn House control into results Americans feel', shortLabel: 'Results-driven House', description: 'Back Speaker-in-waiting Hakeem Jeffries and the House majority to convert oversight into tangible results for Americans.', intent: 'mandate_results' },
    b: { label: 'Reject mandate: Oversight without real-world results', shortLabel: 'Oversight theater', description: 'Oppose this mandate and accept oversight that fails to deliver results people can feel.', intent: 'reject_mandate' }
  },
  '92042': {
    a: { label: 'Fight: Defend people’s priorities in veto standoff', shortLabel: 'Fight for priorities', description: 'Back Congress to fight for the people’s priorities and refuse to fold in the presidential veto standoff.', intent: 'fight_standoff' },
    b: { label: 'Fold: Yield to veto pressure', shortLabel: 'Fold in standoff', description: 'Oppose this stance and accept folding to presidential veto pressure over people’s priorities.', intent: 'fold_standoff' }
  },
  '92043': {
    a: { label: 'Integrity: Close “decoy candidate” voter-confusion loopholes', shortLabel: 'Close loopholes', description: 'Back closing candidate-name/voter-confusion loopholes to protect ballot clarity and election integrity in Alaska.', intent: 'close_loopholes' },
    b: { label: 'Inaction: Leave voter-confusion loopholes open', shortLabel: 'Leave loopholes', description: 'Oppose reform and accept continued voter-confusion loopholes that threaten ballot clarity.', intent: 'leave_loopholes' }
  },
  '92044': {
    a: { label: 'Mandate: Deliver fast relief on prices & energy costs', shortLabel: 'Lower costs fast', description: 'Back urgent congressional action to lower cost-of-living and energy burdens with practical, fast relief.', intent: 'mandate_relief' },
    b: { label: 'Inaction: Let cost-of-living anger go unanswered', shortLabel: 'No real relief', description: 'Oppose urgent action and accept continued high prices and energy costs without meaningful relief.', intent: 'no_relief' }
  }
};

function pgvPositions(item) {
  const p = item._polytab || {};
  const leg = p.legislation || {};
  const measure = String(leg.display_id || '').trim();
  const legTitle = String(leg.title || '').trim();
  const fallbackTitle = String(item.title || '').replace(/^[^:]+:\s*/, '').trim();
  const subject = measure ? (legTitle ? `${measure}: ${legTitle}` : measure) : (legTitle || fallbackTitle || `Campaign #${item.id}`);
  const shortA = measure ? `Pass ${measure}` : 'Ratify / Pass';
  const shortB = measure ? `Reject ${measure}` : 'Reject / Defeat';
  return {
    a: {
      label: `Ratify / Pass — ${clip(subject, 90)}`,
      shortLabel: clip(shortA, 32),
      description: `Back adoption/passage of ${subject}. Stake attributed to this pro-passage position under Polytab’s futarchy escrow policy (honest-zero until verified on-chain votes).`,
      intent: 'ratify_pass'
    },
    b: {
      label: `Reject / Defeat — ${clip(subject, 90)}`,
      shortLabel: clip(shortB, 32),
      description: `Oppose adoption/passage of ${subject}. Stake attributed to this anti-passage position under Polytab’s futarchy escrow policy (honest-zero until verified on-chain votes).`,
      intent: 'reject_defeat'
    }
  };
}

function poePositions(item) {
  const id = String(item.id);
  if (POE_OVERRIDES[id]) return POE_OVERRIDES[id];
  const title = String(item.title || '');
  const subject = clip(title, 140);
  // Censure/rebuke accountability pools
  if (/do you vote to formally rebuke/i.test(title) || /formal(?:ly)?\s+rebuke|censure/i.test(title)) {
    return {
      a: {
        label: 'Censure / Rebuke (Yes — hold accountable)',
        shortLabel: 'Censure / Rebuke',
        description: `Back formal rebuke/censure and accountability as stated: ${subject}`,
        intent: 'censure_rebuke'
      },
      b: {
        label: 'Exonerate / Reject censure (No)',
        shortLabel: 'Reject censure',
        description: `Oppose this rebuke/censure and reject the proposed sanction as stated: ${subject}`,
        intent: 'exonerate_reject_censure'
      }
    };
  }
  // Generic POE fallback (conservative, title-grounded)
  return {
    a: {
      label: 'Support stated resolution/proposal',
      shortLabel: 'Support proposal',
      description: `Back the stated resolution/proposal: ${subject}`,
      intent: 'support_resolution'
    },
    b: {
      label: 'Oppose stated resolution/proposal',
      shortLabel: 'Oppose proposal',
      description: `Oppose the stated resolution/proposal: ${subject}`,
      intent: 'oppose_resolution'
    }
  };
}

function positionsFor(item) {
  const p = item._polytab || {};
  const cat = String(p.category || '');
  const pair = (cat === 'Policy & Governance Votes') ? pgvPositions(item) : poePositions(item);
  const escrowOrg = String(p.organization || (cat === 'Policy & Governance Votes' ? 'Polytab Community — Policy & Governance Votes' : 'Polytab Community — Public Office & Elections'));
  function mk(key, side) {
    return {
      key,
      label: clip(side.label, 140),
      shortLabel: clip(side.shortLabel, 40),
      description: clip(side.description, 320),
      intent: side.intent,
      beneficiary: { type: 'campaign_escrow', organization: escrowOrg, wallet: null },
      settlement: { mode: 'unified_escrow', walletSource: 'escrow' }
    };
  }
  return [mk('A', pair.a), mk('B', pair.b)];
}

function main() {
  const raw = fs.readFileSync(feedPath, 'utf8');
  const feed = JSON.parse(raw);
  const items = Array.isArray(feed.items) ? feed.items : [];
  let touched = 0;
  for (const item of items) {
    if (!isVotingItem(item)) continue;
    const p = item._polytab || (item._polytab = {});
    p.voteMode = 'binary_referendum';
    p.positions = positionsFor(item);
    p.positionAccounting = baseAccounting();
    p.selectionPolicy = selectionPolicy();
    touched++;
  }
  feed.items = items;
  fs.writeFileSync(feedPath, JSON.stringify(feed, null, 2) + '\n', 'utf8');
  console.log(`Applied binary_referendum positions to ${touched} voting items.`);
}

main();
