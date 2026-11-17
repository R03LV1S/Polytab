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

## Remaining external actions (owner)
- Rotate the FEC key at api.data.gov (it exists in commit `aa52d65`).
- Add `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets to enable the deploy workflow.
- Add DNS records for `polytab.store`.
