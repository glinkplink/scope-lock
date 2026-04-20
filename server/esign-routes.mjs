import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { buildEsignRowFromSubmission, pickCustomerSubmitter, DOCUSEAL_CUSTOMER_ROLE } from './docuseal-esign-state.mjs';
import { log } from './lib/logger.mjs';
import { isPayloadTooLarge } from './lib/payload-error.mjs';

/** Max UTF-8 bytes for all HTML fields forwarded to DocuSeal on send (abuse / accident guard). */
const ESIGN_MAX_HTML_BYTES = 2 * 1024 * 1024;

const SEND_DOCUMENTS_ERROR =
  'Body must include exactly one document: [{ html, name?, html_header?, html_footer? }].';

function env(name, fallback = '') {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

function esignConfigError(message) {
  const err = new Error(message);
  err.code = 'ESIGN_CONFIG';
  return err;
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s)
  );
}

/** Compare webhook shared secret to header using SHA-256 digests (fixed length; avoids length short-circuit). */
function timingSafeEqualString(secret, headerVal) {
  try {
    const a = crypto.createHash('sha256').update(Buffer.from(String(secret), 'utf8')).digest();
    const b = crypto.createHash('sha256').update(Buffer.from(String(headerVal ?? ''), 'utf8')).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getBearerToken(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t || null;
}

function getWebhookHeader(req, configuredName) {
  if (!configuredName) return '';
  const lower = configuredName.toLowerCase();
  return req.headers[lower] ?? req.headers[configuredName] ?? '';
}

let serviceSupabaseSingleton = null;

/** Clears memoized service client (Vitest only — keeps per-test createClient mocks working). */
export function resetEsignServiceSupabaseSingleton() {
  serviceSupabaseSingleton = null;
}

function getServiceSupabase() {
  if (serviceSupabaseSingleton) return serviceSupabaseSingleton;
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw esignConfigError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for e-sign routes.');
  }
  serviceSupabaseSingleton = createClient(url, key);
  return serviceSupabaseSingleton;
}

function docusealBase() {
  return env('DOCUSEAL_BASE_URL', 'https://api.docuseal.com').replace(/\/$/, '');
}

/**
 * Last-two-labels suffix so app.docuseal.com matches api.docuseal.com.
 * Not a full PSL eTLD+1 (e.g. co.uk); looser than exact host — any sibling subdomain
 * of the API host's suffix passes. Fine for DocuSeal cloud; self-hosted on busy domains may want a tighter list.
 */
function registrableDomainSuffix(hostname) {
  const parts = hostname.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function docusealHeaders() {
  const key = env('DOCUSEAL_API_KEY');
  if (!key) throw esignConfigError('DOCUSEAL_API_KEY is not set.');
  return {
    'Content-Type': 'application/json',
    'X-Auth-Token': key,
  };
}

async function docusealFetchJson(path, init = {}) {
  const url = `${docusealBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...docusealHeaders(), ...init.headers },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && json.error
        ? String(json.error)
        : text || res.statusText;
    const err = new Error(`DocuSeal ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** @returns {string|null} error message or null if valid */
function validateSendDocuments(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return SEND_DOCUMENTS_ERROR;
  }
  if (documents.length !== 1) {
    return SEND_DOCUMENTS_ERROR;
  }
  for (const doc of documents) {
    if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
      return SEND_DOCUMENTS_ERROR;
    }
    if (typeof doc.html !== 'string') {
      return SEND_DOCUMENTS_ERROR;
    }
    if (doc.html_header != null && typeof doc.html_header !== 'string') {
      return SEND_DOCUMENTS_ERROR;
    }
    if (doc.html_footer != null && typeof doc.html_footer !== 'string') {
      return SEND_DOCUMENTS_ERROR;
    }
  }
  return null;
}

function countEsignHtmlUtf8Bytes(documents) {
  let n = 0;
  for (const doc of documents) {
    n += Buffer.byteLength(doc.html, 'utf8');
    if (typeof doc.html_header === 'string') {
      n += Buffer.byteLength(doc.html_header, 'utf8');
    }
    if (typeof doc.html_footer === 'string') {
      n += Buffer.byteLength(doc.html_footer, 'utf8');
    }
  }
  return n;
}

function publicEsignPayload(row) {
  return {
    esign_submission_id: row.esign_submission_id,
    esign_submitter_id: row.esign_submitter_id,
    esign_embed_src: row.esign_embed_src,
    esign_status: row.esign_status,
    esign_submission_state: row.esign_submission_state,
    esign_submitter_state: row.esign_submitter_state,
    esign_sent_at: row.esign_sent_at,
    esign_resent_at: row.esign_resent_at,
    esign_opened_at: row.esign_opened_at,
    esign_completed_at: row.esign_completed_at,
    esign_declined_at: row.esign_declined_at,
    esign_decline_reason: row.esign_decline_reason,
    esign_signed_document_url: row.esign_signed_document_url,
  };
}

function isFormWebhookEvent(eventType) {
  return typeof eventType === 'string' && eventType.startsWith('form.');
}

function isSubmissionWebhookEvent(eventType) {
  return typeof eventType === 'string' && eventType.startsWith('submission.');
}

async function findJobForWebhook(supabase, column, value) {
  if (value == null) return null;
  const matchValue = String(value).trim();
  if (!matchValue) return null;
  const { data: row } = await supabase
    .from('jobs')
    .select('*')
    .eq(column, matchValue)
    .maybeSingle();
  return row || null;
}

async function resolveJobForFormWebhook(supabase, webhookData) {
  const d = webhookData || {};
  const payloadExternalId = d.external_id;
  if (payloadExternalId && isUuid(payloadExternalId)) {
    const row = await findJobForWebhook(supabase, 'id', payloadExternalId);
    if (row) {
      return { job: row, resolvedBy: 'external_id' };
    }
  }

  const submitterId = d.id ?? null;
  if (submitterId != null) {
    const row = await findJobForWebhook(supabase, 'esign_submitter_id', submitterId);
    if (row) {
      return { job: row, resolvedBy: 'submitter_id' };
    }
  }

  const payloadSubmissionId = d.submission?.id ?? null;
  if (payloadSubmissionId != null) {
    const row = await findJobForWebhook(supabase, 'esign_submission_id', payloadSubmissionId);
    if (row) {
      return { job: row, resolvedBy: 'submission_id' };
    }
  }

  return null;
}

async function resolveJobForVerifiedSubmissionWebhook(supabase, webhookData, verifiedSubmission) {
  const d = webhookData || {};
  const verifiedSubmissionId = verifiedSubmission?.id;
  if (verifiedSubmissionId != null) {
    const row = await findJobForWebhook(supabase, 'esign_submission_id', verifiedSubmissionId);
    if (row) {
      return { job: row, resolvedBy: 'submission_id' };
    }
  }

  const verifiedExternalId = pickCustomerSubmitter(verifiedSubmission)?.external_id;
  if (verifiedExternalId && isUuid(verifiedExternalId)) {
    const row = await findJobForWebhook(supabase, 'id', verifiedExternalId);
    if (row) {
      return { job: row, resolvedBy: 'verified_external_id' };
    }
  }

  const payloadExternalId = d.external_id || d.submitters?.[0]?.external_id;
  if (payloadExternalId && isUuid(payloadExternalId)) {
    const row = await findJobForWebhook(supabase, 'id', payloadExternalId);
    if (row) {
      return { job: row, resolvedBy: 'payload_external_id' };
    }
  }

  return null;
}

/** Find a change order by a specific column value. */
async function findChangeOrderForWebhook(supabase, column, value) {
  if (value == null) return null;
  const matchValue = String(value).trim();
  if (!matchValue) return null;
  const { data: row } = await supabase
    .from('change_orders')
    .select('*')
    .eq(column, matchValue)
    .maybeSingle();
  return row || null;
}

/** Resolve a change order from webhook payload (form.* events). */
async function resolveChangeOrderForFormWebhook(supabase, webhookData) {
  const d = webhookData || {};
  const payloadExternalId = d.external_id;
  if (payloadExternalId && isUuid(payloadExternalId)) {
    const row = await findChangeOrderForWebhook(supabase, 'id', payloadExternalId);
    if (row) {
      return { co: row, resolvedBy: 'external_id' };
    }
  }

  const submitterId = d.id ?? null;
  if (submitterId != null) {
    const row = await findChangeOrderForWebhook(supabase, 'esign_submitter_id', submitterId);
    if (row) {
      return { co: row, resolvedBy: 'submitter_id' };
    }
  }

  const payloadSubmissionId = d.submission?.id ?? null;
  if (payloadSubmissionId != null) {
    const row = await findChangeOrderForWebhook(supabase, 'esign_submission_id', payloadSubmissionId);
    if (row) {
      return { co: row, resolvedBy: 'submission_id' };
    }
  }

  return null;
}

/** Resolve a change order after DocuSeal submission verification. */
async function resolveChangeOrderForVerifiedSubmissionWebhook(supabase, webhookData, verifiedSubmission) {
  const d = webhookData || {};
  const verifiedSubmissionId = verifiedSubmission?.id;
  if (verifiedSubmissionId != null) {
    const row = await findChangeOrderForWebhook(supabase, 'esign_submission_id', verifiedSubmissionId);
    if (row) {
      return { co: row, resolvedBy: 'submission_id' };
    }
  }

  const verifiedExternalId = pickCustomerSubmitter(verifiedSubmission)?.external_id;
  if (verifiedExternalId && isUuid(verifiedExternalId)) {
    const row = await findChangeOrderForWebhook(supabase, 'id', verifiedExternalId);
    if (row) {
      return { co: row, resolvedBy: 'verified_external_id' };
    }
  }

  const payloadExternalId = d.external_id || d.submitters?.[0]?.external_id;
  if (payloadExternalId && isUuid(payloadExternalId)) {
    const row = await findChangeOrderForWebhook(supabase, 'id', payloadExternalId);
    if (row) {
      return { co: row, resolvedBy: 'payload_external_id' };
    }
  }

  return null;
}

async function verifySubmissionForFormWebhook(job, webhookData) {
  const d = webhookData || {};
  const payloadSubmissionId = d.submission?.id ?? null;

  if (payloadSubmissionId != null) {
    const verified = await docusealFetchJson(`/submissions/${payloadSubmissionId}`, {
      method: 'GET',
    });
    return {
      verified,
      verifiedBy: 'payload_submission_id',
      sourceSubmissionId: String(payloadSubmissionId),
      payloadSubmissionId: String(payloadSubmissionId),
    };
  }

  if (job?.esign_submission_id) {
    const verified = await docusealFetchJson(`/submissions/${job.esign_submission_id}`, {
      method: 'GET',
    });
    return {
      verified,
      verifiedBy: 'job_submission_id',
      sourceSubmissionId: String(job.esign_submission_id),
      payloadSubmissionId: null,
    };
  }

  const submitterId = d.id ?? null;
  if (submitterId == null) {
    return null;
  }

  const submitter = await docusealFetchJson(`/submitters/${submitterId}`, { method: 'GET' });
  const recoveredSubmissionId = submitter?.submission_id ?? submitter?.submission?.id ?? null;
  if (recoveredSubmissionId == null) {
    return {
      verified: null,
      verifiedBy: 'submitter_lookup_missing_submission',
      sourceSubmissionId: null,
      payloadSubmissionId: null,
    };
  }

  const verified = await docusealFetchJson(`/submissions/${recoveredSubmissionId}`, {
    method: 'GET',
  });
  return {
    verified,
    verifiedBy: 'submitter_lookup',
    sourceSubmissionId: String(recoveredSubmissionId),
    payloadSubmissionId: null,
  };
}

function matchEsignPath(method, pathname) {
  if (method === 'POST' && pathname === '/api/webhooks/docuseal') {
    return { kind: 'webhook' };
  }
  if (method === 'GET' && pathname === '/api/esign/documents/download') {
    return { kind: 'doc-download' };
  }
  const woMatch = pathname.match(/^\/api\/esign\/work-orders\/([0-9a-fA-F-]{36})\/(send|resend)$/);
  if (method === 'POST' && woMatch) {
    return { kind: 'esign', jobId: woMatch[1], action: woMatch[2] };
  }
  const woStatusMatch = pathname.match(/^\/api\/esign\/work-orders\/([0-9a-fA-F-]{36})\/status$/);
  if (method === 'GET' && woStatusMatch) {
    return { kind: 'esign-status', jobId: woStatusMatch[1] };
  }
  const coStatusMatch = pathname.match(/^\/api\/esign\/change-orders\/([0-9a-fA-F-]{36})\/status$/);
  if (method === 'GET' && coStatusMatch) {
    return { kind: 'co-esign-status', coId: coStatusMatch[1] };
  }
  const coMatch = pathname.match(/^\/api\/esign\/change-orders\/([0-9a-fA-F-]{36})\/(send|resend)$/);
  if (method === 'POST' && coMatch) {
    return { kind: 'co-esign', coId: coMatch[1], action: coMatch[2] };
  }
  return null;
}

async function handleDocumentDownload(req, res, sendJson) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');
  const docUrl = url.searchParams.get('url');
  if (!docUrl || typeof docUrl !== 'string') {
    sendJson(res, 400, { error: 'Missing url parameter.' });
    return;
  }

  // Validate the URL belongs to the configured DocuSeal host to prevent SSRF
  let parsedDocUrl;
  try {
    parsedDocUrl = new URL(docUrl);
  } catch {
    sendJson(res, 400, { error: 'Invalid url parameter.' });
    return;
  }
  const baseHostname = new URL(docusealBase()).hostname;
  const docSuffix = registrableDomainSuffix(parsedDocUrl.hostname);
  const baseSuffix = registrableDomainSuffix(baseHostname);
  if (parsedDocUrl.protocol !== 'https:' || docSuffix !== baseSuffix) {
    sendJson(res, 403, { error: 'URL not permitted.' });
    return;
  }

  const apiKey = env('DOCUSEAL_API_KEY');
  if (!apiKey) {
    sendJson(res, 503, { error: 'E-sign is temporarily unavailable.' });
    return;
  }

  const upstream = await fetch(docUrl, { headers: { 'X-Auth-Token': apiKey } });
  if (!upstream.ok) {
    sendJson(res, upstream.status, { error: `DocuSeal returned ${upstream.status}.` });
    return;
  }

  const contentType = upstream.headers.get('content-type') || 'application/pdf';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': 'attachment; filename="signed-document.pdf"',
    'Cache-Control': 'private, no-store',
  });
  // Stream the body directly
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

