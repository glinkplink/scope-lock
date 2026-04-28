import {
  assertStripeInvoicePaymentsReady,
  createOrReuseInvoicePaymentLink,
} from './lib/stripe.mjs';
import { esc } from './lib/html-escape.mjs';
import { log } from './lib/logger.mjs';
import { preparePdfPageForRendering } from './lib/pdf-puppeteer.mjs';
import { isPayloadTooLarge } from './lib/payload-error.mjs';
import { buildHeaderTemplate } from './lib/pdf-templates.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load CSS for PDF wrapping
const appCss = readFileSync(path.join(__dirname, '../src/App.css'), 'utf-8');

function env(name) {
  const value = process.env[name];
  return value != null && String(value).trim() !== '' ? String(value).trim() : '';
}

function emailAddressCandidate(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const angleMatch = trimmed.match(/<([^<>]+)>$/);
  return (angleMatch?.[1] ?? trimmed).trim();
}

function isLikelyEmailAddress(value) {
  const candidate = emailAddressCandidate(value);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate);
}

function optionalEmailHeader(value) {
  if (!isLikelyEmailAddress(value)) return undefined;
  return String(value).trim();
}

/**
 * Wrap inner HTML with PDF document structure (CSS + markup shell).
 * Server-side equivalent of client-side buildPdfHtml().
 */
