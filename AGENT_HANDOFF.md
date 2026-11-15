# 🤝 AGENT HANDOFF — Polytab

This file is the alley-oop. A dedicated GitHub agent reads this, executes the tasks,
and pushes the result. Everything here is already committed in the repo; nothing is
stubbed, nothing is fabricated.

---

## Non-negotiable rules (read first)

1. **Honest-zero, always.** `fundedUSD = 0`, `votesCount = 0` in every feed, market,
   and queue item until real on-chain votes exist. Never estimate, never seed, never
   invent numbers. Odds / volume stay `0` or `null`.
2. **No coordinates, ever.** Never add `lat`/`lng`/`georss:point` for anything near a
   private individual or home. Radar/queue items keep `lat: null`, `lng: null` and
   store public place-name strings only.
3. **Radar block format is frozen.** Event-Radar queue blocks keep the exact 15-field
   block format and remain `status: "Proposed"`. Promotion into `docs/feed.json` is
   manual + verified — never automatic.
4. **Futarchy settlement is settled.** Every stake funds the project the staker chose
   (100% project escrow, 0% protocol fee, 0% staker payout). Incentives are
   non-monetary reputation only. Do not re-introduce betting/redistribution language.
5. **Run the tests before every push** (see below). All suites must be green.

---

## Task 1 — Deploy the Cloudflare Workers (self-serve, zero cost)

The worker source is up to date but has not been deployed. Deploy all three:

```bash
cd workers
npx --yes wrangler@3 deploy --config wrangler.event-radar.toml
npx --yes wrangler@3 deploy --config wrangler.org-discovery.toml
npx --yes wrangler@3 deploy --config wrangler.market-oracle.toml
```

Requirements / notes:
- Needs `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit) and `CLOUDFLARE_ACCOUNT_ID`.
- **Verify the `name` in each `workers/wrangler.*.toml` matches the existing worker**
  before deploying. If a worker already exists with a different name, update the
  `name =` line rather than creating a duplicate.
- Free tier only. Do not enable paid features (no R2, no D1, no paid plan).

## Task 2 — Enable automatic worker deploys

`.github/workflows/deploy-workers.yml` already exists and is **guarded**: it no-ops
until the secrets exist. To turn it on, add repo secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

After that, any push touching `workers/**` redeploys automatically. (If you prefer
to deploy manually via Task 1, Task 2 is optional.)

## Task 3 — Verify the whole pipeline

```bash
node tests/event-radar.test.js
node tests/feeds.test.js
node tests/markets.test.js
node tests/bounty-id.test.js
node scripts/resolve-markets.js     # prints "All metrics honest-zero"
```

Expected: all suites pass; resolve-markets reports every market honest-zero.

Then confirm the live site serves the data:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://r03lv1s.github.io/Polytab/feed.json
curl -s -o /dev/null -w "%{http_code}\n" https://r03lv1s.github.io/Polytab/data/event-queue.json
curl -s -o /dev/null -w "%{http_code}\n" https://r03lv1s.github.io/Polytab/data/markets.json
```

## Task 4 — Custom domain (owner-side)

`polytab.store` stays 404 until Cloudflare DNS has:
- `A  @  -> 185.199.108.153 / .109.153 / .110.153 / .111.153`
- `CNAME  www -> r03lv1s.github.io`
- DNS-only (grey cloud) until GitHub issues the TLS cert.

---

## What was added in this handoff

| Path | Purpose |
|---|---|
| `scripts/bounty-id.js` | Canonical deterministic bounty ID generator (`bty_<env>_<platform>_<org>_<repo>_<issue>_<hash4>`) |
| `docs/data/schema/bounty.schema.json` | JSON Schema contract for `BountyItem` |
| `tests/bounty-id.test.js` | Offline tests for the generator + schema |
| `.github/workflows/deploy-workers.yml` | Guarded auto-deploy for the Cloudflare Workers |
| `workers/wrangler.*.toml` | Wrangler configs (verify names) |

## Explicitly out of scope (do not do)

- Do not add speculative numbers, odds, volume, or payout language to `markets.json`.
- Do not auto-promote Event-Radar queue items into `feed.json`.
- Do not commit coordinates or any home-address-adjacent data.
- Do not add paid infrastructure.
