// Polytab escrow watchdog — polls Base mainnet for ANY outgoing movement of the
// Polytab-managed Base escrow address and raises an alarm on unexpected movement.
//
// What it checks each run (GitHub Actions schedule in .github/workflows/escrow-watchdog.yml):
//   1. Native ETH balance (eth_getBalance) — any DECREASE alerts (nothing should leave)
//   2. Outgoing transaction nonce (eth_getTransactionCount) — any INCREASE alerts
//      (nonce only rises when the escrow signs a transaction, so it detects ETH AND ERC20 outflows)
//
// Design rule: every check must run reliably on the free public RPC. Log-scanning for
// specific ERC20 token contracts is intentionally out of scope (unbounded eth_getLogs
// exceeds the public endpoint's limits); nonce + balance cover all outgoing movement,
// which is what matters. Incoming donations are visible in escrow-state.json and on
// any public Base explorer.
//
// State lives in docs/data/escrow-state.json (committed by the workflow).
// Operators acknowledge legitimate outgoing transfers by appending the tx hash
// to docs/data/escrow-sweeps.json so sweeps show up as expected transactions in the
// audit trail. The watchdog ALWAYS alerts on outgoing movement — silence is the wrong
// outcome; an alert on an expected sweep is acknowledged by referencing escrow-sweeps.json.
//
// Alerts: writes docs/data/escrow-alerts.json (workflow opens a GitHub issue).
// Exits 0 on clean or first-run baseline, 2 on alert.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "docs", "data", "escrow-state.json");
const SWEEPS_PATH = path.join(ROOT, "docs", "data", "escrow-sweeps.json");
const ALERTS_PATH = path.join(ROOT, "docs", "data", "escrow-alerts.json");

const ESCROW = "0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08";
const RPC = (process.env.BASE_RPC_URL || "https://mainnet.base.org").replace(/\/$/, "");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Retry with backoff; public RPCs rate-limit (429) under burst load.
async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error("RPC HTTP " + res.status);
      const j = await res.json();
      if (j.error) throw new Error("RPC " + method + " error: " + JSON.stringify(j.error));
      return j.result;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error("RPC " + method + ": retries exhausted");
}

// Sequential RPC calls (never parallel) — bursts trip public-RPC rate limits.
async function rpcSeq(calls) {
  const out = [];
  for (const [method, params] of calls) {
    out.push(await rpc(method, params));
    await sleep(350);
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
      alertFlags.push({ kind: "balance_decrease", prev: prevBalance.toString(), now: balance.toString(), delta: (prevBalance - balance).toString(), allowlistSuppression: false });
    }
    if (nonce > (prev.nonce || 0)) {
      alertFlags.push({ kind: "outgoing_tx", prevNonce: prev.nonce || 0, nowNonce: nonce, note: "Any nonce increase means the escrow signed an outgoing transaction - must be a documented sweep." });
    }
  }

  const state = {
    baseline: true,
    escrow: ESCROW,
    chainId: 8453,
    balanceWei: balance.toString(),
    nonce,
    lastBlock: block,
    allowedSweeps: Array.from(allowlistedSweeps),
    lastCheckUtc: now,
    lastStatus: alertFlags.length ? "ALERT" : "ok",
  };
  saveJson(STATE_PATH, state);

  if (alertFlags.length) {
    appendAlert("movement", { block, flags: alertFlags });
    console.log("ALERT:", JSON.stringify(alertFlags, null, 2));
    process.exit(2);
  } else if (firstBaseline) {
    console.log("Baseline established:", JSON.stringify(state));
  } else {
    console.log("OK: no unexpected movement.", JSON.stringify({ balanceWei: state.balanceWei, nonce, lastBlock: block }));
  }
})().catch(e => {
  // Transient infrastructure error (RPC down, rate-limited, DNS) — retry next run.
  // Deliberately NOT an escrow alert and NOT a job failure; no issue is filed.
  console.error("Watchdog transient error (will retry next run):", e);
  process.exit(0);
});
