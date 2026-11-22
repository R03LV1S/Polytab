/**
 * Cloudflare Worker: Basic $0 like/endorsement deterrence gate (stateless).
 *
 * Purpose: basic deterrence only (not strong anti-gamification).
 * - Verifies Cloudflare Turnstile token (optional but recommended)
 * - Best-effort per-IP + per-project cooldown via Cache API (no D1/KV/R2)
 * - Returns {ok:true} when action is allowed; frontend should still treat
 *   global counts as authoritative only from aggregated endorsements snapshot.
 *
 * Env vars/secrets:
 *   TURNSTILE_SECRET_KEY   (optional; if set, token verification required)
 *   ALLOWED_ORIGINS        (comma-separated, default polytab origins)
 *   COOLDOWN_SECONDS       (default 86400)
 */

const DEFAULT_ALLOWED = "https://polytab.store,https://r03lv1s.github.io,http://localhost:3000";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ALLOWED).split(",").map(s => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = getAllowedOrigins(env);
  const h = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function isValidProjectId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(env, token, ip) {
  const secret = String(env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== "string" || token.length > 2048) return { ok: false, error: "missing_or_invalid_turnstile_token" };
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!res.ok) return { ok: false, error: "turnstile_verify_failed" };
  const data = await res.json().catch(() => null);
  return { ok: !!(data && data.success), error: data && data.success ? null : "turnstile_rejected" };
}

async function cooldownHit(cacheKey, cooldownSeconds) {
  const cache = caches.default;
  const req = new Request("https://like-guard.polytab.internal/" + cacheKey, { method: "GET" });
  const existing = await cache.match(req);
  if (existing) return true;
  await cache.put(req, new Response("1", {
    headers: { "Cache-Control": "max-age=" + String(Math.max(60, cooldownSeconds)), "Content-Type": "text/plain" },
  }));
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({ ok: true, service: "polytab-like-guard" }, 200, cors);
    if (url.pathname !== "/api/like" || request.method !== "POST") return json({ ok: false, error: "not_found" }, 404, cors);

    const origin = request.headers.get("Origin") || "";
    const allowed = getAllowedOrigins(env);
    if (origin && !allowed.includes(origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, cors);

    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (ct && !ct.includes("application/json")) return json({ ok: false, error: "invalid_content_type" }, 415, cors);
    const len = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(len) && len > 1024) return json({ ok: false, error: "body_too_large" }, 413, cors);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return json({ ok: false, error: "body_too_large" }, 413, cors);
      body = JSON.parse(raw);
    } catch (_) { return json({ ok: false, error: "invalid_json" }, 400, cors); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_json" }, 400, cors);
    const projectId = String(body.project_id || "");
    const token = typeof body.turnstile_token === "string" ? body.turnstile_token : "";
    if (!isValidProjectId(projectId)) return json({ ok: false, error: "invalid_project_id" }, 400, cors);

    const turnstileSecretSet = !!String(env.TURNSTILE_SECRET_KEY || "").trim();
    if (turnstileSecretSet && String(env.REQUIRE_TURNSTILE || "") !== "1") {
      return json({ ok: false, error: "server_misconfigured_turnstile" }, 503, cors);
    }

    const ip = String(request.headers.get("CF-Connecting-IP") || "").trim();
    if (!ip) return json({ ok: false, error: "client_ip_unavailable" }, 400, cors);
    const turnstile = await verifyTurnstile(env, token, ip);
    if (!turnstile.ok) return json({ ok: false, error: turnstile.error || "turnstile_rejected" }, 403, cors);

    const cooldownSeconds = Math.max(60, Number(env.COOLDOWN_SECONDS || 86400) || 86400);
    const ipHash = await sha256Hex("ip:" + ip);
    const key = "cooldown/" + encodeURIComponent(projectId) + "/" + ipHash;
    const hit = await cooldownHit(key, cooldownSeconds);
    if (hit) return json({ ok: false, error: "rate_limited", cooldown_seconds: cooldownSeconds }, 429, cors);

    return json({ ok: true, deterrence: "basic", authoritative: false }, 200, cors);
  },
};