async function handleSend(req, res, readJsonBody, sendJson, sendText, jobId) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }
  const userId = userData.user.id;

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    log.error('esign job query error', log.errCtx(jobErr));
    sendJson(res, 500, { error: 'Could not load work order.' });
    return;
  }
  if (!job) {
    sendJson(res, 404, { error: 'Work order not found.' });
    return;
  }

  const email = (job.customer_email || '').trim();
  if (!email) {
    sendJson(res, 400, { error: 'Customer email is required to send for signature.' });
    return;
  }

  const documents = body.documents;
  const docErr = validateSendDocuments(documents);
  if (docErr) {
    sendJson(res, 400, { error: docErr });
    return;
  }

  const htmlBytes = countEsignHtmlUtf8Bytes(documents);
  if (htmlBytes > ESIGN_MAX_HTML_BYTES) {
    sendJson(res, 413, {
      error: `Document HTML exceeds maximum size (${ESIGN_MAX_HTML_BYTES} bytes).`,
    });
    return;
  }

  const payload = {
    name: body.name || `Work Order #${String(job.wo_number ?? '').padStart(4, '0')}`,
    send_email: body.send_email !== false,
    documents,
    submitters: [
      {
        role: DOCUSEAL_CUSTOMER_ROLE,
        email,
        external_id: jobId,
      },
    ],
  };
  if (body.message && typeof body.message === 'object') {
    payload.message = body.message;
  }
  if (body.order) payload.order = body.order;
  if (body.completed_redirect_url) payload.completed_redirect_url = body.completed_redirect_url;

  let submission;
  try {
    submission = await docusealFetchJson('/submissions/html', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (e) {
    log.error('docuseal submissions/html', log.errCtx(e));
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    sendJson(res, status, { error: 'DocuSeal request failed.' });
    return;
  }

  const patch = buildEsignRowFromSubmission(submission);
  if (!patch) {
    sendJson(res, 502, { error: 'DocuSeal response missing submitters.' });
    return;
  }

  const { data: updated, error: upErr } = await supabase
    .from('jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (upErr || !updated) {
    log.error('esign job patch after send', log.errCtx(upErr));
    sendJson(res, 500, { error: 'Failed to update work order after DocuSeal send.' });
    return;
  }

  sendJson(res, 200, { jobId, ...publicEsignPayload(updated) });
}

async function handleResend(req, res, readJsonBody, sendJson, jobId) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }
  const userId = userData.user.id;

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    log.error('esign job query error', log.errCtx(jobErr));
    sendJson(res, 500, { error: 'Could not load work order.' });
    return;
  }
  if (!job) {
    sendJson(res, 404, { error: 'Work order not found.' });
    return;
  }

  const submitterId = job.esign_submitter_id;
  if (!submitterId) {
    sendJson(res, 400, { error: 'No signature request to resend. Send first.' });
    return;
  }

  const putBody = { send_email: true };
  if (body.message && typeof body.message === 'object') {
    putBody.message = body.message;
  }

  let reconcileFromSubmission = false;
  try {
    await docusealFetchJson(`/submitters/${submitterId}`, {
      method: 'PUT',
      body: JSON.stringify(putBody),
    });
  } catch (e) {
    if (e?.status === 422 && job.esign_submission_id) {
      reconcileFromSubmission = true;
    } else {
      log.error('docuseal submitters put (resend)', log.errCtx(e));
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
      sendJson(res, status, { error: 'DocuSeal resend failed.' });
      return;
    }
  }

  // Fallback patch: if the optional submission refresh below fails, we still
  // know the resend happened, so write a consistent "sent" state rather than
  // returning the stale pre-resend row.
  const resendFallbackPatch = reconcileFromSubmission
    ? null
    : {
        esign_status: 'sent',
        esign_sent_at: new Date().toISOString(),
        esign_resent_at: new Date().toISOString(),
        esign_submission_state: 'sent',
        esign_submitter_state: 'sent',
        esign_opened_at: null,
        esign_completed_at: null,
        esign_declined_at: null,
        esign_decline_reason: null,
        esign_signed_document_url: null,
      };

  let submission = null;
  if (job.esign_submission_id) {
    try {
      submission = await docusealFetchJson(`/submissions/${job.esign_submission_id}`, {
        method: 'GET',
      });
    } catch (submissionErr) {
      if (reconcileFromSubmission) {
        const status =
          submissionErr?.status && submissionErr.status >= 400 && submissionErr.status < 600
            ? submissionErr.status
            : 502;
        log.error('docuseal submission refresh after resend', log.errCtx(submissionErr));
        sendJson(res, status, {
          error: 'DocuSeal refresh after resend failed.',
        });
        return;
      }
      submission = null;
    }
  }

  if (submission) {
    const patch = buildEsignRowFromSubmission(submission, true);
    if (patch) {
      const { data: updated, error: upErr } = await supabase
        .from('jobs')
        .update(patch)
        .eq('id', jobId)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (!upErr && updated) {
        sendJson(res, 200, { jobId, ...publicEsignPayload(updated) });
        return;
      }
    }
  }

  // Submission refresh failed or returned no usable patch — apply the
  // fallback so the UI reflects "sent" rather than stale pre-resend state.
  if (resendFallbackPatch) {
    const { data: fallbackUpdated, error: fbErr } = await supabase
      .from('jobs')
      .update(resendFallbackPatch)
      .eq('id', jobId)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (!fbErr && fallbackUpdated) {
      sendJson(res, 200, { jobId, ...publicEsignPayload(fallbackUpdated) });
      return;
    }
  }

  sendJson(res, 500, {
    error: 'Resend succeeded, but local state could not be refreshed. Reload to see current status.',
    jobId,
  });
}

