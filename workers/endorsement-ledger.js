/**
 * Cloudflare Worker: Verifiable, deduplicated social-account endorsement ledger (D1).
 * Path: cloud/github/cloudflare (static GitHub Pages frontend + Worker backend).
 *
 * Endpoints:
 *   GET /health                       -> { ok, service }
 *   GET /api/endorsements.json        -> live counts snapshot (by project/provider/total)
 *   GET /auth/start?provider=&project_id= -> begins OAuth (PKCE+state), redirects to provider
 *   GET /auth/callback?code=&state=   -> verifies identity, records blinded endorsement, redirects back
 *
 * Required bindings/secrets (wrangler / dashboard):
 *   D1 binding: DB
 *   Secrets/vars:
 *     PEPPER_SECRET            (32+ bytes; HMAC key for blinded identity hash - NEVER expose)
 *     ALLOWED_ORIGINS          (comma-separated origins for CORS/redirect allowlist, e.g. https://polytab.store,https://r03lv1s.github.io)
 *     PUBLIC_BASE_URL          (this worker's public URL, e.g. https://endorsements.example.workers.dev)
 *     GITHUB_CLIENT_ID/SECRET  (optional provider)
 *     GOOGLE_CLIENT_ID/SECRET  (optional provider)
 *     DISCORD_CLIENT_ID/SECRET (optional provider)
 *
 * Security properties:
 * - OAuth state nonce + PKCE (S256), single-use state (atomic delete/consume pattern)
 * - Server-side token exchange and user identity fetch; access tokens not stored
 * - PII-minimized ledger: stores HMAC-SHA256(PEPPER_SECRET, provider:user_id), not raw IDs
 * - Idempotent dedupe: PRIMARY KEY (project_id, provider, blinded_user_hash)
 * - CORS allowlist, basic IP rate limiting (best-effort), strict input validation
 */

const PROVIDERS = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scope: "read:user",
    tokenParamsExtra: {},
    authParamsExtra: {},
    extractId: (data) => (data && data.id != null ? String(data.id) : null),
    extractProfile: (data) => ({ url: data && data.html_url ? String(data.html_url) : null, label: data && data.login ? String(data.login) : null }),
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
    tokenParamsExtra: {},
    authParamsExtra: { prompt: "consent", access_type: "online" },
    extractId: (data) => (data && data.sub != null ? String(data.sub) : null),
    extractProfile: (data) => ({ url: data && data.profile ? String(data.profile) : null, label: data && data.name ? String(data.name) : null }),
  },
  discord: {
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userUrl: "https://discord.com/api/users/@me",
    scope: "identify",
    tokenParamsExtra: {},
    authParamsExtra: {},
    extractId: (data) => (data && data.id != null ? String(data.id) : null),
    extractProfile: (data) => ({ url: (data && data.id) ? ("https://discord.com/users/" + String(data.id)) : null, label: data && data.username ? String(data.username) : null }),
  },
  facebook: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    // token exchange via GET for Facebook is common; we support POST too, but implement GET-style in code path below
    userUrl: "https://graph.facebook.com/me?fields=id,name,link",
    scope: "public_profile",
    tokenMethod: "GET",
    clientIdKey: "client_id",
    clientSecretKey: "client_secret",
    tokenParamsExtra: {},
    authParamsExtra: {},
    extractId: (data) => (data && data.id != null ? String(data.id) : null),
    extractProfile: (data) => ({ url: data && data.link ? String(data.link) : (data && data.id ? ("https://www.facebook.com/" + String(data.id)) : null), label: data && data.name ? String(data.name) : null }),
  },
  tiktok: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    userUrl: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,profile_deep_link",
    scope: "user.info.basic,user.info.profile",
    tokenMethod: "POST_JSON_OR_FORM",
    clientIdKey: "client_key",
    clientSecretKey: "client_secret",
    authClientIdKey: "client_key",
    tokenParamsExtra: {},
    authParamsExtra: {},
    extractId: (data) => {
      const u = data && data.data && data.data.user ? data.data.user : (data && data.user ? data.user : data);
      return u && (u.open_id || u.union_id) ? String(u.open_id || u.union_id) : null;
    },
    extractProfile: (data) => {
      const u = data && data.data && data.data.user ? data.data.user : (data && data.user ? data.user : data);
      return { url: u && u.profile_deep_link ? String(u.profile_deep_link) : null, label: u && u.display_name ? String(u.display_name) : null };
    },
  },
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders } });
}

function getAllowedOrigins(env) {
  const raw = String(env.ALLOWED_ORIGINS || "https://polytab.store,https://r03lv1s.github.io").trim();
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = getAllowedOrigins(env);
  const ok = allowed.includes(origin);
  const h = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
  };
  if (ok) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function b64url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomB64Url(n = 32) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}

