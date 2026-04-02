import { createOrReuseInvoicePaymentLink } from './lib/stripe.mjs';
import { esc } from './lib/html-escape.mjs';
import { log } from './lib/logger.mjs';
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
  const safePaymentUrl = esc(paymentUrl);

  return `
    <p>Hi ${safeCustomerName},</p>
    <p>Please find attached Invoice #${invoiceNumber} from ${safeBusinessName}.</p>
    <p><strong>Amount due:</strong> $${Number(invoice.total).toFixed(2)}</p>
    <p><strong>Due date:</strong> ${dueDate}</p>
    <p>You can pay securely online using the link below:</p>
    <p><a href="${safePaymentUrl}">Pay Invoice #${invoiceNumber}</a></p>
    <p>If you have any questions, please reply to this email.</p>
    <p>Thank you for your business!</p>
    <p>— ${safeOwnerName}</p>
  `;
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
async function renderInvoicePdf({ invoice, html, profile }) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Wrap HTML with CSS document structure
    const fullHtml = buildPdfHtml(html);
    
    await page.setViewport({ width: 816, height: 1056 });
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 20_000 });
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
    const headerTemplate = `
      <div style="font-size:10px;width:100%;text-align:center;">
        <span style="white-space:nowrap;">Invoice #${invoiceNumber}</span>
      </div>
    `;
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

  // POST /api/invoices/:invoiceId/send
  if (req.method === 'POST' && /^\/api\/invoices\/[\w-]+\/send$/.test(req.url)) {
    try {
      return await handleInvoiceSend(req, res, { readJsonBody, sendJson, sendText });
    } catch (err) {
      log.error('Invoice send error', log.errCtx(err));
      const msg = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: msg });
      return true;
    }
  }

  return false;
}

async function handleInvoiceSend(req, res, { readJsonBody, sendJson, sendText }) {
  // 1. Authenticate
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

  // 2. Extract invoice ID from URL
  const match = req.url.match(/\/invoices\/([0-9a-f-]+)\/send/);
  const invoiceId = match?.[1];
  if (!invoiceId) {
    sendJson(res, 400, { error: 'Invalid invoice ID' });
    return true;
  }

  // 3. Load invoice
  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (invoiceErr) {
    sendJson(res, 500, { error: invoiceErr.message });
    return true;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found' });
    return true;
  }

  // 4. Load job for customer email
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('customer_email, customer_name')
    .eq('id', invoice.job_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    sendJson(res, 500, { error: jobErr.message });
    return true;
  }
  if (!job) {
    sendJson(res, 404, { error: 'Job not found' });
    return true;
  }

  // 5. Load profile
  const { data: profile, error: profileErr } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr) {
    sendJson(res, 500, { error: profileErr.message });
    return true;
  }
  if (!profile) {
    sendJson(res, 404, { error: 'Profile not found' });
    return true;
  }

  // 6. Validate customer email
  const customerEmail = job.customer_email?.trim();
  if (!customerEmail) {
    sendJson(res, 400, { error: 'Customer email is required. Add it to the work order first.' });
    return true;
  }

  // 7. Check Resend config
  const resendApiKey = env('RESEND_API_KEY');
  const resendFromEmail = env('RESEND_FROM_EMAIL');
  if (!resendApiKey || !resendFromEmail) {
    sendJson(res, 503, { error: 'Email delivery is temporarily unavailable.' });
    return true;
  }

  // 8. Check Stripe config
  const stripeSecretKey = env('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    sendJson(res, 503, { error: 'Stripe is not configured.' });
    return true;
  }

  // 9. Check Stripe account ready
  if (!profile.stripe_account_id) {
    sendJson(res, 409, {
      error: 'Stripe payouts are not set up yet. Start Connect onboarding first.',
    });
    return true;
  }

  // 10. Create or reuse payment link
  let paymentUrl, paymentLinkId;
  try {
    const result = await createOrReuseInvoicePaymentLink({
      invoice,
      userId,
      supabase,
      stripeAccountId: profile.stripe_account_id,
    });
    paymentUrl = result.url;
    paymentLinkId = result.payment_link_id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not create payment link';
    if (msg.includes('not signed')) {
      sendJson(res, 409, { error: msg });
      return true;
    }
    if (msg.includes('greater than zero')) {
      sendJson(res, 400, { error: msg });
      return true;
    }
    sendJson(res, msg.includes('not configured') ? 503 : 502, { error: msg });
    return true;
  }

  if (!paymentUrl) {
    sendJson(res, 502, { error: 'Could not create payment link.' });
    return true;
  }

  // 11. Read HTML from request body and generate PDF
  const body = await readJsonBody(req);
  const html = body?.html;
  if (typeof html !== 'string' || !html.trim()) {
    sendJson(res, 400, { error: 'Missing HTML payload' });
    return true;
  }

  let pdfBuffer;
  try {
    pdfBuffer = await renderInvoicePdf({ invoice, html, profile });
  } catch (err) {
    log.error('Invoice PDF generation failed', log.errCtx(err));
    sendJson(res, 500, { error: 'Could not generate invoice PDF.' });
    return true;
  }

  // 12. Send email via Resend
  const resendPayload = {
    from: resendFromEmail,
    to: customerEmail,
    subject: `Invoice #${String(invoice.invoice_number).padStart(4, '0')} from ${profile.business_name}`,
    html: buildInvoiceEmailBody({
      invoice,
      job,
      profile,
      paymentUrl,
    }),
    reply_to: profile.email || undefined,
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

  // 13. Set issued_at on first send
  const updatePayload = {
    stripe_payment_link_id: paymentLinkId,
    stripe_payment_url: paymentUrl,
  };

  if (!invoice.issued_at) {
    updatePayload.issued_at = new Date().toISOString();
  }

  const { data: updatedInvoice, error: updateErr } = await supabase
    .from('invoices')
    .update(updatePayload)
    .eq('id', invoice.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (updateErr) {
    log.error('Failed to update invoice after send', log.errCtx(updateErr));
    // Email was sent, so return success but log the DB error
  }

  sendJson(res, 200, { invoice: updatedInvoice || invoice });
  return true;
}