async function handlePollStatus(req, res, sendJson, jobId) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }
  const userId = userData.user.id;

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    log.error('esign job query error', log.errCtx(jobErr));
    sendJson(res, 500, { error: 'Could not load work order.' });
    return;
  }
  if (!job) {
    sendJson(res, 404, { error: 'Work order not found.' });
    return;
  }

  // If there's no submission ID, nothing to poll - return current state
  if (!job.esign_submission_id) {
    sendJson(res, 200, { jobId, ...publicEsignPayload(job) });
    return;
  }

  // Fetch current state from DocuSeal
  let submission;
  try {
    submission = await docusealFetchJson(`/submissions/${job.esign_submission_id}`, {
      method: 'GET',
    });
  } catch (e) {
    log.error('docuseal submissions get (wo status)', log.errCtx(e));
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    sendJson(res, status, {
      error: 'Failed to fetch status from DocuSeal.',
    });
    return;
  }

  const patch = buildEsignRowFromSubmission(submission);
  if (!patch) {
    // Could not derive patch - return current state
    sendJson(res, 200, { jobId, ...publicEsignPayload(job) });
    return;
  }

  preserveDbEsignSentAtIfNewer(patch, job);

  // Update DB if state has changed
  const { data: updated, error: upErr } = await supabase
    .from('jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (upErr) {
    log.error('esign job status patch', log.errCtx(upErr));
    sendJson(res, 500, { error: 'Could not update work order.' });
    return;
  }

  sendJson(res, 200, { jobId, ...publicEsignPayload(updated) });
}

