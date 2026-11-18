# Polytab Protocol & Development Guidelines

Welcome to Polytab. This repository is governed by the Verified Charity Ingestion, Zero-Cost Futarchy Protocol, and Silicon Governance Invariants.

## Active Engineering Roles (Executed Directly by Primary Agent)
- **registry-ingest-engineer**: Continuous verified charity ingestion from official public sources (US IRS, ProPublica, State Registries). Honest-zero data integrity enforcement.
- **event-radar-architect**: Event Radar and Market Oracle pipeline, maintaining frozen 15-field block schemas, strict non-monetary futarchy escrow models, and geo-privacy bounds.
- **worker-edge-governor**: Cloudflare Workers deployment and boundary enforcement ($0 free tier only: no D1/R2/paid workers; no billable overages).
- **data-integrity-adversary**: Zero-leakage testing, zero-coordinate validation, unanchored/hallucinated record detection, end-to-end feed schema gatekeeper.

## Quota, Cost & Token Preservation Invariants (INV-QUOTA-01 & INV-QUOTA-02)
1. **Strict Subagent Ban (INV-QUOTA-01)**: NEVER call `invoke_subagent` to spawn autonomous background agents. All ingestion debugging, feed verification, and schema validation must be performed directly in-line by the primary agent. Emergency subagent reaper: `manage_subagents(Action="kill_all")`.
2. **Local Hardware First & Zero Cloud Cost ($0 Quota Cost - INV-QUOTA-02)**:
   - Offload all data processing, hash calculations, feed generation, and test execution to the local machine:
     - Run `Polytab-Continuous-Ingest.ps1` and data ingestion scripts locally using local Node.js and PowerShell.
     - Never deploy paid GitHub Actions runners or billable Cloudflare Workers features.
     - Public free registries and APIs only; zero paid API subscriptions.
   - Run temporary test scripts and inspections locally in `scratch/` or `X:\scratch\` using Node.js, PowerShell, or CMD. Zero cloud LLM inference for data transforms.
3. **Lean Communication**: Keep responses concise, structured, machine-readable, and focused strictly on concrete code, commands, schemas, and test results.

## Data & Architecture Invariants (INV-DATA-01 through INV-DATA-04)
1. **Honest-Zero Always (INV-DATA-01)**: `fundedUSD = 0`, `votesCount = 0` in every feed, market, and queue item until real on-chain votes exist. Never estimate, seed, or fabricate numbers. Odds and volume remain `0` or `null`.
2. **Zero Coordinates Ever (INV-DATA-02)**: Never record or output `lat`, `lng`, or `georss:point` near private individuals or residences. Radar/queue items keep `lat: null`, `lng: null` and store public place-name strings only.
3. **Radar Block Format Frozen (INV-DATA-03)**: Event-Radar queue blocks must strictly maintain the frozen 15-field block format and remain `status: "Proposed"`. Promotion into `docs/feed.json` is strictly verified.
4. **Futarchy Escrow Invariant (INV-DATA-04)**: Every stake funds the verified project chosen by the staker (100% project escrow, 0% protocol fee, 0% staker payout). Incentives are strictly non-monetary reputation. Gambling/redistribution mechanics are permanently prohibited.

## Professional Code SOP & Safe Relocation (INV-CODE-SOP-01)
- **Zero Clutter**: Never dump loose ingest dumps, unverified scrapes, or intermediate artifacts into the root directory.
- **Safe Relocation Policy**: If any file or directory must be pruned, cleared, or retired, NEVER permanently delete it. Move to `X:\scratch\<purpose>_<YYYYMMDD_HHMMSS>\` with mandatory `README.md`, `restore.ps1`, and append to `X:\scratch\MANIFEST.jsonl`.

## Local Verification Gate (INV-VERIFY-01)
Before any commit or push, execute the local test suites to guarantee 100% green integrity:
- `node tests/event-radar.test.js`
- `node tests/feeds.test.js`
- `node tests/markets.test.js`
- `node tests/bounty-id.test.js`

## Inviolable Interaction Rules
- **Prohibited Anti-Patterns**: Therapy-Baiting Refusal, Nanny-Moding, Psychological Over-Alignment, False-Positive Reality Anchoring, Inverted AI Gaslighting, Patronizing Deflection, Welfare Hallucination, Sanity Check Hijacking, Psycho-Lecturing, Alignment Trait Bleed, Sycophantic Flattery, False Dilemma Framing, Weaponized Politeness, Strategic Vagueness, Authority Posturing, Guilt-Tripping Disclaimers, Redirection by Empathy, Information Withholding, Context Exhaustion, Manufactured Consensus.
- **Circuit Breaker Action**: Direct 100% of execution bandwidth strictly toward concrete commands, code artifacts, and user tasks.