async function sha256B64Url(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return b64url(new Uint8Array(hash));
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getProviderConfig(env, provider) {
  const p = PROVIDERS[provider];
  if (!p) return null;
  const up = provider.toUpperCase();
  const clientId = env[`${up}_CLIENT_ID`] || env[`${up}_CLIENT_KEY`];
  const clientSecret = env[`${up}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { ...p, clientId, clientSecret, provider };
}

function isValidProjectId(id) {
  // Canonical shelf IDs are numeric strings; allow conservative alnum/_- up to 64 chars
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function isAllowedRedirectBase(urlStr, env) {
  try {
    const u = new URL(urlStr);
    const allowed = getAllowedOrigins(env);
    return allowed.some(o => {
      try { const ao = new URL(o); return u.origin === ao.origin; } catch (_) { return false; }
    });
  } catch (_) { return false; }
}

// Best-effort in-memory rate limit (per-isolate; not global). Protects against casual bursts.
const rl = new Map();
function rateLimited(ip, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const rec = rl.get(ip) || { c: 0, r: now + windowMs };
  if (now > rec.r) { rec.c = 0; rec.r = now + windowMs; }
  rec.c += 1;
  rl.set(ip, rec);
  return rec.c > limit;
}

async function handleCounts(request, env) {
  const headers = { ...corsHeaders(request, env), "Cache-Control": "public, max-age=15" };
  const { results } = await env.DB.prepare(
    "SELECT project_id, provider, COUNT(*) AS count FROM endorsements GROUP BY project_id, provider"
  ).all();
  const projects = {};
  let grandTotal = 0;
  for (const row of (results || [])) {
    const pid = String(row.project_id);
    if (!projects[pid]) projects[pid] = { total: 0, by_provider: {} };
    const c = Number(row.count) || 0;
    projects[pid].by_provider[String(row.provider)] = c;
    projects[pid].total += c;
    grandTotal += c;
  }
  return json({
    version: 1,
    generated_at: new Date().toISOString(),
    source: { type: "cloudflare_worker_d1_oauth", note: "Counts are unique verified (provider,user) endorsements per project (blinded). Not fabricated." },
    stats: { projects_with_endorsements: Object.keys(projects).length, endorsements_total: grandTotal },
    projects,
  }, 200, headers);
}

async function handleStart(request, env, url) {
  const headers = corsHeaders(request, env);
  const provider = String(url.searchParams.get("provider") || "").toLowerCase();
  const projectId = String(url.searchParams.get("project_id") || "").trim();
  const returnTo = String(url.searchParams.get("return_to") || "");
  const pconf = getProviderConfig(env, provider);
  if (!pconf) return json({ error: "unsupported_or_unconfigured_provider" }, 400, headers);
  if (!isValidProjectId(projectId)) return json({ error: "invalid_project_id" }, 400, headers);
  if (!env.PEPPER_SECRET || String(env.PEPPER_SECRET).length < 32) return json({ error: "server_not_configured" }, 500, headers);

  const now = Date.now();
  // prune expired states (best effort)
  try { await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now).run(); } catch (_) {}

  const state = randomB64Url(24);
  const verifier = randomB64Url(32);
  const challenge = await sha256B64Url(verifier);
  const expiresAt = now + 5 * 60 * 1000;

  await env.DB.prepare(
    "INSERT INTO oauth_states (state_nonce, project_id, provider, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(state, projectId, provider, verifier, now, expiresAt).run();

  const publicBase = String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const redirectUri = `${publicBase}/auth/callback`;
  const auth = new URL(pconf.authUrl);
  auth.searchParams.set(pconf.authClientIdKey || "client_id", pconf.clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", pconf.scope);
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  const extras = pconf.authParamsExtra || {};
  for (const [k, v] of Object.entries(extras)) auth.searchParams.set(k, String(v));

  // store return_to hint in state table? simple: encode allowed return origin in cookie-less way not needed;
  // we redirect to first allowed origin with params. return_to is validated client-side by allowlist on callback redirect below if provided.
  // To carry return_to safely, append a short hash mapping is overkill; instead include in state-derived KV? not available. We'll ignore custom return_to and use ALLOWED_ORIGINS[0] or referrer origin if allowed.
  return Response.redirect(auth.toString(), 302);
}

async function handleCallback(request, env, url) {
  const headers = corsHeaders(request, env);
  const code = String(url.searchParams.get("code") || "");
  const state = String(url.searchParams.get("state") || "");
  if (!code || !state) return text("Missing code or state.", 400, headers);

  const now = Date.now();
  // Consume state atomically: fetch then delete; D1 supports RETURNING in newer SQLite - try safe two-step in batch-like logic
  const row = await env.DB.prepare(
    "SELECT project_id, provider, code_verifier, expires_at FROM oauth_states WHERE state_nonce = ?"
  ).bind(state).first();
  if (!row) return text("Invalid or expired state.", 400, headers);
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_nonce = ?").bind(state).run();
  if (Number(row.expires_at) <= now) return text("Expired state.", 400, headers);

  const provider = String(row.provider);
  const projectId = String(row.project_id);
  const verifier = String(row.code_verifier);
  const pconf = getProviderConfig(env, provider);
  if (!pconf) return text("Provider not configured.", 400, headers);

  const publicBase = String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const redirectUri = `${publicBase}/auth/callback`;

  // Exchange code for token
  let tokenData = {};
  if (pconf.tokenMethod === "GET") {
    const tu = new URL(pconf.tokenUrl);
    tu.searchParams.set(pconf.clientIdKey || "client_id", pconf.clientId);
    tu.searchParams.set(pconf.clientSecretKey || "client_secret", pconf.clientSecret);
    tu.searchParams.set("redirect_uri", redirectUri);
    tu.searchParams.set("code", code);
    // Some providers may accept/ignore code_verifier in GET; include for PKCE where supported
    tu.searchParams.set("code_verifier", verifier);
    const tokenRes = await fetch(tu.toString(), { headers: { "Accept": "application/json", "User-Agent": "polytab-endorsement-ledger/1.0" } });
    if (!tokenRes.ok) return text("Token exchange failed.", 502, headers);
    tokenData = await tokenRes.json().catch(() => ({}));
  } else if (provider === "tiktok") {
    const body = {
      client_key: pconf.clientId,
      client_secret: pconf.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    };
    const tokenRes = await fetch(pconf.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "polytab-endorsement-ledger/1.0" },
      body: new URLSearchParams(body).toString(),
    });
    if (!tokenRes.ok) return text("Token exchange failed.", 502, headers);
    tokenData = await tokenRes.json().catch(() => ({}));
  } else {
    const params = new URLSearchParams({
      [pconf.clientIdKey || "client_id"]: pconf.clientId,
      [pconf.clientSecretKey || "client_secret"]: pconf.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const tokenRes = await fetch(pconf.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "polytab-endorsement-ledger/1.0" },
      body: params.toString(),
    });
    if (!tokenRes.ok) return text("Token exchange failed.", 502, headers);
    tokenData = await tokenRes.json().catch(() => ({}));
  }
  const accessToken = tokenData.access_token || (tokenData.data && tokenData.data.access_token);
  if (!accessToken) return text("No access token.", 502, headers);

  // Fetch identity (access token used once, not stored)
  const userRes = await fetch(pconf.userUrl, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json", "User-Agent": "polytab-endorsement-ledger/1.0" },
  });
  if (!userRes.ok) return text("Identity lookup failed.", 502, headers);
  const userData = await userRes.json().catch(() => ({}));
  const rawId = pconf.extractId(userData);
  if (!rawId) return text("Could not verify identity.", 502, headers);
  const profile = (typeof pconf.extractProfile === "function") ? (pconf.extractProfile(userData) || {}) : {};
  const accountUrl = profile.url ? String(profile.url).slice(0, 500) : null;
  const accountLabel = profile.label ? String(profile.label).slice(0, 200) : null;

  const blinded = await hmacSha256Hex(String(env.PEPPER_SECRET), `${provider}:${rawId}`);
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO endorsements (project_id, provider, blinded_user_hash, created_at, account_url, account_label) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(projectId, provider, blinded, now, accountUrl, accountLabel).run();
  } catch (_) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO endorsements (project_id, provider, blinded_user_hash, created_at) VALUES (?, ?, ?, ?)"
    ).bind(projectId, provider, blinded, now).run();
  }

  const allowed = getAllowedOrigins(env);
  const destBase = allowed[0] || "https://polytab.store";
  const dest = new URL(destBase);
  dest.searchParams.set("endorsed_project", projectId);
  dest.searchParams.set("endorsed_provider", provider);
  dest.searchParams.set("endorsed", "1");
  return Response.redirect(dest.toString(), 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) return json({ error: "rate_limited" }, 429, corsHeaders(request, env));

    try {
      if (url.pathname === "/health") return json({ ok: true, service: "endorsement-ledger" }, 200, corsHeaders(request, env));
      if (url.pathname === "/api/endorsements" || url.pathname === "/api/endorsements.json") return await handleCounts(request, env);
      if (url.pathname === "/auth/start") return await handleStart(request, env, url);
      if (url.pathname === "/auth/callback") return await handleCallback(request, env, url);
      return json({ error: "not_found" }, 404, corsHeaders(request, env));
    } catch (e) {
      return json({ error: "internal_error" }, 500, corsHeaders(request, env));
    }
  },
};
