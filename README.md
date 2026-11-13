# Polytab

A decentralized micro-voting marketplace where communities fund real-world actions on-chain. Built with Solidity, ethers.js, and static web hosting.

## What is Polytab?

Polytab adapts prediction-market mechanics to civic bounties instead of speculative betting — and unlike Polymarket, **there are no losers**.

1. **Vote:** Community members cast micro-fee votes on proposals (e.g., Will Richmond's corrupt Mayor be charged for child SA after the recent allegations?).
2. **Pool:** Vote funds accumulate in an on-chain escrow contract.
3. **Execute & Disburse:** Once a vote passes and proof of work is provided, the pooled funds are released to fund the project/legal costs/pay the people who completed the job/etc.

### What happens to denied votes?

If a proposal **loses**, the pooled funds are not lost. They are held in escrow and the voter is **credited** their vote value, which can be reused on any other active vote or a future proposal. No participant ever loses their stake — funds only move when a community-approved action is actually completed.

## Origin: The Ancient Assembly & The Name "Polytab"

Polytab revives the earliest civic assemblies — the Sumerian *Ukkin*, the Old Kingdom Egyptian *Djatjat/Kenbet*, and the clay-tablet verdict *Di-til-la* — recording immutable public decrees on decentralized ledgers.

**The name itself is the thesis:** *Poly* (many) + *Tab* (tablet). In ancient Mesopotamia and Egypt, civic verdicts, land grants, and community agreements were inscribed on clay tablets — tamper-evident, publicly stored, and permanently preserved. The *Di-til-la* ("it is (hereby) cut/decided") was literally a tablet that cut a verdict into stone.

Polytab is the modern equivalent: **many tablets** — a decentralized, append-only ledger of civic decrees where every vote, every bounty, and every payout is immutably recorded on-chain and mirrored across open RSS/JSON feeds, just as those ancient clay tablets were publicly displayed in temple and palace archives.

Like those ancient councils, Polytab turns community consensus into funded action — now powered by EVM micro-transactions and open feeds instead of stylus and clay.

## Verified Partner Organizations

Polytab's seed bounties feature world-renowned, audited 501(c)(3) organizations that officially accept cryptocurrency:

| Organization | Category | Crypto Rail | Verification |
|---|---|---|---|
| Perkins School for the Blind | Accessibility | Endaoment / Giving Block | Charity Navigator 4-Star |
| GiveDirectly | Civic Tech | Endaoment / Giving Block | GiveWell Top Charity, RCTs |
| The Water Project | Environmental | Direct EVM multi-sig | Live GPS sensor telemetry |
| World Central Kitchen | Classrooms | Giving Block / Base & Polygon | Daily field deployment reports |
| The Tor Project | Civic Tech | Direct EVM (donate.torproject.eth) | Public relay consensus metrics |
| Against Malaria Foundation | Environmental | Direct crypto gateway | GiveWell top charity, door-to-door audits |
| Direct Relief | Classrooms | Giving Block | Charity Navigator 100% score |
| EFF | Civic Tech | Direct ETH/EVM (eff.eth) | CharityWatch A rating |
| Wikimedia Foundation | Civic Tech | Endaoment / Giving Block | Open-source code commits |
| Internet Archive | Civic Tech | Direct EVM wallet | IPFS/Wayback collection hashes |
| UNICEF CryptoFund | Civic Tech | UNICEF Ethereum smart contracts | Open-source dev repos |
| Khan Academy | Classrooms | Giving Block / Endaoment | Open educational content releases |
| Rainforest Foundation US | Environmental | Direct EVM / Giving Block | Drone surveillance maps |
| Doctors Without Borders | Classrooms | Giving Block (EVM/USDC) | Annual programmatic audits |
| Save the Children | Classrooms | Official crypto multi-sig | Third-party field assessments |
| Team Rubicon | Campus Grounds | Giving Block (EVM/USDC) | Geo-located drone imagery |
| Alex's Lemonade Stand | Accessibility | Giving Block / Candid Platinum | Clinical trial transit receipts |
| SeriousFun Children's Network | Accessibility | Candid Platinum | Camp session certifications |
| Give Kids The World Village | Accessibility | Candid Platinum | Resort fulfillment confirmations |
| Amputee Coalition | Accessibility | Candid Platinum | Camp cohort enrollment logs |

All organizations are independently audited (IRS Form 990, Charity Navigator, CharityWatch, Candid Platinum) and accept crypto via Endaoment, The Giving Block, or direct on-chain wallets.

## Data Model

- **Project → Wallet:** every proposal is tied to a project wallet (the creator's wallet), which owns and authorizes the project.
- **Transaction → User:** every vote is a transaction tied to the sending user (`msg.sender`), with their contribution amount recorded per project.

## Feeds (Decentralized Data Bus)

All feeds are static files generated from `docs/feed.json` by `scripts/generate-feeds.js` during the Pages deploy — no backend, no database.

- `https://polytab.store/feed.xml` — RSS 2.0 mirror of the Projects (100 verified organizations).
- `https://polytab.store/feed.json` — JSON Feed 1.1 (canonical machine-readable data).
- `https://polytab.store/feeds/global.xml` — geoRSS mirror; coordinates rounded to 2 decimal places (~1 km) to prevent PII/doxing.
- `https://polytab.store/feeds/audio.xml` — plain-language text feed for screen readers. Audio enclosures are only published when a real recording exists; no placeholder audio.
- `https://polytab.store/data/event-queue.json` — Event Radar queue (proposed blocks, not yet on the shelf).

Every feed states funding and vote counts exactly as stored. At launch those are **honest-zero** (`fundedUSD: 0`, `votesCount: 0`); nothing is estimated or invented.

## Automation (GitHub Actions)

| Workflow | Schedule | Purpose |
|---|---|---|
| `pages.yml` | on push to `main` | Runs offline tests, regenerates RSS/geoRSS, deploys `docs/` to Pages |
| `discover-orgs.yml` | weekly | Discovers candidate organizations; emits verified-block format for human review |
| `discover-events.yml` | every 6 hours | Event Radar: scans GDELT, CDC Newsroom, GDACS, USGS for current events; writes Proposed blocks to `docs/data/event-queue.json` |
| `resolve-markets.yml` | weekly (Mon 06:00 UTC) | Futarchy market oracle: deterministic public-data check + SHA-256, dispute window, multi-sig final call |

Radar survivors are **never auto-promoted**. A queue item becomes a shelf action only after a verified 501(c)(3) pairing and governance sign-off.

## Governance

2-of-3 multi-sig escrow payouts with a 48-hour public dispute window. Details are published in the Governance tab of `docs/index.html`; live policy markets are in `docs/data/markets.json`.

## Zero-Cost Architecture

1. GitHub Pages serves the static frontend and generated feeds.
2. GitHub Actions is the entire backend (scanning, verification, feed generation, market resolution).
3. Git-commit-as-state: every change is an append-only, auditable commit.
4. Cloudflare Workers (`workers/event-radar.js`, `workers/org-discovery.js`, `workers/market-oracle.js`) expose read-only JSON endpoints on the free tier.
5. RSS + JSON Feed act as the data bus; no server or database is required.
6. EIP-681 QR codes let voters fund escrow wallets directly from any EVM wallet.
7. No paid infrastructure: no R2, no D1, no paid DNS, no paid API keys.

## Free Tools Used

| Tool | Free Tier | Role |
|---|---|---|
| GitHub Actions | Unlimited (public repos) | Scanning, verification, feed generation |
| GitHub Pages | Unlimited static hosting | Frontend + feeds |
| GitHub Issues | Unlimited | Vote/proof submission + 48h dispute trail |
| GDELT DOC API | Free, no key | Global news scan (Event Radar) |
| CDC Newsroom RSS | Free, public domain | Public-health scan (Event Radar) |
| GDACS RSS (EU JRC) | Free, public domain | Disaster alerts (Event Radar) |
| USGS GeoJSON | Free, public domain | Significant earthquakes (Event Radar) |
| Cloudflare Workers | 100k req/day | Read-only JSON endpoints |

## Tech

- Solidity (escrow + ballot contracts)
- ethers.js (wallet + contract interaction)
- Static web hosting (GitHub Pages + Cloudflare)

## Links

- Site: https://polytab.store
- RSS: https://polytab.store/feed.xml
- JSON Feed: https://polytab.store/feed.json
