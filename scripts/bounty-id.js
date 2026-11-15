// Canonical Polytab bounty identifier (contract: docs/data/schema/bounty.schema.json)
//
// Deterministic + idempotent: the same source (env, platform, org, repo, issue)
// always produces the same ID, so a GitHub webhook redelivery or a duplicate
// dispatch updates the same record instead of spawning a duplicate bounty.
//
//   bty_<env>_<platform>_<org>_<repo>_<issue>_<hash4>
//   bty_prod_gh_hyperlink_core-api_408_9c1e
//
// env      prod | stg | dev
// platform gh | gl | dc
// hash4    deterministic base-36 checksum of "env:platform:org:repo:issue"
//
// Compartmentalized for Workers KV prefix scans:
//   bounty:active:<id>          (delete on close)
//   bounty:all:<id>
// and for D1: PRIMARY KEY(id) with indexes on (status, org, repo).

const ENVS = ["prod", "stg", "dev"];
const PLATFORMS = ["gh", "gl", "dc"];
const ID_PATTERN = /^bty_(prod|stg|dev)_([a-z0-9-]+)_([a-z0-9-]+)_([a-z0-9-]+)_(\d+)_([a-z0-9]{4,})$/;

function sanitizeSegment(val, fallback) {
  const s = String(val === undefined || val === null ? "" : val)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || fallback;
}

// 32-bit rolling hash -> 4+ base36 chars. Not cryptographic: it only has to be
// stable and collision-resistant enough to separate namespaces.
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < String(str).length; i++) {
    hash = (hash << 5) - hash + String(str).charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 4).padStart(4, "0");
}

function generateBountyId(source) {
  const src = source || {};
  const env = ENVS.includes(src.env) ? src.env : "prod";
  const platform = PLATFORMS.includes(src.platform) ? src.platform : "gh";
  const org = sanitizeSegment(src.org, "org");
  const repo = sanitizeSegment(src.repo, "repo");
  const issue = Number.isInteger(src.issueNumber) && src.issueNumber > 0 ? src.issueNumber : 0;
  const base = env + ":" + platform + ":" + org + ":" + repo + ":" + issue;
  return "bty_" + env + "_" + platform + "_" + org + "_" + repo + "_" + issue + "_" + simpleHash(base);
}

function parseBountyId(id) {
  const m = ID_PATTERN.exec(String(id || ""));
  if (!m) return null;
  return { env: m[1], platform: m[2], org: m[3], repo: m[4], issueNumber: Number(m[5]), hash: m[6] };
}

function isBountyId(id) {
  return ID_PATTERN.test(String(id || ""));
}

module.exports = { generateBountyId, parseBountyId, isBountyId, sanitizeSegment, simpleHash, ID_PATTERN, ENVS, PLATFORMS };