function buildPdfHtml(previewMarkup) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Dancing+Script:wght@400;700&display=swap"
      rel="stylesheet"
    />
    <style>
      ${appCss}
      :root {
        color-scheme: light;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      body {
        font-family: 'Barlow', 'DIN 2014', 'Bahnschrift', 'D-DIN', system-ui, sans-serif;
        letter-spacing: normal;
        word-spacing: normal;
        -webkit-font-smoothing: antialiased;
      }
      .pdf-render-root {
        padding: 0;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div class="pdf-render-root">
      ${previewMarkup}
    </div>
  </body>
</html>`;
}

/**
 * Build the HTML email body for an invoice.
 * Uses esc() to safely escape user-controlled values.
 */
function buildInvoiceEmailBody({ invoice, job, profile, paymentUrl }) {
  const invoiceNumber = String(invoice.invoice_number).padStart(4, '0');
  const dueDate = invoice.due_date
    ? new Date(invoice.due_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Due upon receipt';

  // Escape all user-controlled values before HTML interpolation
  const safeCustomerName = esc(job.customer_name || 'there');
  const safeBusinessName = esc(profile.business_name);
  const safeOwnerName = esc(profile.owner_name || profile.business_name);

  const payBlock =
    typeof paymentUrl === 'string' && paymentUrl.trim()
      ? `<p>You can pay securely online using the link below:</p>
    <p><a href="${esc(paymentUrl)}">Pay Invoice #${invoiceNumber}</a></p>`
      : `<p>Payment details are on the attached invoice.</p>`;

  return `
    <p>Hi ${safeCustomerName},</p>
    <p>Please find attached Invoice #${invoiceNumber} from ${safeBusinessName}.</p>
    <p><strong>Amount due:</strong> $${Number(invoice.total).toFixed(2)}</p>
    <p><strong>Due date:</strong> ${dueDate}</p>
    ${payBlock}
    <p>If you have any questions, please reply to this email.</p>
    <p>Thank you for your business!</p>
    <p>— ${safeOwnerName}</p>
  `;
}

function workOrderSignatureSatisfied(job) {
  return job.esign_status === 'completed' || job.offline_signed_at != null;
}

/**
 * Returns the count of change orders for a job that are neither e-signed nor
 * marked signed offline. Callers block invoice issuance when this is > 0.
 * Throws on query error so the caller can return a 500.
 */
export async function countPendingChangeOrders(supabase, jobId, userId) {
  const { data, error } = await supabase
    .from('change_orders')
    .select('esign_status, offline_signed_at')
    .eq('job_id', jobId)
    .eq('user_id', userId);

  if (error) throw error;
  const rows = data ?? [];
  return rows.filter(
    (co) => co.esign_status !== 'completed' && co.offline_signed_at == null
  ).length;
}

function getServiceSupabase() {
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseKey);
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function getRequestPath(req) {
  return String(req.url || '').split('?')[0] || '/';
}

function invoiceIdFromPath(req, action) {
  const pathOnly = getRequestPath(req);
  const match = pathOnly.match(new RegExp(`^/api/invoices/([^/]+)/${action}$`));
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

/**
 * Get the browser instance for PDF generation.
 * Reuses existing getBrowser from app-server.mjs
 */
async function getBrowser() {
  const { getBrowser: getBrowserFn } = await import('./app-server.mjs');
  return getBrowserFn();
}

/**
 * Render an invoice as a PDF buffer.
 * Wraps the HTML with CSS before generating PDF.
 */
async function renderInvoicePdf({ invoice, html, profile, job }) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Wrap HTML with CSS document structure
    const fullHtml = buildPdfHtml(html);

    await preparePdfPageForRendering(page);
    await page.setViewport({ width: 816, height: 1056 });
    await page.setContent(fullHtml, { waitUntil: 'load', timeout: 20_000 });
    await page.emulateMediaType('screen');

    await page.evaluate(async () => {
      if (!('fonts' in document) || !document.fonts) return;
      await document.fonts.ready;
      try {
        await document.fonts.load("400 20pt 'Dancing Script'");
      } catch { /* ignore */ }
      await document.fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 200));

    const invoiceNumber = String(invoice.invoice_number).padStart(4, '0');
    const woHeader = job?.wo_number != null && Number.isFinite(Number(job.wo_number))
      ? `WO #${String(Number(job.wo_number)).padStart(4, '0')}`
      : '';
    const headerTemplate = buildHeaderTemplate(`Invoice #${invoiceNumber}`, woHeader);
    const footerTemplate = `
      <div style="font-size:10px;width:100%;text-align:center;">
        <span style="white-space:nowrap;">${esc(profile.business_name)}</span>
        <span style="white-space:nowrap;"> | </span>
        <span style="white-space:nowrap;">${esc(profile.phone || '')}</span>
        <span style="white-space:nowrap;"> | Page <span class="pageNumber"></span></span>
      </div>
    `;

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '70px', right: '60px', bottom: '70px', left: '60px' },
      timeout: 30_000,
    });

    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function tryHandleInvoiceRoute(req, res, helpers) {
  const { readJsonBody, sendJson, sendText } = helpers;
  const pathOnly = getRequestPath(req);

  // POST /api/invoices/:invoiceId/send
  if (req.method === 'POST' && /^\/api\/invoices\/[^/]+\/send$/.test(pathOnly)) {
    try {
      return await handleInvoiceSend(req, res, { readJsonBody, sendJson });
    } catch (err) {
      if (isPayloadTooLarge(err)) {
        sendJson(res, 413, { error: 'Request body too large.' });
        return true;
      }
      log.error('Invoice send error', log.errCtx(err));
      sendJson(res, 500, { error: 'Could not send invoice.' });
      return true;
    }
  }

  // POST /api/invoices/:invoiceId/mark-issued
  if (req.method === 'POST' && /^\/api\/invoices\/[^/]+\/mark-issued$/.test(pathOnly)) {
    return await handleMarkIssued(req, res, { sendJson });
  }

  // POST /api/invoices/:invoiceId/mark-paid-offline
  if (req.method === 'POST' && /^\/api\/invoices\/[^/]+\/mark-paid-offline$/.test(pathOnly)) {
    return await handleMarkPaidOffline(req, res, { sendJson });
  }

  // POST /api/invoices/:invoiceId/unmark-paid-offline
  if (req.method === 'POST' && /^\/api\/invoices\/[^/]+\/unmark-paid-offline$/.test(pathOnly)) {
    return await handleUnmarkPaidOffline(req, res, { sendJson });
  }

  return false;
}

