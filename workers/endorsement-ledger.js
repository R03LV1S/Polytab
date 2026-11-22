/**
 * Cloudflare Worker: Verifiable, deduplicated social-account endorsement ledger (D1).
 * Path: cloud/github/cloudflare (static GitHub Pages frontend + Worker backend).
 *
 * Endpoints:
 *   GET  /health                      -> { ok, service }
 *   GET  /api/endorsements.json       -> live counts snapshot (by project/provider/total)
 *   GET  /api/creator-claims.json     -> verified creator wallet claims by project_id
 *   POST /api/creator-claim           -> verify claim_token + wallet signature proof, record verified creator wallet
 *   GET  /auth/start?provider=&project_id= -> begins OAuth (PKCE+state), redirects to provider
 *   GET  /auth/callback?code=&state=   -> verifies identity, records blinded endorsement, issues claim_token, redirects back
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// --- Minimal keccak256 + secp256k1 ecrecover for EIP-191 personal_sign verification (no deps) ---
function _k256_rotr(n,x){return (x>>>n)|(x<<(32-n));}
function _k256_keccakF1600(s){
  const RC=[1,0,32898,0,32906,2147483648,2147516416,2147483648,32907,0,2147483649,0,2147516545,2147483648,32777,2147483648,138,0,136,0,2147516425,0,2147483658,0,2147516555,0,139,2147483648,32905,2147483648,32771,2147483648,32770,2147483648,128,2147483648,32778,0,2147483658,2147483648,2147516545,2147483648,32896,2147483648,2147483649,0,2147516424,2147483648];
  for(let rnd=0;rnd<24;rnd++){
    let C0=s[0]^s[10]^s[20]^s[30]^s[40],C1=s[1]^s[11]^s[21]^s[31]^s[41],C2=s[2]^s[12]^s[22]^s[32]^s[42],C3=s[3]^s[13]^s[23]^s[33]^s[43],C4=s[4]^s[14]^s[24]^s[34]^s[44];
    let C5=s[5]^s[15]^s[25]^s[35]^s[45],C6=s[6]^s[16]^s[26]^s[36]^s[46],C7=s[7]^s[17]^s[27]^s[37]^s[47],C8=s[8]^s[18]^s[28]^s[38]^s[48],C9=s[9]^s[19]^s[29]^s[39]^s[49];
    let D0=C8^(C2<<1|C3>>>31),D1=C9^(C3<<1|C2>>>31),D2=C0^(C4<<1|C5>>>31),D3=C1^(C5<<1|C4>>>31),D4=C2^(C6<<1|C7>>>31),D5=C3^(C7<<1|C6>>>31),D6=C4^(C8<<1|C9>>>31),D7=C5^(C9<<1|C8>>>31),D8=C6^(C0<<1|C1>>>31),D9=C7^(C1<<1|C0>>>31);
    for(let i=0;i<50;i+=10){s[i]^=D0;s[i+1]^=D1;s[i+2]^=D2;s[i+3]^=D3;s[i+4]^=D4;s[i+5]^=D5;s[i+6]^=D6;s[i+7]^=D7;s[i+8]^=D8;s[i+9]^=D9;}
    let b0=s[2],b1=s[3],t;b0=(b0<<1|b1>>>31);b1=(b1<<1|b0>>>31);t=s[10];s[10]=b0;s[2]=t;t=s[11];s[11]=b1;s[3]=t;
    b0=s[12];b1=s[13];b0=(b0<<10|b1>>>22);b1=(b1<<10|b0>>>22);t=s[6];s[6]=b0;s[12]=t;t=s[7];s[7]=b1;s[13]=t;
    b0=s[18];b1=s[19];b0=(b0<<20|b1>>>12);b1=(b1<<20|b0>>>12);t=s[44];s[44]=b0;s[18]=t;t=s[45];s[45]=b1;s[19]=t;
    b0=s[40];b1=s[41];b0=(b0<<21|b1>>>11);b1=(b1<<21|b0>>>11);t=s[28];s[28]=b0;s[40]=t;t=s[29];s[29]=b1;s[41]=t;
    b0=s[24];b1=s[25];b0=(b0<<7|b1>>>25);b1=(b1<<7|b0>>>25);t=s[38];s[38]=b0;s[24]=t;t=s[39];s[39]=b1;s[25]=t;
    b0=s[4];b1=s[5];b0=(b0<<12|b1>>>20);b1=(b1<<12|b0>>>20);t=s[32];s[32]=b0;s[4]=t;t=s[33];s[33]=b1;s[5]=t;
    b0=s[8];b1=s[9];b0=(b0<<11|b1>>>21);b1=(b1<<11|b0>>>21);t=s[16];s[16]=b0;s[8]=t;t=s[17];s[17]=b1;s[9]=t;
    b0=s[14];b1=s[15];b0=(b0<<4|b1>>>28);b1=(b1<<4|b0>>>28);t=s[20];s[20]=b0;s[14]=t;t=s[21];s[21]=b1;s[15]=t;
    b0=s[26];b1=s[27];b0=(b0<<14|b1>>>18);b1=(b1<<14|b0>>>18);t=s[30];s[30]=b0;s[26]=t;t=s[31];s[31]=b1;s[27]=t;
    b0=s[42];b1=s[43];b0=(b0<<2|b1>>>30);b1=(b1<<2|b0>>>30);t=s[46];s[46]=b0;s[42]=t;t=s[47];s[47]=b1;s[43]=t;
    b0=s[48];b1=s[49];b0=(b0<<3|b1>>>29);b1=(b1<<3|b0>>>29);t=s[36];s[36]=b0;s[48]=t;t=s[37];s[37]=b1;s[49]=t;
    b0=s[34];b1=s[35];b0=(b0<<6|b1>>>26);b1=(b1<<6|b0>>>26);t=s[22];s[22]=b0;s[34]=t;t=s[23];s[23]=b1;s[35]=t;
    for(let i=0;i<50;i+=10){const b0a=s[i],b1a=s[i+1],b2=s[i+2],b3=s[i+3],b4=s[i+4],b5=s[i+5],b6=s[i+6],b7=s[i+7],b8=s[i+8],b9=s[i+9];s[i]=b0a^(~b2&b4);s[i+1]=b1a^(~b3&b5);s[i+2]=b2^(~b4&b6);s[i+3]=b3^(~b5&b7);s[i+4]=b4^(~b6&b8);s[i+5]=b5^(~b7&b9);s[i+6]=b6^(~b8&b0a);s[i+7]=b7^(~b9&b1a);s[i+8]=b8^(~b0a&b2);s[i+9]=b9^(~b1a&b3);}
    s[0]^=RC[rnd*2];s[1]^=RC[rnd*2+1];
  }
}
function keccak256(bytes){
  const s=new Uint32Array(50); const rate=136; let off=0;
  for(let i=0;i<bytes.length;i++){s[off>>2]^=bytes[i]<<((off&3)*8); off++; if(off===rate){_k256_keccakF1600(s); off=0;}}
  s[off>>2]^=0x01<<((off&3)*8); s[(rate-1)>>2]^=0x80<<(((rate-1)&3)*8); _k256_keccakF1600(s);
  const out=new Uint8Array(32); for(let i=0;i<32;i++) out[i]=(s[i>>2]>>>((i&3)*8))&255; return out;
}
function _hexToBytes(hex){hex=String(hex||"").replace(/^0x/,""); if(hex.length%2) hex="0"+hex; const out=new Uint8Array(hex.length/2); for(let i=0;i<out.length;i++) out[i]=parseInt(hex.slice(i*2,i*2+2),16); return out;}
function _bytesToHex0x(b){return "0x"+Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("");}
// Minimal secp256k1 ecrecover via noble-curves-compatible math (small, pure JS)
const _SECP_P=BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
const _SECP_N=BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const _SECP_A=BigInt(0); const _SECP_B=BigInt(7);
function _mod(a,m){a%=m; return a>=0n?a:a+m;}
function _inv(a,m){let t=0n,newT=1n,r=m,newR=_mod(a,m); while(newR!==0n){const q=r/newR; [t,newT]=[newT,t-q*newT]; [r,newR]=[newR,r-q*newR];} if(r!==1n) return null; return _mod(t,m);} 
function _isOnCurve(x,y){return _mod(y*y-_mod(x*x*x+_SECP_A*x+_SECP_B,_SECP_P),_SECP_P)===0n;}
function _ptAdd(p1,p2){if(!p1) return p2; if(!p2) return p1; const {x:x1,y:y1}=p1,{x:x2,y:y2}=p2; if(x1===x2&&y1===_mod(-y2,_SECP_P)) return null; const m=p1===p2|| (x1===x2&&y1===y2)? _mod((3n*x1*x1+_SECP_A)*_inv(2n*y1,_SECP_P),_SECP_P): _mod((y2-y1)*_inv(_mod(x2-x1,_SECP_P),_SECP_P),_SECP_P); const x3=_mod(m*m-x1-x2,_SECP_P); const y3=_mod(m*(x1-x3)-y1,_SECP_P); return {x:x3,y:y3};}
function _ptMul(k,p){let r=null,add=p; k=_mod(k,_SECP_N); while(k>0n){if(k&1n) r=_ptAdd(r,add); add=_ptAdd(add,add); k>>=1n;} return r;}
function _bytesToBig(b){let n=0n; for(const x of b) n=(n<<8n)|BigInt(x); return n;}
function _bigToBytes32(n){n=_mod(n,_SECP_P); const b=new Uint8Array(32); for(let i=31;i>=0;i--){b[i]=Number(n&255n); n>>=8n;} return b;}
const _G={x:BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"),y:BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8")};
function _decompressPub(x,odd){const y2=_mod(x*x*x+_SECP_A*x+_SECP_B,_SECP_P); let y=_modPow(y2,(_SECP_P+1n)/4n,_SECP_P); if(_mod(y*y,_SECP_P)!==y2) return null; if((y&1n)===1n!==odd) y=_mod(-y,_SECP_P); return {x,y};}
function _modPow(base,exp,mod){let r=1n; base=_mod(base,mod); while(exp>0n){if(exp&1n) r=_mod(r*base,mod); base=_mod(base*base,mod); exp>>=1n;} return r;}
function ecrecoverEth(hashHex, rHex, sHex, v){
  try{
    const hash=_hexToBytes(hashHex), r=_bytesToBig(_hexToBytes(rHex)), s=_bytesToBig(_hexToBytes(sHex));
    if(r<=0n||r>=_SECP_N||s<=0n||s>=_SECP_N) return null;
    let rec=v; if(rec>=27) rec-=27; if(rec!==0&&rec!==1) return null;
    const x=r; const R=_decompressPub(x, rec===1); if(!R) return null;
    const e=_bytesToBig(hash); const rInv=_inv(r,_SECP_N); if(!rInv) return null;
    const u1=_mod(-e*rInv,_SECP_N), u2=_mod(s*rInv,_SECP_N);
    const Q=_ptAdd(_ptMul(u1,_G), _ptMul(u2,R)); if(!Q) return null;
    const pub=new Uint8Array(64); pub.set(_bigToBytes32(Q.x),0); pub.set(_bigToBytes32(Q.y),32);
    const addr=keccak256(pub).slice(12); return _bytesToHex0x(addr);
  }catch(_){return null;}
}
function hashPersonalMessage(msg){
  const m=typeof msg==="string"?new TextEncoder().encode(msg):(msg instanceof Uint8Array?msg:new Uint8Array(msg));
  const prefix=new TextEncoder().encode("\x19Ethereum Signed Message:\n"+m.length);
  const buf=new Uint8Array(prefix.length+m.length); buf.set(prefix,0); buf.set(m,prefix.length);
  return _bytesToHex0x(keccak256(buf));
}
function recoverPersonalSignAddress(message, signatureHex){
  try{
    const sig=_hexToBytes(signatureHex); if(sig.length!==65) return null;
    const r=_bytesToHex0x(sig.slice(0,32)), s=_bytesToHex0x(sig.slice(32,64)); let v=sig[64];
    const hash=hashPersonalMessage(message);
    return ecrecoverEth(hash,r,s,v);
  }catch(_){return null;}
}

function b64urlEncodeString(str) {
  return b64url(new TextEncoder().encode(String(str)));
}
function b64urlDecodeToString(s) {
  const b64 = String(s || "").replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s || "").length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
async function signClaimToken(env, payload) {
  const p = b64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSha256Hex(String(env.PEPPER_SECRET), "ct1." + p);
  return p + "." + sig;
}
async function verifyClaimToken(env, token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const [p, sig] = parts;
    const expected = await hmacSha256Hex(String(env.PEPPER_SECRET), "ct1." + p);
    if (!timingSafeEqual(sig, expected)) return null;
    const payload = JSON.parse(b64urlDecodeToString(p));
    if (!payload || typeof payload !== "object") return null;
    if (Number(payload.exp || 0) <= Date.now()) return null;
    if (!isValidProjectId(String(payload.pid || ""))) return null;
    return payload;
  } catch (_) { return null; }
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBuf = enc.encode(String(a));
  const bBuf = enc.encode(String(b));
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
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
  const headers = { ...corsHeaders(request, env), "Cache-Control": "public, max-age=15", "Vary": "Origin" };
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

function isValidEthAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || ""));
}

async function handleAdminDelete(request, env, url) {
  const headers = { ...corsHeaders(request, env), "Cache-Control": "no-store", "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS" };
  if (request.method !== "POST" && request.method !== "DELETE") return json({ error: "method_not_allowed" }, 405, headers);
  const adminToken = String(env.ADMIN_TOKEN || "");
  if (!adminToken) return json({ error: "admin_not_configured" }, 503, headers);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !timingSafeEqual(token, adminToken)) return json({ error: "unauthorized" }, 401, headers);

  let body = {};
  try { if (request.method === "POST") body = await request.json(); } catch (_) { body = {}; }
  const projectId = String(body.project_id || url.searchParams.get("project_id") || "").trim();
  const provider = String(body.provider || url.searchParams.get("provider") || "").trim().toLowerCase();
  if (!isValidProjectId(projectId)) return json({ error: "invalid_project_id" }, 400, headers);

  let result;
  if (provider) {
    result = await env.DB.prepare("DELETE FROM endorsements WHERE project_id = ? AND provider = ?").bind(projectId, provider).run();
  } else {
    result = await env.DB.prepare("DELETE FROM endorsements WHERE project_id = ?").bind(projectId).run();
  }
  const changes = (result && result.meta && typeof result.meta.changes === "number") ? result.meta.changes : null;
  return json({ ok: true, project_id: projectId, provider: provider || null, deleted: changes }, 200, headers);
}

async function handleCreatorClaims(request, env) {
  const headers = { ...corsHeaders(request, env), "Cache-Control": "public, max-age=15", "Vary": "Origin" };
  try {
    const { results } = await env.DB.prepare(
      "SELECT project_id, provider, wallet, account_label, account_url, status, updated_at FROM creator_claims WHERE status = 'verified'"
    ).all();
    const claims = {};
    for (const r of (results || [])) {
      const pid = String(r.project_id || "").trim();
      if (!isValidProjectId(pid)) continue;
      claims[pid] = {
        wallet: String(r.wallet || ""),
        provider: String(r.provider || ""),
        label: r.account_label ? String(r.account_label).slice(0, 200) : null,
        profile: r.account_url ? String(r.account_url).slice(0, 500) : null,
        status: String(r.status || "verified"),
        updated_at: Number(r.updated_at || 0)
      };
    }
    return json({ claims, generated_at: new Date().toISOString(), source: { type: "cloudflare_worker_d1_creator_claims", note: "Verified creator claims (TikTok/OAuth identity + wallet proof). Not fabricated." } }, 200, headers);
  } catch (_) {
    return json({ claims: {}, generated_at: new Date().toISOString(), error: "unavailable" }, 200, headers);
  }
}

async function handleCreatorClaim(request, env) {
  const headers = { ...corsHeaders(request, env), "Cache-Control": "no-store" };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ error: "invalid_json" }, 400, headers); }
  const projectId = String(body.project_id || "").trim();
  const wallet = String(body.wallet || "").trim();
  const claimToken = String(body.claim_token || "").trim();
  const signature = String(body.signature || "").trim().slice(0, 2048);
  const signedMessage = String(body.signed_message || "").trim().slice(0, 4000);
  if (!isValidProjectId(projectId)) return json({ error: "invalid_project_id" }, 400, headers);
  if (!isValidEthAddress(wallet)) return json({ error: "invalid_wallet" }, 400, headers);
  if (!claimToken) return json({ error: "missing_claim_token" }, 400, headers);
  if (!env.PEPPER_SECRET || String(env.PEPPER_SECRET).length < 32) return json({ error: "server_not_configured" }, 500, headers);

  const payload = await verifyClaimToken(env, claimToken);
  if (!payload) return json({ error: "invalid_or_expired_claim_token" }, 401, headers);
  if (String(payload.pid || "") !== projectId) return json({ error: "claim_token_project_mismatch" }, 401, headers);

  const provider = String(payload.prv || "").toLowerCase();
  const blinded = String(payload.buh || "");
  if (!provider || !blinded) return json({ error: "invalid_claim_token" }, 401, headers);

  // Cryptographically verify EIP-191 personal_sign wallet ownership on-worker.
  if (!signature || !signedMessage) return json({ error: "missing_wallet_signature" }, 400, headers);
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) return json({ error: "invalid_signature_format" }, 400, headers);
  const expectedMessage = "Polytab Creator Claim\nproject_id:" + projectId + "\nwallet:" + wallet.toLowerCase() + "\nchain_id:8453\nclaim_token:" + claimToken;
  if (signedMessage !== expectedMessage) return json({ error: "signed_message_mismatch" }, 400, headers);
  const recovered = recoverPersonalSignAddress(expectedMessage, signature);
  if (!recovered || recovered.toLowerCase() !== wallet.toLowerCase()) return json({ error: "signature_wallet_mismatch" }, 401, headers);

  // Prevent creator-claim overlay from targeting voting/stewarded project ID ranges.
  const pidNum = Number(projectId);
  if (Number.isFinite(pidNum) && pidNum >= 90000 && pidNum < 100000) return json({ error: "ineligible_project" }, 403, headers);

  const now = Date.now();
  const jti = String(payload.jti || "").trim();
  if (!jti) return json({ error: "invalid_claim_token" }, 401, headers);
  try {
    await env.DB.prepare(
      "INSERT INTO creator_claim_token_uses (jti, project_id, used_at, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(jti, projectId, now, Number(payload.exp || 0)).run();
  } catch (_) {
    return json({ error: "claim_token_reused", detail: "This claim token has already been used. Confirm TikTok again to get a fresh token." }, 401, headers);
  }
  try {
    const existing = await env.DB.prepare("SELECT blinded_user_hash FROM creator_claims WHERE project_id = ?").bind(projectId).first();
    if (existing && String(existing.blinded_user_hash || "") && String(existing.blinded_user_hash || "") !== blinded) {
      return json({ error: "claim_exists_for_different_identity", detail: "This project already has a verified creator claim from a different verified identity. Contact support@polytab.store." }, 409, headers);
    }
  } catch (_) {}
  try {
    await env.DB.prepare(
      `INSERT INTO creator_claims (project_id, provider, blinded_user_hash, account_label, account_url, wallet, signature, signed_message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET provider=excluded.provider, blinded_user_hash=excluded.blinded_user_hash, account_label=excluded.account_label, account_url=excluded.account_url, wallet=excluded.wallet, signature=excluded.signature, signed_message=excluded.signed_message, status='verified', updated_at=excluded.updated_at`
    ).bind(projectId, provider, blinded, payload.lbl ? String(payload.lbl).slice(0,200) : null, payload.url ? String(payload.url).slice(0,500) : null, wallet.toLowerCase(), signature, signedMessage.replace(claimToken, "[claim_token_redacted]"), now, now).run();
  } catch (e) {
    return json({ error: "db_error" }, 500, headers);
  }
  return json({ ok: true, project_id: projectId, wallet: wallet.toLowerCase(), provider, status: "verified" }, 200, headers);
}

async function handleStart(request, env, url) {
  const headers = corsHeaders(request, env);
  const provider = String(url.searchParams.get("provider") || "").toLowerCase();
  const projectId = String(url.searchParams.get("project_id") || "").trim();
  const returnToRaw = String(url.searchParams.get("return_to") || "");
  const pconf = getProviderConfig(env, provider);
  if (!pconf) return json({ error: "unsupported_or_unconfigured_provider" }, 400, headers);
  if (!isValidProjectId(projectId)) return json({ error: "invalid_project_id" }, 400, headers);
  if (!env.PEPPER_SECRET || String(env.PEPPER_SECRET).length < 32) return json({ error: "server_not_configured" }, 500, headers);

  const allowed = getAllowedOrigins(env);
  let returnTo = "";
  if (returnToRaw) {
    try {
      const ru = new URL(returnToRaw);
      const allowPath = ["/", "/index.html", "/project.html"].includes(ru.pathname);
      if ((ru.protocol === "https:" || ru.protocol === "http:") && allowed.includes(ru.origin) && allowPath) {
        const safe = new URL(ru.origin + ru.pathname);
        ["id", "creator_claim"].forEach((k) => { const v = ru.searchParams.get(k); if (v) safe.searchParams.set(k, String(v).slice(0, 80)); });
        returnTo = safe.toString();
      }
    } catch (_) {}
  }

  const now = Date.now();
  // prune expired states (best effort)
  try { await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now).run(); } catch (_) {}

  const state = randomB64Url(24);
  const verifier = randomB64Url(32);
  const challenge = await sha256B64Url(verifier);
  const expiresAt = now + 5 * 60 * 1000;

  try {
    await env.DB.prepare(
      "INSERT INTO oauth_states (state_nonce, project_id, provider, code_verifier, created_at, expires_at, return_to) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(state, projectId, provider, verifier, now, expiresAt, returnTo || null).run();
  } catch (_) {
    await env.DB.prepare(
      "INSERT INTO oauth_states (state_nonce, project_id, provider, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(state, projectId, provider, verifier, now, expiresAt).run();
  }

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
  return Response.redirect(auth.toString(), 302);
}

async function handleCallback(request, env, url) {
  const headers = corsHeaders(request, env);
  const code = String(url.searchParams.get("code") || "");
  const state = String(url.searchParams.get("state") || "");
  if (!code || !state) return text("Missing code or state.", 400, headers);

  const now = Date.now();
  // Consume state atomically: use DELETE ... RETURNING where supported (D1 / SQLite 3.35+)
  let row = null;
  try {
    row = await env.DB.prepare(
      "DELETE FROM oauth_states WHERE state_nonce = ? RETURNING project_id, provider, code_verifier, expires_at, return_to"
    ).bind(state).first();
  } catch (_) {
    // Safe fallback for engines without RETURNING
    try {
      row = await env.DB.prepare(
        "SELECT project_id, provider, code_verifier, expires_at, return_to FROM oauth_states WHERE state_nonce = ?"
      ).bind(state).first();
    } catch (_) {
      row = await env.DB.prepare(
        "SELECT project_id, provider, code_verifier, expires_at FROM oauth_states WHERE state_nonce = ?"
      ).bind(state).first();
    }
    if (row) {
      await env.DB.prepare("DELETE FROM oauth_states WHERE state_nonce = ?").bind(state).run();
    }
  }
  if (!row) return text("Invalid or expired state.", 400, headers);
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

  const claimToken = await signClaimToken(env, {
    jti: crypto.randomUUID(), pid: projectId, prv: provider, buh: blinded,
    lbl: accountLabel ? String(accountLabel).slice(0, 200) : "",
    url: accountUrl ? String(accountUrl).slice(0, 500) : "",
    iat: now, exp: now + 10 * 60 * 1000
  });

  const allowed = getAllowedOrigins(env);
  let destBase = allowed[0] || "https://polytab.store";
  const returnTo = row && row.return_to ? String(row.return_to) : "";
  if (returnTo) {
    try {
      const ru = new URL(returnTo);
      const allowPath = ["/", "/index.html", "/project.html"].includes(ru.pathname);
      if ((ru.protocol === "https:" || ru.protocol === "http:") && allowed.includes(ru.origin) && allowPath) {
        const safe = new URL(ru.origin + ru.pathname);
        ["id", "creator_claim"].forEach((k) => { const v = ru.searchParams.get(k); if (v) safe.searchParams.set(k, String(v).slice(0, 80)); });
        destBase = safe.toString();
      }
    } catch (_) {}
  }
  const dest = new URL(destBase);
  dest.searchParams.set("endorsed_project", projectId);
  dest.searchParams.set("endorsed_provider", provider);
  dest.searchParams.set("endorsed", "1");
  if (accountLabel) dest.searchParams.set("verified_label", String(accountLabel).slice(0, 200));
  if (accountUrl) dest.searchParams.set("verified_profile", String(accountUrl).slice(0, 500));
  // Put claim_token in fragment to reduce referrer/log leakage (not sent in Referer headers).
  dest.hash = "claim_token=" + encodeURIComponent(claimToken);
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
      if (url.pathname === "/api/creator-claims.json") return await handleCreatorClaims(request, env);
      if (url.pathname === "/api/creator-claim") return await handleCreatorClaim(request, env);
      if (url.pathname === "/auth/start") return await handleStart(request, env, url);
      if (url.pathname === "/auth/callback") return await handleCallback(request, env, url);
      if (url.pathname === "/admin/delete-endorsements") return await handleAdminDelete(request, env, url);
      return json({ error: "not_found" }, 404, corsHeaders(request, env));
    } catch (e) {
      return json({ error: "internal_error" }, 500, corsHeaders(request, env));
    }
  },
};
