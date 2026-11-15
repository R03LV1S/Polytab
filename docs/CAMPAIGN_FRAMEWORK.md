# Polytab Campaign Framework (Likes, Endorsements, Stewards, Campaign Types)

This document defines the evolved campaign framework for Polytab (`polytab.store`). It complements the claim-first, non-custodial model: Polytab never takes custody of funds; contributions settle directly to the verified payout wallet for a campaign/org when unlocked.

## 1. Terminology: Likes vs Endorsements (separate concepts)

### Likes (social support signal)
- **Like = endorsement terminology removed for this concept.** A Like is the same as a like on social media posts or YouTube videos: a lightweight way for users to say **"I like this campaign."**
- Likes are **not** votes, **not** payments, **not** proof of participation, and **not** a trust/reputation badge.
- Likes may be verified/deduplicated by provider identity (where available) to keep counts honest, but the meaning remains **social support only**.
- UI and copy must use **"Like" / "Likes"** for this concept (no "endorsement" wording).

### Endorsements (trust & reputation signal)
- An **Endorsement** is a higher-trust signal from people with real-world, hands-on experience with a campaign/organization (e.g. community volunteers, active participants, beneficiaries).
- Purpose: help the community understand **"this is not a scam / I’ve worked with this organization"** by attaching lived experience and accountability.
- Endorsements contribute to a campaign’s **reputation/trust level badge** (e.g. tiers/badges derived from verified experience, role, and/or steward vouching).
- Endorsements are distinct from Likes: a user can Like a campaign without endorsing it, and endorsements carry stronger verification/attestation requirements.

## 2. Campaign types

Polytab supports two campaign funding modes:

### Fixed-target campaigns
- Have a stated funding goal/target (`targetUSD`).
- **Fulfillment of the target does not close contributions.** Users can still vote/contribute after the goal is met.
- Totals (funded amount, support units/votes, and receipts) must continue to be counted accurately **beyond the goal amount**.
- UI should clearly show goal progress and that support can continue post-goal.

### Open-ended campaigns
- **No required completion cap** (target may be absent, informational, or marked open-ended).
- Remain **Active/Permanently open for support** until the verified organization/steward closes or pauses them according to policy.
- Designed for charities/organizations with indefinite or ongoing needs.
- Totals must be counted accurately over time with no artificial goal cutoff.

## 3. Votes / support units and contribution amounts

- **"$X / vote" is a minimum participation threshold**, not a price of a democratic vote.
- **"Votes" are support units/terminology only** (a way to show support), **not actual democratic votes**.
- Users may cast **as many votes/support units as they want** in one action, subject to minimum threshold and payment/network constraints.
- The interface should support selecting multiple units and/or a custom contribution amount (normalized to support units and/or exact amount as applicable) so supporters can give e.g. $5, $50, $500, $5,000+ in a single flow where possible.
- **Over-target contributions are allowed** in all campaign types; funded totals and unit counts must reflect actual contributions without capping at target.

## 4. Stewards and campaign management

- **Automatic steward assignment:** when an organization is verified and unlocks a campaign/bounty, the unlocking verified account/entity becomes the campaign’s **official steward/arbiter**.
- Steward responsibilities (within platform constraints): represent the campaign, manage campaign presentation/status per allowed controls, and participate in trust processes (including vouching) consistent with verification and auditability.
- Polytab remains non-custodial: stewardship of a campaign page does **not** grant custody of funds.

## 5. Endorsed members (org/community participants)

- Other organizational members or qualified participants may become **endorsed members** of a campaign/bounty by either:
  1. Completing the **endorsement verification process** (attesting hands-on experience/role with appropriate evidence), or
  2. Receiving a **vouch** from the campaign’s verified steward (where permitted), subject to policy and anti-abuse checks.
- Endorsed members are displayed as **endorsed members** of that campaign/bounty and may contribute to its trust/reputation signals/badges.
- Vouching and endorsement verification must be auditable, attributable (to the extent compatible with privacy/safety), and revocable/contestable under policy.

## 6. Trust, safety, and integrity rules

- **Identity & authority:** steward control and endorsed-member status require verification appropriate to the claimed authority; Likes do not.
- **No implied custody/guarantees:** badges, endorsements, and steward status signal trust/reputation, not guaranteed outcomes or financial guarantees.
- **Transparency:** campaign type (fixed/open-ended), goal/target semantics, minimum threshold, and whether contributions continue post-goal must be clearly disclosed.
- **Anti-abuse:** rate limits, dedupe, evidence/vouch provenance, and dispute/report pathways should protect against impersonation, astroturfing, and fake endorsements.
- **Non-custodial/direct settlement:** contributions for unlocked/verified campaigns settle directly to the verified org/campaign payout wallet; Polytab does not intermediate custody.

## 7. Implementation notes (current codebase alignment)

- Current "verified endorsements" infrastructure (GitHub issue ledger, snapshots, cloud ledger) historically powers **Like** counts; migration must preserve counting correctness and compatibility while renaming user-facing meaning to **Likes**.
- New **Endorsement (trust)** records, badges, steward assignment, and endorsed-member/vouch flows require additive data contracts and UI surfaces (and, where needed, edge/worker support) without breaking claim-first settlement.
- Campaign/project records should evolve to include: `campaignType` (`fixed`|`open_ended`), open-ended/active semantics, target optionality as applicable, and fields/refs for steward and endorsed members.

*Status: framework established per product direction; implementation proceeds incrementally with schema/UI/docs updates and verification gates.* 
