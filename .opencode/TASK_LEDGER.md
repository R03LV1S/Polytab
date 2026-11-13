# TASK LEDGER — Polytab: consolidated escrow for unclaimed bounties

**Decision (user, Nov 13 2026):** Option 3 — all unclaimed charity/bounty/market/radar wallets render to one Polytab-managed escrow on Base (`0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08`). Orgs request funds via verification; sweeps happen either:
- **(a) Claimed:** on-chain transfer to the payout wallet the verified org provides (GitHub claim issue → admin verification → sweep).
- **(b) Never claimed:** conversion to USD and donation to the org's verified external fund (website donation page / GoFundMe), with receipts/screenshots posted to GitHub (`org-sweep` labeled issues).
User takes custody/liability knowingly; site copy/Terms must reflect custody honestly.

Work batches:

- [x] Audit all addresses in repo (3,265 total: 3,250 `0x71C`, 4 `0x71D`, 11 `0x71E`); none org-held; no keys/multisig exist.
- [x] **B1 Code/data swap:** `id-pipeline.js` export `ESCROW_WALLET`; `walletFor()` returns it; same swap in `discover-events.js`, `ingest-global-verified-orgs.js`, `build-global-charities.js`, `expand-global-charities*.js`, `discover-orgs.js`; data files (`feed.json`, `global-charities.json`, `markets.json`, `event-queue.json`); frontend constants; built-in shelf sample wallets; tests updated.
- [x] **B2 Frontend:** index.html copy (cold-storage/escrow claim, false "Python RPC verifier" claim), render labels, "awaiting org verification" badge, "Claim this bounty page (org)" links (cards/modal/project.html); project.html same.
- [x] **B3 Claim flow:** `.github/ISSUE_TEMPLATE/org-claim.yml`, `.github/ISSUE_TEMPLATE/sweep-receipt.md` (markdown), `docs/claim.html` (public how-to), cross-links.
- [x] **B4 Legal/copy:** terms.html custody sections rewrite, privacy.html (blockchain publicness + sweeps), faq.html custody rewrite + org-claim how-to, index.html footer disclaimer, README misleading lines, docs/feeds descriptions if they assert non-custody.
- [ ] **B5 Verify/deploy:** 47 tests green (edit wallet assertions), regenerate feeds, commit batches, push, confirm live, adversarial gate (raises if available).

Risk flags for user:
- Custodial donations for named real orgs → charitable solicitation / money-transmission exposure; consult counsel; receipts + policy help.
- Fixes false engineering claims on the live page ("Python RPC verifier", "serialized GitHub Action") — replaced with honest "verification is manual today" language.


## Execution result (commits 67e92a4, a9f917d, pushed to main)
- All 3,269 bloc addresses in feed.json retargeted to the shared escrow; data files + generators + workers use the escrow; tests updated (46/46 passing).
- docs/claim.html (public claim how-to), org-claim.yml + sweep-receipt.md templates; \"Org? Claim this page\" CTAs on shelf cards, project page, and action dialog; awaiting-org-verification badge.
- Legal/FAQ/README/footer copy rewritten to custody truth; Pages rebuild pending at push time.
- Adversarial-reviewer gate: FAILED repeatedly on provider free-usage limit - verification done inline (HTML parse, JS compile, address counts, tests). Re-run when quota resets.