async function handleCoStatus(req, res, sendJson, coId) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }
  const userId = userData.user.id;

  const { data: co, error: coErr } = await supabase
    .from('change_orders')
    .select('*')
    .eq('id', coId)
    .eq('user_id', userId)
    .maybeSingle();

  if (coErr) {
    log.error('esign change order query error', log.errCtx(coErr));
    sendJson(res, 500, { error: 'Could not load change order.' });
    return;
  }
  if (!co) {
    sendJson(res, 404, { error: 'Change order not found.' });
    return;
  }

  // If there's no submission ID, nothing to poll - return current state
  if (!co.esign_submission_id) {
    sendJson(res, 200, { coId, jobId: co.job_id, ...publicCoEsignPayload(co) });
    return;
  }

  // Fetch current state from DocuSeal
  let submission;
  try {
    submission = await docusealFetchJson(`/submissions/${co.esign_submission_id}`, {
      method: 'GET',
    });
  } catch (e) {
    log.error('docuseal submissions get (co status)', log.errCtx(e));
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    sendJson(res, status, {
      error: 'Failed to fetch status from DocuSeal.',
    });
    return;
  }

  const patch = buildChangeOrderPatchFromSubmission(submission, co.status);
  if (!patch) {
    // Could not derive patch - return current state
    sendJson(res, 200, { coId, jobId: co.job_id, ...publicCoEsignPayload(co) });
    return;
  }

  preserveDbEsignSentAtIfNewer(patch, co);

  // Update DB if state has changed
  const { data: updated, error: upErr } = await supabase
    .from('change_orders')
    .update(patch)
    .eq('id', coId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (upErr) {
    log.error('esign change order status patch', log.errCtx(upErr));
    sendJson(res, 500, { error: 'Could not update change order.' });
    return;
  }

  sendJson(res, 200, { coId, jobId: co.job_id, ...publicCoEsignPayload(updated) });
}

