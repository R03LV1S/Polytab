# Polytab

A decentralized micro-voting marketplace where communities fund real-world actions on-chain. Built with Solidity, ethers.js, and static web hosting.

## What is Polytab?

Polytab adapts prediction-market mechanics to civic bounties instead of speculative betting — and unlike Polymarket, **there are no losers**.

1. **Vote:** Community members cast micro-fee votes on proposals (e.g., cleaning the school bleachers).
2. **Pool:** Vote funds accumulate in an on-chain escrow contract.
3. **Execute & Disburse:** Once a vote passes and proof of work is provided, the pooled funds are released to pay the people who completed the job.

### What happens to denied votes?

If a proposal is **denied**, the pooled funds are not lost. They are held in escrow and the voter is **credited** their vote value, which can be reused on any other active vote or a future proposal. No participant ever loses their stake — funds only move when a community-approved action is actually completed.

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

- Global: `/feeds/global.xml` and `/feed.json`
- By category: `/feeds/categories/<slug>.xml`
- By location (GeoRSS): `/feeds/geo/<slug>.xml`
- Per user: `/users/<handle>/activity.xml`
- WebSub hub linked in feed headers for instant syndication.

## Governance

See `docs/governance.md` — 2-of-3 multi-sig cold-storage payout with a 48-hour dispute window.

## Zero-Cost Architecture (10 maneuvers)

1. Cloudflare Worker RSS-to-JSON dynamic query engine (`workers/filter.js`)
2. R2 proof-of-work media delivery (zero egress)
3. Git-commit-as-state immutable accounting
4. WebSub real-time push (hub pinged in Action)
5. Optional Cloudflare D1 SQL cache for leaderboards
6. Giscus forum via GitHub Discussions
7. RSS as failover/mirror directory (IPFS mirrors in feed.json)
8. Cloudflare Edge dynamic OpenGraph tags (`workers/og-rewriter.js`)
9. Edge WAF rate-limiting
10. Automated Cloudflare cache purge in verify-vote Action

## Free Tools Used

| Tool | Free Tier | Role |
|---|---|---|
| GitHub Actions | Unlimited (public repos) | Backend verification, RSS builder |
| GitHub Pages | Unlimited static hosting | Frontend + feeds |
| GitHub Discussions | Unlimited | Forum via Giscus |
| Cloudflare Workers | 100k req/day | Dynamic filtering, OG tags |
| Cloudflare R2 | 10 GB + zero egress | Proof media |
| Cloudflare D1 | 5M reads/day | Optional SQL cache |
| WebSub (Google) | Free public hub | Real-time push |

## Tech

- Solidity (escrow + ballot contracts)
- ethers.js (wallet + contract interaction)
- Static web hosting (GitHub Pages + Cloudflare)

## Links

- Site: https://polytab.store
- RSS: https://polytab.store/feed.xml
- JSON Feed: https://polytab.store/feed.json
