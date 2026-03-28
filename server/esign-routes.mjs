import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { buildEsignRowFromSubmission, pickCustomerSubmitter } from './docuseal-esign-state.mjs';

const DOCUSEAL_CUSTOMER_ROLE = 'Customer';

function env(name, fallback = '') {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s)
  );
}

function timingSafeEqualString(secret, headerVal) {
  try {
    const a = Buffer.from(String(secret), 'utf8');
    const b = Buffer.from(String(headerVal ?? ''), 'utf8');
    if (a.length !== b.length) return false;
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

function createServiceSupabase() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for e-sign routes.');
  }
  return createClient(url, key);
}

function docusealBase() {
  return env('DOCUSEAL_BASE_URL', 'https://api.docuseal.com').replace(/\/$/, '');
}

function docusealHeaders() {
  const key = env('DOCUSEAL_API_KEY');
  if (!key) throw new Error('DOCUSEAL_API_KEY is not set.');
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

function publicEsignPayload(row) {
  return {
    esign_submission_id: row.esign_submission_id,
    esign_submitter_id: row.esign_submitter_id,
    esign_embed_src: row.esign_embed_src,
    esign_status: row.esign_status,
    esign_submission_state: row.esign_submission_state,
    esign_submitter_state: row.esign_submitter_state,
    esign_sent_at: row.esign_sent_at,
    esign_opened_at: row.esign_opened_at,
    esign_completed_at: row.esign_completed_at,
    esign_declined_at: row.esign_declined_at,
    esign_decline_reason: row.esign_decline_reason,
    esign_signed_document_url: row.esign_signed_document_url,
  };
}

async function resolveJobIdForWebhook(supabase, webhookData, verifiedSubmission) {
  const d = webhookData || {};
  const ext =
    d.external_id ||
    pickCustomerSubmitter(verifiedSubmission)?.external_id ||
    d.submitters?.[0]?.external_id;
  if (ext && isUuid(ext)) {
    return String(ext);
  }
  const sid = verifiedSubmission?.id ?? d.submission?.id;
  if (sid == null) return null;
  const { data: row } = await supabase
    .from('jobs')
    .select('id')
    .eq('esign_submission_id', String(sid))
    .maybeSingle();
  return row?.id ?? null;
}

function matchEsignPath(method, pathname) {
  if (method === 'POST' && pathname === '/api/webhooks/docuseal') {
    return { kind: 'webhook' };
  }
  const m = pathname.match(/^\/api\/esign\/work-orders\/([0-9a-fA-F-]{36})\/(send|resend)$/);
  if (method === 'POST' && m) {
    return { kind: 'esign', jobId: m[1], action: m[2] };
  }
  return null;
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

  const supabase = createServiceSupabase();
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
    sendJson(res, 500, { error: jobErr.message });
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
  if (!Array.isArray(documents) || documents.length === 0 || typeof documents[0]?.html !== 'string') {
    sendJson(res, 400, { error: 'Body must include documents: [{ html, name?, html_header?, html_footer? }].' });
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
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    sendJson(res, status, { error: e instanceof Error ? e.message : 'DocuSeal request failed.' });
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
    sendJson(res, 500, { error: upErr?.message || 'Failed to update work order after DocuSeal send.' });
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

  const supabase = createServiceSupabase();
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
    sendJson(res, 500, { error: jobErr.message });
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

  try {
    await docusealFetchJson(`/submitters/${submitterId}`, {
      method: 'PUT',
      body: JSON.stringify(putBody),
    });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    sendJson(res, status, { error: e instanceof Error ? e.message : 'DocuSeal resend failed.' });
    return;
  }

  let submission = null;
  if (job.esign_submission_id) {
    try {
      submission = await docusealFetchJson(`/submissions/${job.esign_submission_id}`, {
        method: 'GET',
      });
    } catch {
      submission = null;
    }
  }

  if (submission) {
    const patch = buildEsignRowFromSubmission(submission);
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

  sendJson(res, 200, {
    jobId,
    ...publicEsignPayload(job),
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
  if (!timingSafeEqualString(headerSecret, received)) {
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

  let submissionId = data.submission?.id ?? null;
  if (submissionId == null && typeof eventType === 'string' && eventType.startsWith('submission.')) {
    submissionId = data.id ?? null;
  }

  if (submissionId == null) {
    sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  let verified;
  try {
    verified = await docusealFetchJson(`/submissions/${submissionId}`, { method: 'GET' });
  } catch (e) {
    console.error('DocuSeal verify submission failed:', e);
    sendJson(res, 502, { error: 'Could not verify submission with DocuSeal.' });
    return;
  }

  const supabase = createServiceSupabase();
  const jobId = await resolveJobIdForWebhook(supabase, data, verified);
  if (!jobId) {
    sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) {
    sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  if (job.esign_submission_id && String(verified.id) !== String(job.esign_submission_id)) {
    sendJson(res, 200, { ok: true, ignored: true, reason: 'stale_submission' });
    return;
  }

  const patch = buildEsignRowFromSubmission(verified);
  if (!patch) {
    sendJson(res, 200, { ok: true });
    return;
  }

  const { error: upErr } = await supabase.from('jobs').update(patch).eq('id', jobId);
  if (upErr) {
    console.error('Webhook job update failed:', upErr);
    sendJson(res, 500, { error: 'Database update failed.' });
    return;
  }

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
    if (route.kind === 'webhook') {
      await handleWebhook(req, res, readJsonBody, sendJson, sendText);
      return true;
    }
    if (route.kind === 'esign' && route.action === 'send') {
      await handleSend(req, res, readJsonBody, sendJson, sendText, route.jobId);
      return true;
    }
    if (route.kind === 'esign' && route.action === 'resend') {
      await handleResend(req, res, readJsonBody, sendJson, sendText, route.jobId);
      return true;
    }
  } catch (e) {
    console.error('E-sign route error:', e);
    sendJson(res, 500, { error: e instanceof Error ? e.message : 'Server error' });
    return true;
  }

  return false;
}