function publicCoEsignPayload(row) {
  return {
    esign_submission_id: row.esign_submission_id,
    esign_submitter_id: row.esign_submitter_id,
    esign_embed_src: row.esign_embed_src,
    esign_status: row.esign_status,
    esign_submission_state: row.esign_submission_state,
    esign_submitter_state: row.esign_submitter_state,
    esign_sent_at: row.esign_sent_at,
    esign_resent_at: row.esign_resent_at,
    esign_opened_at: row.esign_opened_at,
    esign_completed_at: row.esign_completed_at,
    esign_declined_at: row.esign_declined_at,
    esign_decline_reason: row.esign_decline_reason,
    esign_signed_document_url: row.esign_signed_document_url,
  };
}

/** DocuSeal GET /submissions can lag behind a resend; keep the newer local `esign_sent_at`. */
function preserveDbEsignSentAtIfNewer(patch, row) {
  if (!patch || !row?.esign_sent_at || !patch.esign_sent_at) return;
  const dbT = Date.parse(row.esign_sent_at);
  const apiT = Date.parse(patch.esign_sent_at);
  if (Number.isNaN(dbT) || Number.isNaN(apiT)) return;
  if (dbT > apiT) {
    patch.esign_sent_at = row.esign_sent_at;
  }
}

function deriveChangeOrderStatusFromEsignStatus(currentStatus, esignStatus) {
  switch (esignStatus) {
    case 'sent':
    case 'opened':
      return 'pending_approval';
    case 'completed':
      return 'approved';
    case 'declined':
      return 'rejected';
    default:
      return currentStatus;
  }
}

function buildChangeOrderPatchFromSubmission(submission, currentStatus, isResend = false) {
  const patch = buildEsignRowFromSubmission(submission, isResend);
  if (!patch) return null;
  return {
    ...patch,
    status: deriveChangeOrderStatusFromEsignStatus(currentStatus, patch.esign_status),
  };
}

