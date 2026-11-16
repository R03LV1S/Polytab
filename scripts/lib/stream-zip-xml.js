/**
 * scripts/lib/stream-zip-xml.js
 * Zero-dependency streaming PKZIP (Local File Header + RFC 1951 raw DEFLATE)
 * and streaming XML/TSV/Pipe-delimited parser for government open-data archives.
 */

import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable, Transform, PassThrough } from 'node:stream';

const PKZIP_LOCAL_HEADER_SIG = 0x04034b50;

/**
 * Streams a remote URL and returns a decompressed Node.js Readable stream
 * for the first file entry inside a PKZIP archive using O(1) memory.
 * Enforces both compressed and decompressed byte ceilings to block Zip Bombs.
 *
 * @param {Response} fetchResponse - Native fetch Response object
 * @param {object} options
 * @param {number} [options.maxDecompressedBytes=1200000000] - 1.2 GB ceiling
 * @returns {Promise<{ entryName: string, stream: Readable }>}
 */
export async function createZipFirstEntryStream(fetchResponse, options = {}) {
  const maxDecompressedBytes = options.maxDecompressedBytes || 1_200 * 1024 * 1024;
  const sourceStream = Readable.fromWeb(fetchResponse.body);

  return new Promise((resolve, reject) => {
    let headerBuffer = Buffer.alloc(0);
    let headerParsed = false;
    let payloadStream = null;

    const cleanup = (err) => {
      sourceStream.destroy();
      if (payloadStream) payloadStream.destroy(err);
      reject(err);
    };

    sourceStream.on('error', cleanup);

    sourceStream.on('data', (chunk) => {
      if (headerParsed) {
        if (!payloadStream.write(chunk)) {
          sourceStream.pause();
        }
        return;
      }

      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      if (headerBuffer.length < 30) return; // Wait for minimum 30-byte Local File Header

      const signature = headerBuffer.readUInt32LE(0);
      if (signature !== PKZIP_LOCAL_HEADER_SIG) {
        return cleanup(new Error(`Invalid PKZIP Local File Header signature: 0x${signature.toString(16)}`));
      }

      const compressionMethod = headerBuffer.readUInt16LE(8);
      const fileNameLength = headerBuffer.readUInt16LE(26);
      const extraFieldLength = headerBuffer.readUInt16LE(28);
      const totalHeaderSize = 30 + fileNameLength + extraFieldLength;

      if (headerBuffer.length < totalHeaderSize) return; // Wait for full filename + extra field

      const entryName = headerBuffer.subarray(30, 30 + fileNameLength).toString('utf8');
      const remainingPayload = headerBuffer.subarray(totalHeaderSize);
      headerBuffer = null; // Free header buffer immediately
      headerParsed = true;

      let decompressedBytes = 0;
      const byteGuard = new Transform({
        transform(data, _enc, cb) {
          decompressedBytes += data.length;
          if (decompressedBytes > maxDecompressedBytes) {
            cb(new Error(`Zip bomb protection triggered: decompressed stream exceeded ${maxDecompressedBytes} bytes`));
            sourceStream.destroy();
            return;
          }
          cb(null, data);
        },
      });

      if (compressionMethod === 8) {
        // Method 8 = Deflate (RFC 1951). InflateRaw automatically stops at BFINAL=1 block end.
        const inflater = zlib.createInflateRaw();
        payloadStream = new PassThrough();

        payloadStream.on('drain', () => sourceStream.resume());
        inflater.on('error', (err) => {
          // Ignore trailing data descriptor bytes after BFINAL=1 if already ended
          if (!byteGuard.writableEnded) byteGuard.destroy(err);
        });
        inflater.on('end', () => {
          sourceStream.destroy(); // Stop reading trailing central directory once entry 1 finishes
        });

        payloadStream.pipe(inflater).pipe(byteGuard);
      } else if (compressionMethod === 0) {
        // Method 0 = Stored (uncompressed)
        payloadStream = new PassThrough();
        payloadStream.on('drain', () => sourceStream.resume());
        payloadStream.pipe(byteGuard);
      } else {
        return cleanup(new Error(`Unsupported PKZIP compression method: ${compressionMethod}`));
      }

      if (remainingPayload.length > 0) {
        payloadStream.write(remainingPayload);
      }

      resolve({ entryName, stream: byteGuard });
    });

    sourceStream.on('end', () => {
      if (!headerParsed) {
        reject(new Error('Stream ended before PKZIP header could be parsed'));
      } else if (payloadStream) {
        payloadStream.end();
      }
    });
  });
}

/**
 * Streams line-by-line over a Readable stream (supporting UTF-8 or ISO-8859-1/latin1).
 * Strips UTF-8 BOM (\uFEFF) on the first line automatically.
 *
 * @param {Readable} readable
 * @param {'utf8'|'latin1'} [encoding='utf8']
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* streamLines(readable, encoding = 'utf8') {
  readable.setEncoding(encoding);
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let isFirst = true;
  for await (let line of rl) {
    if (isFirst) {
      isFirst = false;
      if (line.charCodeAt(0) === 0xfeff) {
        line = line.slice(1);
      }
    }
    if (line.length > 0) {
      yield line;
    }
  }
}

/**
 * Lightweight, bounded-memory streaming XML element extractor.
 * Designed for flat repeating records like Dutch Belastingdienst ANBI (`<beschikking>...</beschikking>`).
 * Decodes ISO-8859-1 (`latin1`) or `utf8` streams without building a full DOM tree.
 *
 * @param {Readable} readable
 * @param {string} recordTag - Repeating XML tag name (e.g., 'beschikking')
 * @param {'latin1'|'utf8'} [encoding='latin1']
 * @returns {AsyncGenerator<Record<string, string>, void, unknown>}
 */
export async function* streamXmlRecords(readable, recordTag, encoding = 'latin1') {
  readable.setEncoding(encoding);
  const openTag = `<${recordTag}`;
  const closeTag = `</${recordTag}>`;
  const childTagRegex = /<([a-zA-Z0-9_:-]+)>([^<]*)<\/\1>/g;

  let buffer = '';
  const maxBufferLength = 2 * 1024 * 1024; // 2MB safety cap on a single unclosed XML block

  for await (const chunk of readable) {
    buffer += chunk;
    if (buffer.length > maxBufferLength) {
      throw new Error(`XML stream buffer exceeded ${maxBufferLength} bytes without closing </${recordTag}>`);
    }

    let startIdx = buffer.indexOf(openTag);
    while (startIdx !== -1) {
      const endIdx = buffer.indexOf(closeTag, startIdx);
      if (endIdx === -1) break; // Wait for next chunk to complete the element

      const block = buffer.slice(startIdx, endIdx + closeTag.length);
      buffer = buffer.slice(endIdx + closeTag.length);

      const fields = {};
      let match;
      childTagRegex.lastIndex = 0;
      while ((match = childTagRegex.exec(block)) !== null) {
        const key = match[1];
        const val = decodeXmlEntities(match[2].trim());
        fields[key] = val;
      }

      yield fields;
      startIdx = buffer.indexOf(openTag);
    }

    // Trim leading whitespace/header outside an open record tag
    if (startIdx === -1 && buffer.length > openTag.length * 2) {
      buffer = buffer.slice(-openTag.length * 2);
    }
  }
}

function decodeXmlEntities(str) {
  if (!str || !str.includes('&')) return str;
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&apos;/g, "'");
}