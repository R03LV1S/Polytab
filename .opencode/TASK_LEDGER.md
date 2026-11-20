# TASK LEDGER — Polytab verification & repair

Goal: verify the user's approved run end-to-end and eliminate defects before sign-off.

## Findings (verified, not assumed)
- [x] `.fec_api_key` was tracked in git (`aa52d65`) → key must be rotated by the owner.
- [x] All 35 records shipped with empty `eligible_audited_beneficiaries` / `eligible_commons_beneficiaries`.
- [x] Root cause: generator read `organizations:` while `verified-orgs.json` uses `orgs:`; no `docs/data/orgs/US/` shards existed.
- [x] `bounty_if_no_wins` lacked "both sides" positive-sum phrasing.
- [x] Archetype match was first-hit (`FUND` → SUPERPAC) → 27/35 generic; now weighted scoring → 18/35.
- [x] IL had empty `top_donors_cycle`; OpenFEC `by_contributor` is broken → Schedule A aggregation fallback added.
- [x] SOP ledger contained `https://example.com/test` pollution.
- [x] Coverage dates are genuine bulk-download dates (2026-10-14).

## Completed
- [x] B1 Security: `.fec_api_key` untracked + gitignored; key rotation still required (history).
- [x] B2 `scripts/ingest-us-state-charities.js`: keyless IRS EO BMF per-state ingest, revocation gate, DAF/private-foundation/NTEE-T exclusion, 20/category diversity quota, 35 shards + manifest hashes.
- [x] B3 Generator charity loader: shard-first, legacy `orgs` fallback, normalized beneficiary shape, hard throw when a pool is empty.
- [x] B4 Split: NTEE-first disjoint YES/NO pools, archetype two-tier remedy ranking, one-per-category commons (fire/EMS, veterans, food, disaster, health, youth), overlap filter.
- [x] B4 NO path: literal "both sides" clause in description + criteria; NTEE list corrected (M24/M20/W30/K31/E20-E22/O).
- [x] B4 Schedule A donor fallback + self-funding detection (IL $2,000,100 self-loan no longer mislabelled as an outside patron).
- [x] B5 SOP ledger test pollution scrubbed; non-production host guard added (example.com/localhost/127.x never cached or logged).
- [x] B6 Regenerated final: 35/35 records, 0 problems in strict verification, per-race files byte-identical to combined index, manifest hashes verified.
- [x] Removed 35 redundant `.draft.json` per-race files; drafts gitignored.
- [x] Stale "vote/bounty text remains placeholders" comment corrected in `generate-vote-seed.js`.

## Verification snapshot
- records: 35
- archetypes: SUPERPAC 18, EXTRACTIVE 7, WALL_STREET 9, DEFENSE 1
- beneficiaries: 5 YES + 5 NO, disjoint, state-matched, `US-EIN:########` present
- finance: 35/35 career > 0, cycle > 0, coverage date present, 5 donors each
- placeholders/BETA/`$0`/example.com: none
- manifest: 38 shards, 38 hashes OK, 21,634 orgs

## Current Session (2026-11-20, expansion wave) — append

- [x] Diagnosed & fixed "Policy & Governance Votes empty" render path in `docs/index.html` (await `loadCategoryShard` before re-render; committed `5c88a51`, pushed `6f8c2d9`).
- [x] Confirmed live `https://polytab.store/feed.json` == local (0 diffs, 32219 items, last id 93016); homepage renders campaigns.
- [x] WAVE 2 EXPANSION (user-approved: "do it all manually, we can work on the script after"): add next batch of Policy & Governance Votes campaigns via manual authoring + regenerate feeds + commit/push + verify live.
  - [x] Author feed items for new campaigns (manual content, grounded in keyless official sources: congress.gov / senate.gov / clerk.house.gov / NPR-AP-USA Today).
  - [x] Add honest-zero votes entries (fundedUSD=0, votesCount=0).
  - [x] Regenerate beta artifacts (seed + per-bill records + combined), shelf shards, feeds.
  - [x] Commit/push + live verification: commit `604de44` (pushed; main -> `604de44`), deploy "Deploy to GitHub Pages" run in_progress -> completed; live `https://polytab.store/feed.json` now serves 32228 items / 21 Policy & Governance Votes (new ids 93017-93025 present, honest-zero verified).
  - [ ] Follow-up: scripts for wave-3 expansion (user: "we can work on the script after").

## Current Session (2026-11-20, all active Senators/Congressmen POE campaigns) — in progress

Goal: create individual POE campaigns for all 537 active U.S. Senators/Representatives (per `legislators-current.json`, 2026-11-20) without duplicating existing active individual campaigns; use VoteLog/other $0 public sources for funding received and "from who" (as publicly reported) in marketable accountability format with polar A/B options; honest-zero metrics, no fabricated data.

- [x] Batch 1: Canonical roster + dedupe + uncovered list
  - [x] 537 active members; 37 existing individual campaigns matched (35 covered), 502 uncovered (incl. Wesley Bell MO-01). Artifacts cached in `.opencode/cache/`.
  - [x] VoteLog slug/URL resolution and per-state (35 states) + national verified recipient sourcing prepared.
- [x] Batch 2: Funding/source collection (VoteLog member/all-funding, cached, integrity-safe)
  - [x] `scripts/generate-congress-poe-campaigns.js` fetches/caches per-bioguide VoteLog profile/all-funding summaries (502/502 caches present; initial merge embedded 51 summaries, remainder cached for refresh).
- [x] Batch 3: Generate & merge new campaigns into `docs/feed.json` (IDs `92045`+, binary_referendum, honest-zero, sourced funding context/links)
  - [x] `scripts/build-congress-member-campaigns.js` generated/merged 502 campaigns for all uncovered active members (no existing items altered; all 537 active legislators covered).
- [x] Batch 4: Update `docs/data/votes.json`, regenerate shelves/XML feeds
  - [x] Added binary_referendum vote scaffolding for 502 IDs; regenerated shelves/XML feeds (32,747 shelf items).
- [x] Batch 5: Tests/gates, subagent reviews (adversarial-reviewer final gate), fix, stage intended files, commit/push, verify live
  - [x] Local gates passed (post-fixes): feeds 7/7, event-radar 22/22, markets 8/8, bounty-id 9/9.
  - [x] Security-auditor (`ses_e04aeac65ffdZjgPsUfVAS6M3J`): fixed `92546` identity corruption (Aisha Wahab, CA-14), hardened fetch/generate scripts (host allowlist, redirect/size caps, bioguide/path validation, name fallback/sanitization, corruption guard), regenerated artifacts.
  - [x] Adversarial-reviewer (`ses_e04aeac65ffeSG4nuzFSStfAcx`): resolved BLOCKING/MAJOR findings — made Senate/territory `bounty_id`s unique per member (0 duplicates in `92045-92546`), fixed territory labels (Delegates/Resident Commissioner), refreshed all 502 campaigns from 502/502 VoteLog caches (member-specific profile URLs where resolved, sourced funding summaries where parsed; explicit fallback text where unavailable), clarified national-fallback recipient wording.
  - [ ] Stage intended files only, commit/push, and verify live.

Risks: scale (~500 campaigns), per-member funding/"from who" and verified 501(c)(3) recipient/EIN sourcing must be $0/keyless and non-fabricated; existing labels/race-based campaigns complicate dedupe.

## Remaining external actions (owner)
- Rotate the FEC key at api.data.gov (it exists in commit `aa52d65`).
- Add `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets to enable the deploy workflow.
- Add DNS records for `polytab.store`.