async function handleCoSend(req, res, readJsonBody, sendJson, sendText, coId) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }
  const userId = userData.user.id;

  const { data: co, error: coErr } = await supabase
    .from('change_orders')
    .select('*')
    .eq('id', coId)
    .eq('user_id', userId)
    .maybeSingle();

  if (coErr) {
    log.error('esign change order query error', log.errCtx(coErr));
    sendJson(res, 500, { error: 'Could not load change order.' });
    return;
  }
  if (!co) {
    sendJson(res, 404, { error: 'Change order not found.' });
    return;
  }

  // Fetch parent job to get customer email
  const { data: parentJob } = await supabase
    .from('jobs')
    .select('customer_email')
    .eq('id', co.job_id)
    .maybeSingle();

  const email = (parentJob?.customer_email || '').trim();
  if (!email) {
    sendJson(res, 400, { error: 'Customer email is required to send for signature.' });
    return;
  }

  const documents = body.documents;
  const docErr = validateSendDocuments(documents);
  if (docErr) {
    sendJson(res, 400, { error: docErr });
    return;
  }

  const htmlBytes = countEsignHtmlUtf8Bytes(documents);
  if (htmlBytes > ESIGN_MAX_HTML_BYTES) {
    sendJson(res, 413, {
      error: `Document HTML exceeds maximum size (${ESIGN_MAX_HTML_BYTES} bytes).`,
    });
    return;
  }

  const payload = {
    name: body.name || `Change Order #${String(co.co_number ?? '').padStart(4, '0')}`,
    send_email: body.send_email !== false,
    documents,
    submitters: [
      {
        role: DOCUSEAL_CUSTOMER_ROLE,
        email,
        external_id: coId,
      },
    ],
  };
  if (body.message && typeof body.message === 'object') {
    payload.message = body.message;
  }
  if (body.order) payload.order = body.order;
  if (body.completed_redirect_url) payload.completed_redirect_url = body.completed_redirect_url;

  let submission;
  try {
    submission = await docusealFetchJson('/submissions/html', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (e) {
    log.error('docuseal submissions/html (change order)', log.errCtx(e));
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    sendJson(res, status, { error: 'DocuSeal request failed.' });
    return;
  }

  const patch = buildChangeOrderPatchFromSubmission(submission, co.status);
  if (!patch) {
    sendJson(res, 502, { error: 'DocuSeal response missing submitters.' });
    return;
  }

  const { data: updated, error: upErr } = await supabase
    .from('change_orders')
    .update(patch)
    .eq('id', coId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (upErr || !updated) {
    log.error('esign change order patch after send', log.errCtx(upErr));
    sendJson(res, 500, { error: 'Failed to update change order after DocuSeal send.' });
    return;
  }

  const coJobId = co.job_id;
  sendJson(res, 200, { coId, jobId: coJobId, ...publicCoEsignPayload(updated) });
}

async function handleCoResend(req, res, readJsonBody, sendJson, coId) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return;
  }
  const userId = userData.user.id;

  const { data: co, error: coErr } = await supabase
    .from('change_orders')
    .select('*')
    .eq('id', coId)
    .eq('user_id', userId)
    .maybeSingle();

  if (coErr) {
    log.error('esign change order query error', log.errCtx(coErr));
    sendJson(res, 500, { error: 'Could not load change order.' });
    return;
  }
  if (!co) {
    sendJson(res, 404, { error: 'Change order not found.' });
    return;
  }

  const submitterId = co.esign_submitter_id;
  if (!submitterId) {
    sendJson(res, 400, { error: 'No signature request to resend. Send first.' });
    return;
  }

  const putBody = { send_email: true };
  if (body.message && typeof body.message === 'object') {
    putBody.message = body.message;
  }

  let reconcileFromSubmission = false;
  let coResendPutSucceeded = false;
  try {
    await docusealFetchJson(`/submitters/${submitterId}`, {
      method: 'PUT',
      body: JSON.stringify(putBody),
    });
    coResendPutSucceeded = true;
  } catch (e) {
    if ((e?.status === 404 || e?.status === 422) && co.esign_submission_id) {
      reconcileFromSubmission = true;
    } else {
      log.error('docuseal submitters put (co resend)', log.errCtx(e));
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
      sendJson(res, status, { error: 'DocuSeal resend failed.' });
      return;
    }
  }

  const resendFallbackPatch = reconcileFromSubmission
    ? null
    : {
        status: deriveChangeOrderStatusFromEsignStatus(co.status, 'sent'),
        esign_status: 'sent',
        esign_sent_at: new Date().toISOString(),
        esign_resent_at: new Date().toISOString(),
        esign_submission_state: 'sent',
        esign_submitter_state: 'sent',
        esign_opened_at: null,
        esign_completed_at: null,
        esign_declined_at: null,
        esign_decline_reason: null,
        esign_signed_document_url: null,
      };

  let submission = null;
  if (co.esign_submission_id) {
    try {
      submission = await docusealFetchJson(`/submissions/${co.esign_submission_id}`, {
        method: 'GET',
      });
    } catch (submissionErr) {
      if (reconcileFromSubmission) {
        const status =
          submissionErr?.status && submissionErr.status >= 400 && submissionErr.status < 600
            ? submissionErr.status
            : 502;
        log.error('docuseal submission refresh after resend', log.errCtx(submissionErr));
        sendJson(res, status, {
          error: 'DocuSeal refresh after resend failed.',
        });
        return;
      }
      submission = null;
    }
  }

  const coJobId = co.job_id;

  if (submission) {
    const patch = buildChangeOrderPatchFromSubmission(submission, co.status, true);
    if (patch) {
      // DocuSeal GET /submissions often keeps the same submitter.sent_at after a resend;
      // bump locally so the UI and list reflect that a new email went out.
      if (coResendPutSucceeded) {
        patch.esign_sent_at = new Date().toISOString();
      }
      const { data: updated, error: upErr } = await supabase
        .from('change_orders')
        .update(patch)
        .eq('id', coId)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (!upErr && updated) {
        sendJson(res, 200, { coId, jobId: coJobId, ...publicCoEsignPayload(updated) });
        return;
      }
    }
  }

  if (resendFallbackPatch) {
    const { data: fallbackUpdated, error: fbErr } = await supabase
      .from('change_orders')
      .update(resendFallbackPatch)
      .eq('id', coId)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (!fbErr && fallbackUpdated) {
      sendJson(res, 200, { coId, jobId: coJobId, ...publicCoEsignPayload(fallbackUpdated) });
      return;
    }
  }

  sendJson(res, 500, {
    error: 'Resend succeeded, but local state could not be refreshed. Reload to see current status.',
    coId,
  });
}

