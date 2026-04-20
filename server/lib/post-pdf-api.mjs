import { verifyBearerUser } from './auth.mjs';
import { readJsonBody } from './body.mjs';
import { MAX_JSON_BODY_PDF } from './body-limits.mjs';
import { checkRateLimit, getClientIp } from './rate-limit.mjs';
import { isPayloadTooLarge } from './payload-error.mjs';

const COMMON_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * POST /api/pdf: rate limit → Bearer auth → bounded JSON body → PDF handler.
 * Auth runs before buffering the full body.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {(res: import('node:http').ServerResponse, body: unknown) => Promise<boolean>} handlePdfRequest
 */
export async function runPostPdfApi(req, res, handlePdfRequest) {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`pdf:${clientIp}`, 10, 60 * 1000)) {
    sendJson(res, 429, { error: 'Too many requests.' });
    return;
  }
  const auth = await verifyBearerUser(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req, { maxBytes: MAX_JSON_BODY_PDF });
  } catch (e) {
    if (isPayloadTooLarge(e)) {
      sendJson(res, 413, { error: 'Request body too large.' });
      return;
    }
    throw e;
  }
  await handlePdfRequest(res, body);
}
