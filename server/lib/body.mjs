import { PayloadTooLargeError } from './payload-error.mjs';

/**
 * Read request body with optional UTF-8 size cap.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<string>}
 */
export async function readRawBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const len = chunk.length;
    if (total + len > maxBytes) {
      for await (const _ of req) {
        /* drain */
      }
      throw new PayloadTooLargeError();
    }
    total += len;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes?: number }} [options]
 */
export async function readJsonBody(req, options = {}) {
  const raw = await readRawBody(req, options);
  if (!raw || !raw.trim()) return {};
  return JSON.parse(raw);
}
