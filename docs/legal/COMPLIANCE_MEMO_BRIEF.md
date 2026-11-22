# Polytab Compliance Memo Brief (Not Legal Advice)

> **Not legal advice.** This brief is prepared by the product/engineering team to help counsel evaluate Polytab’s exact flow. It is factual to the best of our knowledge as of 2026-11-22 and must be reviewed by qualified counsel.

## 1. Product Summary

Polytab is a **non-custodial, open-source directory/routing interface** (static GitHub Pages + Cloudflare edge) that lists community projects, charities, civic votes/predictions, and creator/community causes. Polytab displays project information, verification status, public receipts/proof links, and directs supporters to send funds **directly on-chain** to a listed beneficiary wallet. Polytab does **not** custody, pool, escrow (except legacy watchdog alarm context), control, or disburse user funds.

## 2. Exact Flow (Current)

1. **Listing/discovery**: User browses/searches project pages on `polytab.store` (index, project pages, shelves/feeds). Pages include title, summary, proof plan, status, wallet, QR/links, and CTAs (e.g., “Support/Tip/Contribute”, “Click Here to Vote”).
2. **Project creation**: “Start a Project” form collects metadata and opens a GitHub Issue for public review/verification. Creator Causes are open-ended, no A/B voting, no 501(c)(3) required, but require social-handle verification + public proof of work.
3. **Verification gate**: Unverified org/creator pages are locked and unpromoted; support/contribution buttons disabled. Org claims require registry match + domain control. Creator causes require social-handle verification + proof + payout wallet control (and escalation/fiscal sponsor path for higher-risk cases as policy evolves).
4. **Direct settlement**: When unlocked, supporter sends Base/Polygon EVM transaction directly to beneficiary wallet (EIP-681 QR/link, wallet, or other supported non-custodial path). Polytab never receives funds.
5. **Receipts/audit**: Public tx hashes/receipts/proof are surfaced in GitHub/issues/feeds; honest-zero metrics until verified on-chain data.
6. **No platform economics from contributions**: 0% protocol fee, 0% staker payout, no revenue share, no donor data capture for fundraising, no control over beneficiary disbursement.

## 3. Facts Relevant to Counsel

- **No custody**: Polytab does not hold user funds; direct wallet-to-wallet settlement.
- **No fee**: 0% protocol fee / no take rate from contributions.
- **Hosted fundraising surface**: Polytab hosts pages, CTAs, QR/flyers, discovery, share tools, and verification framing. This is more than a neutral QR generator.
- **Creator causes**: may include unregistered individuals; wording uses “Support/Tip/Contribute”, not tax-deductible donation claims.
- **Charity/org pages**: may reference verified nonprofits; must avoid implying Polytab is a charity/fundraiser/broker/payment processor.
- **Unverified locked/unpromoted**: intended control to reduce abuse/fraud/regulatory exposure.
- **Jurisdictional exposure**: users/donors/beneficiaries may be global, including Florida and other US states with charitable solicitation/fundraising platform rules.

## 4. Questions for Counsel

1. **Charitable solicitation/fundraising platform**: In which states (starting Florida, CA, NY, etc.) could Polytab’s hosted cause pages + CTAs + QR + discovery be treated as charitable solicitation, a fundraising platform, professional fundraiser, fundraising counsel, or similar regulated role?
2. **Creator/personal causes**: Does supporting unregistered individuals (tips/support for community work) create different obligations than verified nonprofit listings? How should Polytab distinguish “personal cause” vs “charitable solicitation”?
3. **Wording**: Is “Support/Tip/Contribute” sufficient/appropriate, and where must we avoid “donate”? Are disclaimers required on every CTA/page?
4. **Verification/promotion**: Does locking/unpromoting unverified pages and requiring verification reduce or change registration obligations?
5. **Payment rails**: Does direct on-chain wallet routing (no custody, no fee) affect money transmission/charitable solicitation analysis?
6. **Required disclosures/registrations**: What state registrations, disclaimers, reporting, bonds, or contracts (if any) are needed for the current flow? What changes would trigger them?
7. **Takedown/abuse**: Recommended notice/reporting/escalation process for fraudulent causes, impersonation, or prohibited fundraising.

## 5. Requested Deliverable

A narrow legal memo covering the **exact current flow** (hosted page + CTA + QR/flyer + verification gate + discovery/feed + direct on-chain settlement, 0% fee, no custody), with state-by-state risk flags and concrete product copy/flow changes required before scaling creator/charity support.