async function handleWebhook(req, res, readJsonBody, sendJson, sendText) {
  const headerName = env('DOCUSEAL_WEBHOOK_HEADER_NAME');
  const headerSecret = env('DOCUSEAL_WEBHOOK_HEADER_VALUE');
  if (!headerName || !headerSecret) {
    sendJson(res, 503, { error: 'Webhook verification is not configured.' });
    return;
  }

  const received = getWebhookHeader(req, headerName);
  log.info('webhook request arrived', {
    headerName,
    hasHeader: Boolean(received),
  });
  if (!timingSafeEqualString(headerSecret, received)) {
    log.info('[webhook] header rejected', {
      headerName,
      hasHeader: Boolean(received),
    });
    sendText(res, 401, 'Unauthorized');
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    sendText(res, 400, 'Invalid JSON');
    return;
  }

  const eventType = payload.event_type || '';
  const data = payload.data || {};
  const formEvent = isFormWebhookEvent(eventType);
  const submissionEvent = isSubmissionWebhookEvent(eventType);

  let submissionId = data.submission?.id ?? null;
  if (submissionId == null && submissionEvent) {
    submissionId = data.id ?? null;
  }

  const submitterId = formEvent ? (data.id ?? null) : null;
  const payloadExternalId = data.external_id ?? null;

  log.info('[webhook] received', {
    eventType,
    eventFamily: formEvent ? 'form' : submissionEvent ? 'submission' : 'other',
    submissionId: submissionId != null ? String(submissionId) : null,
    submitterId: submitterId != null ? String(submitterId) : null,
    externalId: payloadExternalId != null ? String(payloadExternalId) : null,
  });

  const supabase = getServiceSupabase();
  let resolved = null;
  let verifiedInfo = null;

  if (formEvent) {
    resolved = await resolveJobForFormWebhook(supabase, data);
    if (!resolved) {
      // Try CO resolution as fallback
      const coResolved = await resolveChangeOrderForFormWebhook(supabase, data);
      if (coResolved) {
        // Verify submission for CO
        try {
          verifiedInfo = await verifySubmissionForFormWebhook({ esign_submission_id: coResolved.co.esign_submission_id }, data);
        } catch (e) {
          log.error('DocuSeal verify submission failed for CO', log.errCtx(e));
          sendJson(res, 502, { error: 'Could not verify submission with DocuSeal.' });
          return;
        }
        if (!verifiedInfo || !verifiedInfo.verified) {
          log.info('[webhook] ignored: could not determine submission to verify (change order)', {
            coId: String(coResolved.co.id),
            submitterId: submitterId != null ? String(submitterId) : null,
          });
          sendJson(res, 200, { ok: true, ignored: true });
          return;
        }
        await handleChangeOrderWebhookUpdate(
          supabase,
          coResolved.co,
          verifiedInfo,
          coResolved.resolvedBy,
          sendJson,
          res
        );
        return;
      }
      log.info('[webhook] ignored: missing correlation', {
        eventType,
        submissionId: submissionId != null ? String(submissionId) : null,
        submitterId: submitterId != null ? String(submitterId) : null,
        externalId: payloadExternalId != null ? String(payloadExternalId) : null,
      });
      sendJson(res, 200, { ok: true, ignored: true });
      return;
    }

    log.info('[webhook] resolved job', {
      eventType,
      submissionId: submissionId != null ? String(submissionId) : null,
      submitterId: submitterId != null ? String(submitterId) : null,
      jobId: String(resolved.job.id),
      resolvedBy: resolved.resolvedBy,
      currentSubmissionId: resolved.job.esign_submission_id ?? null,
      currentStatus: resolved.job.esign_status ?? null,
    });

    try {
      verifiedInfo = await verifySubmissionForFormWebhook(resolved.job, data);
    } catch (e) {
      log.error('DocuSeal verify submission failed', log.errCtx(e));
      sendJson(res, 502, { error: 'Could not verify submission with DocuSeal.' });
      return;
    }

    if (!verifiedInfo || !verifiedInfo.verified) {
      log.info('[webhook] ignored: could not determine submission to verify', {
        eventType,
        jobId: String(resolved.job.id),
        submitterId: submitterId != null ? String(submitterId) : null,
      });
      sendJson(res, 200, { ok: true, ignored: true });
      return;
    }
  } else {
    if (submissionId == null) {
      log.info('[webhook] ignored: missing correlation', { eventType });
      sendJson(res, 200, { ok: true, ignored: true });
      return;
    }

    try {
      const verified = await docusealFetchJson(`/submissions/${submissionId}`, { method: 'GET' });
      verifiedInfo = {
        verified,
        verifiedBy: 'payload_submission_id',
        sourceSubmissionId: String(submissionId),
        payloadSubmissionId: String(submissionId),
      };
    } catch (e) {
      log.error('DocuSeal verify submission failed', log.errCtx(e));
      sendJson(res, 502, { error: 'Could not verify submission with DocuSeal.' });
      return;
    }

    resolved = await resolveJobForVerifiedSubmissionWebhook(supabase, data, verifiedInfo.verified);
    if (!resolved) {
      // Try CO resolution as fallback
      const coResolved = await resolveChangeOrderForVerifiedSubmissionWebhook(supabase, data, verifiedInfo.verified);
      if (coResolved) {
        await handleChangeOrderWebhookUpdate(
          supabase,
          coResolved.co,
          verifiedInfo,
          coResolved.resolvedBy,
          sendJson,
          res
        );
        return;
      }
      log.info('[webhook] ignored: no matching job', {
        submissionId: String(verifiedInfo.verified.id),
        eventType,
      });
      sendJson(res, 200, { ok: true, ignored: true });
      return;
    }
  }

  const verified = verifiedInfo.verified;
  log.info('[webhook] verified submission', {
    submissionId: String(verified.id),
    submissionStatus: verified.status ?? null,
    submitterStatus: pickCustomerSubmitter(verified)?.status ?? null,
    verifiedBy: verifiedInfo.verifiedBy,
    verifiedSourceSubmissionId: verifiedInfo.sourceSubmissionId,
  });

  if (!formEvent) {
    log.info('[webhook] resolved job', {
      submissionId: String(verified.id),
      jobId: String(resolved.job.id),
      resolvedBy: resolved.resolvedBy,
      currentSubmissionId: resolved.job.esign_submission_id ?? null,
      currentStatus: resolved.job.esign_status ?? null,
    });
  }

  if (
    verifiedInfo.payloadSubmissionId &&
    String(verified.id) !== String(verifiedInfo.payloadSubmissionId)
  ) {
    log.info('[webhook] ignored: stale submission', {
      submissionId: String(verified.id),
      payloadSubmissionId: String(verifiedInfo.payloadSubmissionId),
      jobId: String(resolved.job.id),
      resolvedBy: resolved.resolvedBy,
    });
    sendJson(res, 200, { ok: true, ignored: true, reason: 'stale_submission' });
    return;
  }

  if (
    formEvent &&
    resolved.resolvedBy !== 'submission_id' &&
    resolved.job.esign_submission_id &&
    String(verified.id) !== String(resolved.job.esign_submission_id)
  ) {
    const rerouted = await resolveJobForVerifiedSubmissionWebhook(supabase, data, verified);
    if (rerouted && String(rerouted.job.id) !== String(resolved.job.id)) {
      log.info('[webhook] rerouted job after verification', {
        submissionId: String(verified.id),
        fromJobId: String(resolved.job.id),
        toJobId: String(rerouted.job.id),
        fromResolvedBy: resolved.resolvedBy,
        toResolvedBy: rerouted.resolvedBy,
      });
      resolved = rerouted;
    }
  }

  const { job, resolvedBy } = resolved;

  // When resolved by submission_id, the row is already anchored to the verified
  // submission id. External-id fallbacks need an explicit stale check before we
  // let the verified DocuSeal state overwrite the job row.
  if (
    resolvedBy !== 'submission_id' &&
    job.esign_submission_id &&
    String(verified.id) !== String(job.esign_submission_id)
  ) {
    log.info('[webhook] ignored: stale submission', {
      submissionId: String(verified.id),
      jobId: String(job.id),
      jobSubmissionId: String(job.esign_submission_id),
      resolvedBy,
    });
    sendJson(res, 200, { ok: true, ignored: true, reason: 'stale_submission' });
    return;
  }

  const patch = buildEsignRowFromSubmission(verified);
  if (!patch) {
    log.info('[webhook] ignored: could not derive esign patch', {
      submissionId: String(verified.id),
      jobId: String(job.id),
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  log.info('[webhook] derived patch', {
    submissionId: String(verified.id),
    jobId: String(job.id),
    esign_status: patch.esign_status,
    esign_submission_state: patch.esign_submission_state,
    esign_submitter_state: patch.esign_submitter_state,
  });

  const { error: upErr } = await supabase.from('jobs').update(patch).eq('id', job.id).eq('user_id', job.user_id);
  if (upErr) {
    log.error('Webhook job update failed', log.errCtx(upErr));
    log.info('[webhook] update failed', {
      submissionId: String(verified.id),
      jobId: String(job.id),
      esign_status: patch.esign_status,
    });
    sendJson(res, 500, { error: 'Database update failed.' });
    return;
  }

  log.info('[webhook] update applied', {
    submissionId: String(verified.id),
    jobId: String(job.id),
    esign_status: patch.esign_status,
  });

  sendJson(res, 200, { ok: true });
}

/** Handle webhook update for a change order (simplified form-webhook path). */
async function handleChangeOrderWebhookUpdate(supabase, co, verifiedInfo, resolvedBy, sendJson, res) {
  if (!verifiedInfo || !verifiedInfo.verified) {
    log.info('[webhook] CO ignored: could not verify submission');
    sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  const verified = verifiedInfo.verified;
  if (
    verifiedInfo.payloadSubmissionId &&
    String(verified.id) !== String(verifiedInfo.payloadSubmissionId)
  ) {
    log.info('[webhook] CO ignored: stale submission', {
      submissionId: String(verified.id),
      payloadSubmissionId: String(verifiedInfo.payloadSubmissionId),
      coId: String(co.id),
      resolvedBy,
    });
    sendJson(res, 200, { ok: true, ignored: true, reason: 'stale_submission' });
    return;
  }

  if (
    resolvedBy !== 'submission_id' &&
    co.esign_submission_id &&
    String(verified.id) !== String(co.esign_submission_id)
  ) {
    log.info('[webhook] CO ignored: stale submission', {
      submissionId: String(verified.id),
      coId: String(co.id),
      coSubmissionId: String(co.esign_submission_id),
      resolvedBy,
    });
    sendJson(res, 200, { ok: true, ignored: true, reason: 'stale_submission' });
    return;
  }

  const patch = buildChangeOrderPatchFromSubmission(verified, co.status);
  if (!patch) {
    log.info('[webhook] CO ignored: no patch from submission');
    sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  log.info('[webhook] CO derived patch', {
    coId: co.id,
    esign_status: patch.esign_status,
    esign_submission_state: patch.esign_submission_state,
  });

  const { error: upErr } = await supabase
    .from('change_orders')
    .update(patch)
    .eq('id', co.id)
    .eq('user_id', co.user_id);

  if (upErr) {
    log.error('Webhook CO update failed', log.errCtx(upErr));
    log.info('[webhook] CO update failed', {
      coId: co.id,
      esign_status: patch.esign_status,
    });
    sendJson(res, 500, { error: 'Database update failed.' });
    return;
  }

  log.info('[webhook] CO update applied', {
    coId: co.id,
    esign_status: patch.esign_status,
  });

  sendJson(res, 200, { ok: true });
}

/**
 * @returns {boolean} true if this request was handled (caller should not fall through)
 */
export async function tryHandleEsignRoute(req, res, helpers) {
  const { readJsonBody, sendJson, sendText } = helpers;
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/webhooks/docuseal') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  const route = matchEsignPath(method, pathname);
  if (!route) return false;

  try {
    if (route.kind === 'doc-download') {
      await handleDocumentDownload(req, res, sendJson);
      return true;
    }
    if (route.kind === 'webhook') {
      await handleWebhook(req, res, readJsonBody, sendJson, sendText);
      return true;
    }
    if (route.kind === 'esign' && route.action === 'send') {
      await handleSend(req, res, readJsonBody, sendJson, sendText, route.jobId);
      return true;
    }
    if (route.kind === 'esign' && route.action === 'resend') {
      await handleResend(req, res, readJsonBody, sendJson, route.jobId);
      return true;
    }
    if (route.kind === 'esign-status') {
      await handlePollStatus(req, res, sendJson, route.jobId);
      return true;
    }
    if (route.kind === 'co-esign-status') {
      await handleCoStatus(req, res, sendJson, route.coId);
      return true;
    }
    if (route.kind === 'co-esign' && route.action === 'send') {
      await handleCoSend(req, res, readJsonBody, sendJson, sendText, route.coId);
      return true;
    }
    if (route.kind === 'co-esign' && route.action === 'resend') {
      await handleCoResend(req, res, readJsonBody, sendJson, route.coId);
      return true;
    }
  } catch (e) {
    if (isPayloadTooLarge(e)) {
      sendJson(res, 413, { error: 'Request body too large.' });
      return true;
    }
    log.error('E-sign route error', log.errCtx(e));
    const code = e && typeof e === 'object' && 'code' in e ? e.code : undefined;
    if (code === 'ESIGN_CONFIG') {
      sendJson(res, 503, { error: 'E-sign is temporarily unavailable.' });
      return true;
    }
    sendJson(res, 500, { error: 'E-sign route failed.' });
    return true;
  }

  return false;
}
