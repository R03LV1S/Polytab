// Polytab escrow watchdog v2 — polls Base mainnet for ANY outgoing movement of the
// Polytab-managed Base escrow address and raises an alarm on unexpected movement.
//
// Checks each run (.github/workflows/escrow-watchdog.yml, every 30 minutes):
//   1. Native ETH balance (eth_getBalance) — any DECREASE alerts (nothing should leave)
//   2. Outgoing transaction nonce (eth_getTransactionCount) — any INCREASE alerts
//      (nonce only rises when the escrow signs a transaction, so this detects any ETH or ERC20 outflow)
//   3. Best-effort ERC20 inbound-log scan (informational; never alerts on its own)
//
// Endpoint cascade (no API key required):
//   - If repo secret BASE_RPC_URL is set, use it exclusively (recommended: Alchemy / QuickNode / Infura free tier —
//     then getLogs is unlimited and complete).
//   - Otherwise try, in order: https://1rpc.io/base (50-block getLogs window),
//     https://base.publicnode.com (may require an address filter — tolerated),
//     https://mainnet.base.org (balance/nonce only; no log scan).
//   - If every log scan fails, exit 0 with a warning — log scanning is informational.
//     Alerts depend only on balance + nonce, which every public endpoint serves.
//
// State: docs/data/escrow-state.json (committed by the workflow).
// Acknowledged sweeps: docs/data/escrow-sweeps.json (audit annotation; never mutes).
// Alerts always fire on outgoing movement — silence is the wrong outcome.
// Exits 0 on clean/first-run/transient-error, 2 on alert.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "docs", "data", "escrow-state.json");
const SWEEPS_PATH = path.join(ROOT, "docs", "data", "escrow-sweeps.json");
const ALERTS_PATH = path.join(ROOT, "docs", "data", "escrow-alerts.json");

const ESCROW = "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08";
const ESCROW_TOPIC = "0x0000000000000000000000001e89ff2c2922528c8ace8db07f73ef979ea76c08";
const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Cascade of free endpoints; secret override forces one.
const FORCED = (process.env.BASE_RPC_URL || "").replace(/\/$/, "");
const ENDPOINTS = FORCED
  ? [FORCED]
  : ["https://1rpc.io/base", "https://base.publicnode.com", "https://mainnet.base.org"];
const MAX_SCAN_BLOCKS = 1000;   // bound per run; Base ~2s blocks, 30-min cycle ≈ 900 blocks
const CHUNK = 50;               // 1rpc caps getLogs at 50 blocks

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let stickyEndpoint = null;
async function rpc(method, params) {
  const ordered = stickyEndpoint ? [stickyEndpoint, ...ENDPOINTS.filter(e => e !== stickyEndpoint)] : ENDPOINTS;
  let lastErr = null;
  for (const url of ordered) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(25000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429 || (j && j.error && /limit|rate|exhaust/i.test(JSON.stringify(j.error)))) { lastErr = new Error(url + " rate limit: " + JSON.stringify(j.error || res.status)); continue; }
      if (j && j.error) { lastErr = new Error(url + " RPC error: " + JSON.stringify(j.error).slice(0, 120)); continue; }
      stickyEndpoint = url;
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All Base RPC endpoints failed");
}

async function rpcSeq(calls, pauseMs) {
  const out = [];
  for (const [method, params] of calls) {
    out.push(await rpc(method, params));
    await sleep(pauseMs == null ? 300 : pauseMs);
  }
  return out;
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return fallback; }
}
function saveJson(p, v) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
}
function appendAlert(kind, details) {
  const alerts = loadJson(ALERTS_PATH, []);
  alerts.push({ kind, at: new Date().toISOString(), escrow: ESCROW, ...details });
  saveJson(ALERTS_PATH, alerts);
}

(async () => {
  const now = new Date().toISOString();
  const [balanceRaw, nonceRaw, blockRaw] = await rpcSeq([
    ["eth_getBalance", [ESCROW, "latest"]],
    ["eth_getTransactionCount", [ESCROW, "latest"]],
    ["eth_blockNumber", []],
  ]);
  const balance = BigInt(balanceRaw);
  const nonce = parseInt(nonceRaw, 16);
  const block = parseInt(blockRaw, 16);

  const allowlistedSweeps = new Set((loadJson(SWEEPS_PATH, []) || []).map(h => String(h).toLowerCase()));
  const prev = loadJson(STATE_PATH, { baseline: false });
  const firstBaseline = prev.baseline !== true;

  const alertFlags = [];
  if (!firstBaseline) {
    const prevBalance = BigInt(prev.balanceWei || "0");
    if (balance < prevBalance) {
      alertFlags.push({ kind: "balance_decrease", prev: prevBalance.toString(), now: balance.toString(), delta: (prevBalance - balance).toString() });
    }
    if (nonce > (prev.nonce || 0)) {
      alertFlags.push({ kind: "outgoing_tx", prevNonce: prev.nonce || 0, nowNonce: nonce, note: "Any nonce increase means the escrow signed an outgoing transaction — must be a documented sweep." });
    }
  }

  // --- Best-effort ERC20 inbound-log scan (informational only; never alerts) ---
  let incomingCount = null, logScanNote = null;
  const storedBlock = firstBaseline ? Math.max(0, block - MAX_SCAN_BLOCKS) : Math.min(block, (prev.lastBlock || block) + 1);
  const span = Math.min(MAX_SCAN_BLOCKS, block - storedBlock + 1);
  let seenTxs = new Set(prev.seenLogTxs || []);
  try {
    let scanned = 0, inCount = 0;
    for (let start = storedBlock; start <= block && scanned < MAX_SCAN_BLOCKS; start += CHUNK) {
      const end = Math.min(block, start + CHUNK - 1);
      const logs = await rpc("eth_getLogs", [{ fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16), topics: [TRANSFER_SIG, null, ESCROW_TOPIC] }]);
      scanned += end - start + 1;
      for (const l of logs || []) {
        const h = String(l.transactionHash || "").toLowerCase();
        if (!seenTxs.has(h)) { seenTxs.add(h); inCount++; }
      }
    }
    incomingCount = inCount;
  } catch (e) {
    logScanNote = "log scan skipped: " + String((e && e.message) || e).slice(0, 140);
    console.log("note:", logScanNote);
  }

  const state = {
    baseline: true,
    escrow: ESCROW,
    chainId: 8453,
    balanceWei: balance.toString(),
    nonce,
    lastBlock: block,
    incomingErc20SinceLastCheck: incomingCount,
    logScanNote,
    allowedSweeps: Array.from(allowlistedSweeps),
    seenLogTxs: Array.from(seenTxs).slice(-4000),
    lastCheckUtc: now,
    lastStatus: alertFlags.length ? "ALERT" : "ok",
    endpointUsed: stickyEndpoint,
  };
  saveJson(STATE_PATH, state);

  if (alertFlags.length) {
    appendAlert("movement", { block, flags: alertFlags });
    console.log("ALERT:", JSON.stringify(alertFlags, null, 2));
    process.exit(2);
  } else if (firstBaseline) {
    console.log("Baseline established:", JSON.stringify({ balanceWei: state.balanceWei, nonce, lastBlock: block }));
  } else {
    console.log("OK", JSON.stringify({ balanceWei: state.balanceWei, nonce, lastBlock: block, incomingErc20: incomingCount, endpoint: stickyEndpoint }));
  }
})().catch(e => {
  // Transient infrastructure error (all RPC endpoints down/rate-limited) — retry next run.
  // NOT an escrow alert, no issue filed.
  console.error("Watchdog transient error (will retry next run):", e);
  process.exit(0);
});
