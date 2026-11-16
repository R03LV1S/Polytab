/**
 * scripts/lib/shard-store.js
 * Deterministic ISO-3166-1 (Country) & ISO-3166-2 (State/Province) Sharding Engine
 * with atomic writes, path-traversal protection, and SHA-256 Merkle root verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Sanitizes country and state/province identifiers into safe filesystem slugs.
 */
export function sanitizeShardKey(rawKey, fallback = '_NATIONAL') {
  if (!rawKey || typeof rawKey !== 'string') return fallback;
  const cleaned = rawKey
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Loads all existing organizations across country/state shards (or legacy verified-orgs.json)
 * into a unified Map keyed by canonical `registry_id`.
 */
export function loadShardedMasterMap(baseDataDir, legacyFile) {
  const masterMap = new Map();
  const orgsRoot = path.join(baseDataDir, 'orgs');

  if (fs.existsSync(orgsRoot)) {
    const countries = fs.readdirSync(orgsRoot, { withFileTypes: true });
    for (const cDir of countries) {
      if (!cDir.isDirectory()) continue;
      const countryPath = path.join(orgsRoot, cDir.name);
      const stateFiles = fs.readdirSync(countryPath).filter((f) => f.endsWith('.json'));
      for (const sFile of stateFiles) {
        const fullPath = path.join(countryPath, sFile);
        try {
          const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          for (const org of parsed.organizations || []) {
            if (org?.registry_id) masterMap.set(org.registry_id, org);
          }
        } catch (err) {
          console.warn(`[WARN] Skipping unreadable shard ${fullPath}: ${err.message}`);
        }
      }
    }
  } else if (legacyFile && fs.existsSync(legacyFile)) {
    const parsed = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : (parsed.organizations || []);
    for (const org of list) {
      if (org?.registry_id) masterMap.set(org.registry_id, org);
    }
  }

  return masterMap;
}

/**
 * Partitions the master Map into `docs/data/orgs/{CC}/{STATE}.json` shards,
 * writes `docs/data/orgs/manifest.json` with a global Merkle root, and writes a
 * compact backward-compatible index to `docs/data/verified-orgs.json`.
 */
export function commitShardedDataset(masterMap, baseDataDir, legacyIndexFile, summaryMetrics, shelfLimit = 2500) {
  const orgsRoot = path.join(baseDataDir, 'orgs');
  fs.mkdirSync(orgsRoot, { recursive: true });

  // Group by Country -> State/Province
  const buckets = new Map();
  for (const org of masterMap.values()) {
    const cc = sanitizeShardKey(org.location?.country_iso2, 'GLOBAL').slice(0, 8);
    const state = sanitizeShardKey(org.location?.admin1_state_province, '_NATIONAL');
    const shardKey = `${cc}/${state}`;
    if (!buckets.has(shardKey)) {
      buckets.set(shardKey, { cc, state, orgs: [] });
    }
    buckets.get(shardKey).orgs.push(org);
  }

  const shardManifestEntries = [];
  const sortedShardKeys = [...buckets.keys()].sort();

  for (const key of sortedShardKeys) {
    const { cc, state, orgs } = buckets.get(key);
    orgs.sort((a, b) => a.registry_id.localeCompare(b.registry_id));

    const countryDir = path.join(orgsRoot, cc);
    fs.mkdirSync(countryDir, { recursive: true });

    const relativeShardPath = `orgs/${cc}/${state}.json`;
    const fullShardPath = path.join(countryDir, `${state}.json`);

    const shardPayload = {
      schema_version: '3.0.0',
      country_iso2: cc,
      admin1_state_province: state,
      count: orgs.length,
      organizations: orgs,
    };

    const serialized = JSON.stringify(shardPayload, null, 2);
    const shardSha256 = crypto.createHash('sha256').update(serialized).digest('hex');

    const tmpPath = `${fullShardPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, fullShardPath);

    shardManifestEntries.push({
      shard: relativeShardPath,
      country_iso2: cc,
      admin1_state_province: state,
      count: orgs.length,
      sha256: shardSha256,
    });
  }

  // Compute global Merkle root across all sorted shard SHA-256 digests
  const merkleHasher = crypto.createHash('sha256');
  for (const entry of shardManifestEntries) {
    merkleHasher.update(`${entry.shard}:${entry.sha256}\n`);
  }
  const merkleRoot = merkleHasher.digest('hex');

  const manifestPayload = {
    schema_version: '3.0.0',
    generated_at_utc: new Date().toISOString(),
    total_verified_orgs: masterMap.size,
    total_shards: shardManifestEntries.length,
    summary_metrics: summaryMetrics,
    shards: shardManifestEntries,
  };

  const manifestPath = path.join(orgsRoot, 'manifest.json');
  const tmpManifest = `${manifestPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpManifest, JSON.stringify(manifestPayload, null, 2), 'utf8');
  fs.renameSync(tmpManifest, manifestPath);

  // Write compact, backward-compatible top-tier index for generate-feeds.js and shelf promotion
  const prioritizedOrgs = [...masterMap.values()]
    .sort((a, b) => {
      if (a.audit_verified !== b.audit_verified) return a.audit_verified ? -1 : 1;
      if ((b.audit_signals?.length || 0) !== (a.audit_signals?.length || 0)) {
        return (b.audit_signals?.length || 0) - (a.audit_signals?.length || 0);
      }
      return a.registry_id.localeCompare(b.registry_id);
    })
    .slice(0, shelfLimit);

  const indexPayload = {
    schema_version: '3.0.0',
    sharded: true,
    manifest_path: 'docs/data/orgs/manifest.json',
    merkle_root_sha256: merkleRoot,
    generated_at_utc: manifestPayload.generated_at_utc,
    cost_policy: 'ZERO_COST_KEYLESS_PUBLIC_REGISTRIES_ONLY',
    total_verified_orgs: masterMap.size,
    total_shards: shardManifestEntries.length,
    summary_metrics: summaryMetrics,
    organizations: prioritizedOrgs,
  };

  const tmpIndex = `${legacyIndexFile}.tmp.${process.pid}`;
  fs.writeFileSync(tmpIndex, JSON.stringify(indexPayload, null, 2), 'utf8');
  fs.renameSync(tmpIndex, legacyIndexFile);

  return { merkleRoot, totalShards: shardManifestEntries.length };
}