async function handleInvoiceSend(req, res, { readJsonBody, sendJson }) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing authorization' });
    return true;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid session' });
    return true;
  }
  const userId = userData.user.id;

  const invoiceId = invoiceIdFromPath(req, 'send');
  if (!invoiceId) {
    sendJson(res, 400, { error: 'Invalid invoice ID' });
    return true;
  }

  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (invoiceErr) {
    log.error('invoice load error', log.errCtx(invoiceErr));
    sendJson(res, 500, { error: 'Could not load invoice.' });
    return true;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found' });
    return true;
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('customer_email, customer_name, esign_status, offline_signed_at, wo_number')
    .eq('id', invoice.job_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    log.error('invoice send job load error', log.errCtx(jobErr));
    sendJson(res, 500, { error: 'Could not load work order.' });
    return true;
  }
  if (!job) {
    sendJson(res, 404, { error: 'Job not found' });
    return true;
  }

  const { data: profile, error: profileErr } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr) {
    log.error('invoice send profile load error', log.errCtx(profileErr));
    sendJson(res, 500, { error: 'Could not load profile.' });
    return true;
  }
  if (!profile) {
    sendJson(res, 404, { error: 'Profile not found' });
    return true;
  }

  const customerEmail = job.customer_email?.trim();
  if (!customerEmail) {
    sendJson(res, 400, { error: 'Customer email is required. Add it to the work order first.' });
    return true;
  }
  if (!isLikelyEmailAddress(customerEmail)) {
    sendJson(res, 400, {
      error: 'Customer email must be a valid email address. Update the work order first.',
    });
    return true;
  }

  const body = await readJsonBody(req);
  const html = body?.html;
  const includePaymentLink = body?.include_payment_link === true;

  if (typeof html !== 'string' || !html.trim()) {
    sendJson(res, 400, { error: 'Missing HTML payload' });
    return true;
  }

  if (!workOrderSignatureSatisfied(job)) {
    sendJson(res, 409, {
      error:
        'Cannot send invoice: the work order must be signed via DocuSeal or marked as signed offline first.',
    });
    return true;
  }

  // Block first-time invoice issuance when any change orders on the job are unresolved.
  // Resends (issued_at already set) skip this — migration 0008 prevents new COs after issuance.
  if (!invoice.issued_at) {
    let pendingCOCount;
    try {
      pendingCOCount = await countPendingChangeOrders(supabase, invoice.job_id, userId);
    } catch (err) {
      log.error('invoice send pending-CO check failed', log.errCtx(err));
      sendJson(res, 500, { error: 'Could not verify change order status.' });
      return true;
    }
    if (pendingCOCount > 0) {
      sendJson(res, 409, {
        error: `Cannot send invoice: ${pendingCOCount} change order${pendingCOCount === 1 ? ' is' : 's are'} still pending. Sign, mark signed offline, or delete them first.`,
      });
      return true;
    }
  }

  const resendApiKey = env('RESEND_API_KEY');
  const resendFromEmail = env('RESEND_FROM_EMAIL');
  if (!resendApiKey || !resendFromEmail) {
    sendJson(res, 503, { error: 'Email delivery is temporarily unavailable.' });
    return true;
  }
  if (!isLikelyEmailAddress(resendFromEmail)) {
    sendJson(res, 503, { error: 'Email sender is not configured with a valid address.' });
    return true;
  }

  let paymentUrl = null;
  let paymentLinkId = null;

  if (includePaymentLink) {
    const stripeSecretKey = env('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      sendJson(res, 503, { error: 'Stripe is not configured.' });
      return true;
    }
    if (!profile.stripe_account_id) {
      sendJson(res, 409, {
        error: 'Stripe payouts are not set up yet. Start Connect onboarding first.',
      });
      return true;
    }

    const cap = await assertStripeInvoicePaymentsReady(profile.stripe_account_id);
    if (!cap.ok) {
      sendJson(res, cap.status, { error: cap.error });
      return true;
    }

    try {
      const result = await createOrReuseInvoicePaymentLink({
        invoice,
        userId,
        supabase,
        stripeAccountId: profile.stripe_account_id,
      });
      paymentUrl = result.url;
      paymentLinkId = result.payment_link_id ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('not signed')) {
        sendJson(res, 409, { error: msg });
        return true;
      }
      if (msg.includes('greater than zero')) {
        sendJson(res, 400, { error: msg });
        return true;
      }
      if (msg.includes('not configured')) {
        sendJson(res, 503, { error: 'Stripe is not configured.' });
        return true;
      }
      log.error('invoice send payment link error', log.errCtx(err));
      sendJson(res, 502, { error: 'Could not create payment link.' });
      return true;
    }

    if (!paymentUrl) {
      sendJson(res, 502, { error: 'Could not create payment link.' });
      return true;
    }
  }

  let pdfBuffer;
  try {
    pdfBuffer = await renderInvoicePdf({ invoice, html, profile, job });
  } catch (err) {
    log.error('Invoice PDF generation failed', log.errCtx(err));
    sendJson(res, 500, { error: 'Could not generate invoice PDF.' });
    return true;
  }

  const resendPayload = {
    from: resendFromEmail,
    to: customerEmail,
    subject: `Invoice #${String(invoice.invoice_number).padStart(4, '0')} from ${profile.business_name}`,
    html: buildInvoiceEmailBody({
      invoice,
      job,
      profile,
      paymentUrl: paymentUrl ?? undefined,
    }),
    reply_to: optionalEmailHeader(profile.email),
    attachments: [
      {
        filename: `Invoice-${String(invoice.invoice_number).padStart(4, '0')}.pdf`,
        content: pdfBuffer.toString('base64'),
      },
    ],
  };

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resendPayload),
  });

  if (!resendResponse.ok) {
    const errorData = await resendResponse.json().catch(() => ({}));
    log.error('Resend API error', { response: errorData });
    sendJson(res, 502, { error: 'Could not send invoice email.' });
    return true;
  }

  const patch = {};

  if (includePaymentLink && paymentUrl) {
    patch.stripe_payment_link_id = paymentLinkId;
    patch.stripe_payment_url = paymentUrl;
  }

  if (!invoice.issued_at) {
    patch.issued_at = new Date().toISOString();
  }

  if (Object.keys(patch).length > 0) {
    const { data: updatedInvoice, error: updateErr } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', invoice.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateErr) {
      log.error('Failed to update invoice after send', log.errCtx(updateErr));
    }

    const { data: fresh } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoice.id)
      .eq('user_id', userId)
      .maybeSingle();

    sendJson(res, 200, { invoice: fresh || updatedInvoice || invoice });
    return true;
  }

  const { data: freshOnly } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoice.id)
    .eq('user_id', userId)
    .maybeSingle();

  sendJson(res, 200, { invoice: freshOnly || invoice });
  return true;
}

