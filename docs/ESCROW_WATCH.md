# Polytab Escrow & Watchdog

The Polytab Base escrow is a single shared omnibus address on **Base (chain ID 8453)**:

**`0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08`**
(QR: [`docs/escrow-qr.png`](docs/escrow-qr.png))

It holds the donated micro-votes ($0.25–$1.00 each) for all currently **unclaimed** charity bounties until the organization verifies and claims its bounty page — see [Claim Your Bounty Page](https://polytab.store/claim.html). Funded pages are swept on-chain to the verified organization's payout wallet. Never-claimed bounties are converted to USD and deposited to the organization's official donation channel with public receipts (see `.github/ISSUE_TEMPLATE/sweep-receipt.md`).

## How safety works

1. **Custody is minimal and bounded.** The escrow holds only unclaimed bounties and only until verification (or platform conversion per the sweep policy). Funds for user-created bounty pages flow directly to the creator's wallet; the escrow never touches them.
2. **Everything is public.** Every deposit, sweep, and receipt is on Base; sweep receipts are posted to this repository (`org-sweep` labeled issues) with transaction hashes and screenshots.
3. **A watchdog alerts on any outgoing movement — every 30 minutes.** `scripts/escrow-watchdog.js` runs on a GitHub Actions schedule and compares:
   - **Native ETH balance** — any decrease alerts (nothing should ever leave without a sweep).
   - **Outgoing nonce** — any increase alerts (the nonce only rises when the escrow signs a transaction; this detects any ETH or ERC20 token send).
   - Plus a best-effort ERC20 inbound-log scan (informational only, feeds `escrow-state.json` — never an alert).
   - Free public-RPC cascade, **no API key required** (`1rpc.io/base` → `base.publicnode.com` → `mainnet.base.org`). First run establishes a baseline; afterwards, balance drops or nonce bumps always open a hard `[ESCROW ALERT]` issue with the full state diff.
4. **Acknowledgment, not suppression.** Legitimate outgoing transfers (sweeps) are documented by appending the transaction hash to `docs/data/escrow-sweeps.json` and publishing a `sweep-receipt` issue. The watchdog does not auto-mute; an alert on an expected sweep is resolved by linking the sweep receipt in the issue. This means **a missed or forged receipt is always loud** — silence never hides a theft.
5. **What it cannot see.** The watchdog reads only public RPC data and cannot see inside the key. Even so, the 30-minute cron forces a visible alert quickly — it does not block a withdrawal, it guarantees detection. Migration to a Safe multisig for the escrow is the natural next hardening step once the escrow holds material funds.

### Setting a dedicated endpoint (optional, recommended once funds accumulate)
The current cron works on free public endpoints. For full-fidelity checks (unlimited `eth_getLogs`, sub-30-second log queries), create a free [Alchemy](https://www.alchemy.com/) account on the Base network and set the endpoint URL as a repository secret named `BASE_RPC_URL` (Settings → Secrets and variables → Actions → New repository secret). The workflow prefers the secret automatically; no code changes needed. Or run a Cloudflare Worker on a 5-minute cron (also free) calling the same script if you want sub-minute granularity — the script is dependency-free and works anywhere Node ≥ 18 is available.

## Operational responses

| Signal | Meaning | Action |
|---|---|---|
| `[ESCROW ALERT] outgoing_tx` | The escrow signed a transaction | Verify against known sweeps; if unauthorized, freeze payouts, alert donors/site notice, investigate key compromise. |
| `[ESCROW ALERT] balance_decrease` | ETH balance fell | Same as above — likely the same event. |
| Watchdog transient error in Actions | Public RPC rate limit or downtime | No action; retries automatically. If persistent, set `BASE_RPC_URL` in the workflow to a private endpoint (e.g., Alchemy free tier). |
| `outgoing_tx` after a known sweep | Expected | Reference the `sweep-receipt` issue and the appended hash in `escrow-sweeps.json`; close the alert issue. |

## For verifiers

To confirm this file describes reality: check [`docs/data/escrow-state.json`](docs/data/escrow-state.json) for the current baseline (balance/nonce/block), and compare it with the escrow's history on any Base explorer (e.g., [Basescan](https://basescan.org/address/0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08)). Every state transition since the baseline was committed in git with a reviewable diff.
