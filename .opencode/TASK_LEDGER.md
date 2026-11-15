# Campaign Framework Evolution Ledger

## Scope
- Separate **Like** (social signal) from **Endorsement** (trust/reputation) terminology and systems.
- Add campaign types: **fixed-target** and **open-ended** (permanent active).
- Allow contributions/votes to continue beyond goal; count accurately over target.
- Treat `$X/vote` as **minimum participation threshold**; allow multiple/custom "votes" (support units).
- Define **steward** (auto-assigned on org verification/unlock) and **endorsed members** (via verification process or steward vouch).

## Status
- [x] Context gathered (index/project/claim/faq/terms/data/worker touchpoints identified)
- [x] Principal-architect design subagent launched
- [ ] Establish framework/rules doc
- [ ] Data/schema updates (campaignType, openEnded, steward, endorsements trust layer, likes naming compat)
- [ ] UI terminology/copy updates (Like vs Endorsement)
- [ ] Campaign behavior: over-goal contributions, open-ended active state
- [ ] Vote/support flow: multi-vote/custom amount above minimum threshold
- [ ] Steward/endorsed member model (docs + UI scaffolding per static constraints)
- [ ] Verification pass / security review / adversarial review gates as required

## Notes
- Preserve non-custodial, claim-first, direct-to-org settlement semantics.
- Keep compatibility with existing like/endorsement snapshot & cloud ledger contracts where possible while renaming user-facing "likes".
- "Votes" are support units, not democratic votes.