async function handleMarkIssued(req, res, { sendJson }) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing authorization' });
    return true;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid session' });
    return true;
  }
  const userId = userData.user.id;

  const invoiceId = invoiceIdFromPath(req, 'mark-issued');
  if (!invoiceId) {
    sendJson(res, 400, { error: 'Invalid invoice ID' });
    return true;
  }

  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .select('id, user_id, issued_at, job_id')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (invoiceErr) {
    log.error('mark-issued load error', log.errCtx(invoiceErr));
    sendJson(res, 500, { error: 'Could not load invoice.' });
    return true;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found' });
    return true;
  }

  // Idempotent: already issued → return fresh row
  if (invoice.issued_at) {
    const { data: fresh } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .maybeSingle();
    sendJson(res, 200, { invoice: fresh || invoice });
    return true;
  }

  // Enforce same first-issuance gates as send (signature + CO check)
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('esign_status, offline_signed_at')
    .eq('id', invoice.job_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    log.error('mark-issued job load error', log.errCtx(jobErr));
    sendJson(res, 500, { error: 'Could not load work order.' });
    return true;
  }
  if (!job) {
    sendJson(res, 404, { error: 'Job not found' });
    return true;
  }

  if (!workOrderSignatureSatisfied(job)) {
    sendJson(res, 409, {
      error:
        'Cannot issue invoice: the work order must be signed via DocuSeal or marked as signed offline first.',
    });
    return true;
  }

  let pendingCOCount;
  try {
    pendingCOCount = await countPendingChangeOrders(supabase, invoice.job_id, userId);
  } catch (err) {
    log.error('mark-issued pending-CO check failed', log.errCtx(err));
    sendJson(res, 500, { error: 'Could not verify change order status.' });
    return true;
  }
  if (pendingCOCount > 0) {
    sendJson(res, 409, {
      error: `Cannot issue invoice: ${pendingCOCount} change order${pendingCOCount === 1 ? ' is' : 's are'} still pending. Sign, mark signed offline, or delete them first.`,
    });
    return true;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update({ issued_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (updateErr) {
    log.error('mark-issued update error', log.errCtx(updateErr));
    sendJson(res, 500, { error: 'Could not update invoice.' });
    return true;
  }

  log.info('marked invoice issued (download)', { invoiceId, userId });
  sendJson(res, 200, { invoice: updated });
  return true;
}

async function handleMarkPaidOffline(req, res, { sendJson }) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing authorization' });
    return true;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid session' });
    return true;
  }
  const userId = userData.user.id;

  const invoiceId = invoiceIdFromPath(req, 'mark-paid-offline');
  if (!invoiceId) {
    sendJson(res, 400, { error: 'Invalid invoice ID' });
    return true;
  }

  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .select('id, user_id, payment_status')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (invoiceErr) {
    log.error('mark-paid-offline load error', log.errCtx(invoiceErr));
    sendJson(res, 500, { error: 'Could not load invoice.' });
    return true;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found' });
    return true;
  }
  if (invoice.payment_status === 'paid' || invoice.payment_status === 'offline') {
    sendJson(res, 409, { error: 'Invoice is already marked as paid.' });
    return true;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update({ payment_status: 'offline', paid_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (updateErr) {
    log.error('mark-paid-offline update error', log.errCtx(updateErr));
    sendJson(res, 500, { error: 'Could not update invoice.' });
    return true;
  }

  log.info('marked invoice paid offline', { invoiceId, userId });
  sendJson(res, 200, { invoice: updated });
  return true;
}

async function handleUnmarkPaidOffline(req, res, { sendJson }) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing authorization' });
    return true;
  }

  const supabase = getServiceSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid session' });
    return true;
  }
  const userId = userData.user.id;

  const invoiceId = invoiceIdFromPath(req, 'unmark-paid-offline');
  if (!invoiceId) {
    sendJson(res, 400, { error: 'Invalid invoice ID' });
    return true;
  }

  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .select('id, user_id, payment_status')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (invoiceErr) {
    log.error('unmark-paid-offline load error', log.errCtx(invoiceErr));
    sendJson(res, 500, { error: 'Could not load invoice.' });
    return true;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found' });
    return true;
  }
  if (invoice.payment_status !== 'offline') {
    sendJson(res, 409, {
      error:
        invoice.payment_status === 'paid'
          ? 'Stripe-paid invoices cannot be marked unpaid here.'
          : 'Only offline-paid invoices can be marked unpaid.',
    });
    return true;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update({ payment_status: 'unpaid', paid_at: null })
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (updateErr) {
    log.error('unmark-paid-offline update error', log.errCtx(updateErr));
    sendJson(res, 500, { error: 'Could not update invoice.' });
    return true;
  }

  log.info('unmarked invoice paid offline', { invoiceId, userId });
  sendJson(res, 200, { invoice: updated });
  return true;
}
