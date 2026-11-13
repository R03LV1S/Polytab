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


## Addendum (commits 8a832f4..312da34)
- URGENT: earlier address (8c8cEB0d...) was a wrong transcription; replaced everywhere with valid EIP-55 0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08 (Keccak-verified, 13,261 refs, 23 files + hidden/.opencode+.github). 
- docs/escrow-qr.png (Polytab.Store branded, address caption) embedded in action modal, project page, claim page, FAQ.
- Org-claim verification hardened: registry match AND domain control (DNS TXT / org-domain email) now required; self-asserted contact info refused.
- Stewardship program for users without wallets: policy in FAQ/Terms/Privacy + out-of-band intake (GitHub issue template, no IDs in repo).
- Escrow watchdog: scripts/escrow-watchdog.js + .github/workflows/escrow-watchdog.yml (6-hour cron). Baseline: balance 0, nonce 0 @ block 57,056,874. Alerts on ANY outgoing movement; acknowledgements via escrow-sweeps.json + sweep issues (never auto-mute).
- Adversarial-reviewer gate: unavailable (provider free-usage limit) throughout; verification inline (HTML parse, JS compile, checksum verify, RPC baseline, tests 46/46).


## Addendum v2 (watchdog hardening)
- Watchdog v2: 6h -> 30-minute cron; free public-RPC cascade (1rpc.io/base -> publicnode -> mainnet.base.org), no API key required.
- Best-effort ERC20 inbound-log scan added (informational only). Balance/nonce remain the alert triggers.
- BASE_RPC_URL repo secret wiring: optional dedicated endpoint (Alchemy free tier recommended) for unlimited getLogs; workflow prefers it automatically.

## Addendum v3 (user questions - answered inline offline)
Q1 QR recreated vs provided? RECREATED (my PNG, user payload verified by decode)
Q2 Watchdog harder + GitHub/Cloudflare? DONE (see v2; Cloudflare worker optional for sub-minute)
Q3 Custody/stewardship legal? Discussed: MSB/charitable solicitation exposure; not curable by ToS; see reply
Q4 GitHub-able Alchemy key? Set BASE_RPC_URL in repo secrets; zero code change


## DECISION CHANGE (Nov 13 2026, user): claim-first, non-custodial shelf
Supersedes omnibus escrow for shelf items. Charities named on the shelf cannot receive donations until they verify (registry + DNS TXT/email). On verification, an org-wallet is written and donation/stake flows unlock direct-to-wallet. No monies transit or linger in any platform address.

- [x] B1 Overlay: docs/data/org-wallets.json (empty map; applied at render time over escrow placeholders)
- [x] B2 index.html: effectiveWalletFor(item), locked UI (cards, modal, wallet rows, buy buttons), locked blocks (#modalPayBlock vs #modalClaimBlock), markets outcome gating (merge feed+overlay), hero/copy/footer/disclaimers rewritten, remove static escrow QR switch for unclaimed, claim links preserved
- [x] B3 project.html: locked banner, disabled buy button + direct-wallet note for creator items; no QR for unclaimed
- [x] B4 claim.html + faq.html + README + terms/privacy: locked/direct-to-org language everywhere; remove escrow-sweep-as-default trade-offs; keep unclaimed-sweep policy only as backstop for stray deposits
- [ ] B5 Verify: tests, HTML parse, JS compile, live check; adversarial gate


## Addendum v4 (claim-first shipped)
- docs/data/org-wallets.json overlay (empty at launch; browser merges it over feed; pages remain locked until entries land).
- index.html: effectiveWalletFor/orgWalletForId helpers; shelf cards & markets show LOCKED until overlay exists; modal shows modalLockBlock for unclaimed (modalPayBlock hidden); markets outcome gating locks all 2 venues until beneficiary verifies.
- project.html: overlay applied; locked banner; Buy button becomes Org Claim CTA when locked (unlocked jumps to shelf page).
- Regenerate feeds (locked-appropriate item lines, no more Escrow line for placeholder wallets); tests 46/46 green.
- Comment sweep: scripts/workers/tests all read as donation-locked placeholder routing (was misleading escrow language).
