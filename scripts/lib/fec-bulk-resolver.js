/**
 * scripts/lib/fec-bulk-resolver.js
 * Keyless, $0, zero-rate-limit FEC Bulk Candidate Summary (weball) & Master (cn) Resolver.
 * Eliminates HTTP 429/DEMO_KEY $0 failures across all 35 races and opponents.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BULK_CYCLES = [2026, 2024, 2022, 2020, 2018, 2016];

/**
 * Extracts the first file from a PKZIP Buffer in memory using Central Directory offsets.
 */
function unzipFirstFileToText(zipBuffer) {
  // Locate End of Central Directory (0x06054b50)
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP archive: EOCD not found");

  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (zipBuffer.readUInt32LE(cdOffset) !== 0x02014b50) {
    throw new Error("Invalid ZIP Central Directory signature");
  }

  const compressionMethod = zipBuffer.readUInt16LE(cdOffset + 10);
  const compressedSize = zipBuffer.readUInt32LE(cdOffset + 20);
  const localHeaderOffset = zipBuffer.readUInt32LE(cdOffset + 42);

  const fileNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
  const extraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLen + extraLen;
  const compressedSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return compressedSlice.toString("utf8");
  if (compressionMethod === 8) return zlib.inflateRawSync(compressedSlice).toString("utf8");
  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

/**
 * Converts FEC bulk date MM/DD/YYYY to ISO YYYY-MM-DD.
 */
function normalizeFecDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Polytab-Bulk-FEC-Resolver/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Loads or builds the multi-cycle FEC bulk candidate index (cached for 24h in docs/data/cache/fec-bulk-index.json).
 */
async function loadFecBulkIndex(repoRoot = process.cwd(), targetCycle = 2026) {
  const cacheDir = path.join(repoRoot, "docs/data/cache");
  const indexPath = path.join(cacheDir, "fec-bulk-index.json");
  fs.mkdirSync(cacheDir, { recursive: true });

  if (fs.existsSync(indexPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const ageHours = (Date.now() - Date.parse(cached.generated_at_utc || 0)) / 3_600_000;
      if (ageHours < 24 && cached.candidates && Object.keys(cached.candidates).length > 500) {
        return cached;
      }
    } catch (_) {}
  }

  console.log("[FEC-Bulk] Building keyless multi-cycle FEC candidate summary & PCC index...");
  const candidates = {};
  let latestGlobalCoverageDate = `${targetCycle}-10-14`;

  // 1. Download & parse Candidate Master file (cn26.zip) for Principal Campaign Committee IDs (CAND_PCC)
  const yyTarget = String(targetCycle).slice(-2);
  try {
    const cnUrl = `https://www.fec.gov/files/bulk-downloads/${targetCycle}/cn${yyTarget}.zip`;
    const cnText = unzipFirstFileToText(await fetchBuffer(cnUrl));
    for (const line of cnText.split(/\r?\n/)) {
      if (!line) continue;
      const cols = line.split("|");
      const candId = (cols[0] || "").trim();
      const pcc = (cols[9] || "").trim();
      if (candId && pcc) {
        if (!candidates[candId]) candidates[candId] = { pcc: null, cycles: {} };
        candidates[candId].pcc = pcc;
      }
    }
    console.log(`[FEC-Bulk] Indexed Principal Committees from cn${yyTarget}.zip`);
  } catch (err) {
    console.warn(`[FEC-Bulk] cn${yyTarget}.zip warning: ${err.message}`);
  }

  // 2. Download & parse All-Candidates Summary files (weball26.zip .. weball16.zip)
  for (const cyc of BULK_CYCLES) {
    const yy = String(cyc).slice(-2);
    const url = `https://www.fec.gov/files/bulk-downloads/${cyc}/weball${yy}.zip`;
    try {
      const txt = unzipFirstFileToText(await fetchBuffer(url));
      let count = 0;
      for (const line of txt.split(/\r?\n/)) {
        if (!line) continue;
        const cols = line.split("|");
        if (cols.length < 28) continue;
        const candId = (cols[0] || "").trim();
        if (!candId) continue;

        const ttlReceipts = Number(cols[5] || 0);
        const transFromAuth = Number(cols[6] || 0);
        const indivRefunds = Number(cols[28] || 0);
        const cmteRefunds = Number(cols[29] || 0);
        const netContrib = Math.max(0, ttlReceipts - transFromAuth - indivRefunds - cmteRefunds);
        const cvgDate = normalizeFecDate(cols[27]);

        if (cyc === targetCycle && cvgDate && cvgDate > latestGlobalCoverageDate) {
          latestGlobalCoverageDate = cvgDate;
        }

        if (!candidates[candId]) candidates[candId] = { pcc: null, cycles: {} };
        candidates[candId].cycles[cyc] = {
          receipts: Math.round(ttlReceipts),
          net_contributions: Math.round(netContrib),
          coverage_end_date: cvgDate
        };
        count++;
      }
      console.log(`[FEC-Bulk] Indexed ${count} candidate financial summaries for cycle ${cyc} (weball${yy}.zip)`);
    } catch (err) {
      console.warn(`[FEC-Bulk] weball${yy}.zip unavailable: ${err.message}`);
    }
  }

  const payload = {
    generated_at_utc: new Date().toISOString(),
    target_cycle: targetCycle,
    latest_global_coverage_date: latestGlobalCoverageDate,
    candidates
  };

  fs.writeFileSync(`${indexPath}.tmp`, JSON.stringify(payload), "utf8");
  fs.renameSync(`${indexPath}.tmp`, indexPath);
  return payload;
}

module.exports = { loadFecBulkIndex };