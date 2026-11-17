---
sop_schema: "polytab-sop-ledger-v1"
mutation_rule: "PREPEND_ONLY_BELOW_SENTINEL"
---

# 🛡️ POLYTAB IMMUTABLE SOP & INCREMENTAL MINING LEDGER
> **MACHINE & HUMAN OPERATING DIRECTIVE (DO NOT REMOVE)**
> 1. **Purpose:** Prevents redundant re-mining of OpenFEC, VoteLog, and Congress-Legislators endpoints across runs.
> 2. **Prepend Protocol (LIFO):** Every cycle MUST prepend its summary immediately **below** the sentinel marker so the newest update is always at the top of the list.
> 3. **Cache Lookup:** `fetchJsonWithRetry` checks `docs/data/cache/mining-state-ledger.json` first and skips network I/O when within TTL.

<!-- === SOP:PREPEND_BELOW_THIS_LINE === -->

### [2026-11-17T01:06:16.926Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 31
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T01:06:03.988Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 31
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T01:05:15.217Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 31
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T01:04:39.473Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 31
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T01:03:25.432Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 31
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T01:01:42.474Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 31
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T00:58:44.552Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 4
- **Newly Mined / Refreshed Endpoints:** 28
- **Total Cached Endpoints Indexed:** 32

### [2026-11-17T00:36:15.692Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 4
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 6

### [2026-11-17T00:31:43.765Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 4
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 6

### [2026-11-17T00:30:51.680Z] Run: `us_senate-2026`
- **Local Cache Hits (Skipped Network):** 0
- **Newly Mined / Refreshed Endpoints:** 5
- **Total Cached Endpoints Indexed:** 6

### [2026-11-16T23:11:23.394Z] Run: `test-run`
- **Local Cache Hits (Skipped Network):** 1
- **Newly Mined / Refreshed Endpoints:** 1
- **Total Cached Endpoints Indexed:** 1
