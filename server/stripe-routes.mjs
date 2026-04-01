import {
  createAccountOnboardingLink,
  createConnectedAccount,
  createInvoicePaymentLink,
  constructWebhookEvent,
  getConnectedAccount,
} from './lib/stripe.mjs';
import { createClient } from '@supabase/supabase-js';

let serviceSupabaseSingleton = null;

export function resetStripeServiceSupabaseSingleton() {
  serviceSupabaseSingleton = null;
}

function getServiceSupabase({ errorCode = 'STRIPE_CONFIG', errorMessage } = {}) {
  if (serviceSupabaseSingleton) return serviceSupabaseSingleton;
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    const err = new Error(errorMessage || 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for Stripe routes.');
    err.code = errorCode;
    throw err;
  }
  serviceSupabaseSingleton = createClient(url, key);
  return serviceSupabaseSingleton;
}

function env(name, fallback = '') {
  const value = process.env[name];
  return value != null && String(value).trim() !== '' ? String(value).trim() : fallback;
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function isStripeConfigErrorMessage(message) {
  return typeof message === 'string' && /stripe not configured/i.test(message);
}

function getAppBaseUrl(req) {
  const configured = env('APP_BASE_URL');
  if (configured) return configured.replace(/\/$/, '');

  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = forwardedHost || req.headers.host || '127.0.0.1:3000';
  const proto =
    typeof forwardedProto === 'string' && forwardedProto.trim()
      ? forwardedProto.split(',')[0].trim()
      : String(host).includes('localhost') || String(host).includes('127.0.0.1')
        ? 'http'
        : 'https';

  return `${proto}://${host}`.replace(/\/$/, '');
}

function requestPath(req) {
  return String(req.url || '').split('?')[0] || '/';
}

function parseStripeRoute(req) {
  const path = requestPath(req);
  const method = req.method || '';

  if (method === 'POST' && path === '/api/stripe/connect/start') {
    return { kind: 'connect-start' };
  }

  if (method === 'GET' && path === '/api/stripe/connect/status') {
    return { kind: 'connect-status' };
  }

  if (method === 'POST' && path === '/api/stripe/webhook') {
    return { kind: 'webhook' };
  }

  const match = path.match(/^\/api\/stripe\/invoices\/([0-9a-fA-F-]{36})\/payment-link$/);
  if (method === 'POST' && match) {
    return { kind: 'payment-link', invoiceId: match[1] };
  }

  return null;
}

function stripeConfigError(message) {
  const err = new Error(message);
  err.code = 'STRIPE_CONFIG';
  return err;
}

function stripeConnectionStatus(profile, account = null) {
  const connected = Boolean(profile?.stripe_account_id);
  const onboardingComplete = Boolean(profile?.stripe_onboarding_complete);
  return {
    accountId: connected ? profile.stripe_account_id : null,
    onboardingComplete,
    status: !connected ? 'not_connected' : onboardingComplete ? 'connected' : 'incomplete',
    detailsSubmitted: Boolean(account?.details_submitted),
    chargesEnabled: Boolean(account?.charges_enabled),
    payoutsEnabled: Boolean(account?.payouts_enabled),
  };
}

function isStripeOnboardingComplete(account) {
  return Boolean(account?.details_submitted);
}

function paymentDateFromEvent(event) {
  const created = typeof event?.created === 'number' ? event.created : null;
  if (created == null) return new Date().toISOString();
  return new Date(created * 1000).toISOString();
}

async function authenticate(req, sendJson, res) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization bearer token.' });
    return null;
  }

  let supabase;
  try {
    supabase = getServiceSupabase({
      errorCode: 'STRIPE_CONFIG',
      errorMessage: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for Stripe routes.',
    });
  } catch (error) {
    sendJson(res, 503, { error: error instanceof Error ? error.message : 'Stripe is unavailable.' });
    return null;
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return null;
  }

  return {
    supabase,
    userId: userData.user.id,
  };
}

async function getProfileByUserId(supabase, userId, columns = '*') {
  return supabase.from('business_profiles').select(columns).eq('user_id', userId).maybeSingle();
}

async function reconcileStripeOnboardingStatus(supabase, profile) {
  if (!profile?.stripe_account_id) {
    return {
      profile,
      account: null,
      onboardingComplete: false,
    };
  }

  const { data: account, error } = await getConnectedAccount(profile.stripe_account_id);
  if (error || !account) {
    return { profile: null, account: null, onboardingComplete: false, error };
  }

  const onboardingComplete = isStripeOnboardingComplete(account);
  let nextProfile = profile;

  if (Boolean(profile.stripe_onboarding_complete) !== onboardingComplete) {
    const { data: updatedProfile, error: updateErr } = await supabase
      .from('business_profiles')
      .update({ stripe_onboarding_complete: onboardingComplete })
      .eq('user_id', profile.user_id)
      .select('*')
      .maybeSingle();

    if (updateErr) {
      return {
        profile: null,
        account,
        onboardingComplete,
        error: updateErr.message,
      };
    }

    nextProfile = updatedProfile ?? {
      ...profile,
      stripe_onboarding_complete: onboardingComplete,
    };
  }

  return {
    profile: nextProfile,
    account,
    onboardingComplete,
    error: null,
  };
}

async function handleConnectStart(req, res, sendJson) {
  const auth = await authenticate(req, sendJson, res);
  if (!auth) return;

  const { supabase, userId } = auth;
  const { data: profile, error: profileErr } = await getProfileByUserId(supabase, userId);

  if (profileErr) {
    sendJson(res, 500, { error: profileErr.message });
    return;
  }
  if (!profile) {
    sendJson(res, 404, { error: 'Business profile not found.' });
    return;
  }

  let stripeAccountId = profile.stripe_account_id ?? null;
  if (!stripeAccountId) {
    const { data, error } = await createConnectedAccount(profile.email ?? null);
    if (error || !data?.id) {
      sendJson(res, isStripeConfigErrorMessage(error) ? 503 : 502, {
        error: error || 'Could not create Stripe account.',
      });
      return;
    }
    stripeAccountId = data.id;

    const { error: updateErr } = await supabase
      .from('business_profiles')
      .update({
        stripe_account_id: stripeAccountId,
        stripe_onboarding_complete: false,
      })
      .eq('user_id', userId);

    if (updateErr) {
      sendJson(res, 500, { error: updateErr.message });
      return;
    }
  }

  const baseUrl = getAppBaseUrl(req);
  const returnUrl = `${baseUrl}/?stripe_connect=return`;
  const refreshUrl = `${baseUrl}/?stripe_connect=refresh`;
  const { data: linkData, error: linkErr } = await createAccountOnboardingLink(
    stripeAccountId,
    returnUrl,
    refreshUrl
  );

  if (linkErr || !linkData?.url) {
    sendJson(res, isStripeConfigErrorMessage(linkErr) ? 503 : 502, {
      error: linkErr || 'Could not create onboarding link.',
    });
    return;
  }

  sendJson(res, 200, {
    accountId: stripeAccountId,
    url: linkData.url,
  });
}

async function handleConnectStatus(req, res, sendJson) {
  const auth = await authenticate(req, sendJson, res);
  if (!auth) return;

  const { supabase, userId } = auth;
  const { data: profile, error: profileErr } = await getProfileByUserId(supabase, userId);

  if (profileErr) {
    sendJson(res, 500, { error: profileErr.message });
    return;
  }
  if (!profile) {
    sendJson(res, 404, { error: 'Business profile not found.' });
    return;
  }
  if (!profile.stripe_account_id) {
    sendJson(res, 200, stripeConnectionStatus(profile, null));
    return;
  }

  const { profile: reconciledProfile, account, error } = await reconcileStripeOnboardingStatus(
    supabase,
    profile
  );
  if (error || !reconciledProfile) {
    sendJson(res, isStripeConfigErrorMessage(error) ? 503 : 502, {
      error: error || 'Could not load Stripe account status.',
    });
    return;
  }

  sendJson(res, 200, stripeConnectionStatus(reconciledProfile, account));
}

async function handleInvoicePaymentLink(req, res, sendJson, invoiceId) {
  const auth = await authenticate(req, sendJson, res);
  if (!auth) return;

  const { supabase, userId } = auth;
  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (invoiceErr) {
    sendJson(res, 500, { error: invoiceErr.message });
    return;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found.' });
    return;
  }
  if (invoice.stripe_payment_url) {
    sendJson(res, 200, {
      url: invoice.stripe_payment_url,
      payment_link_id: invoice.stripe_payment_link_id ?? null,
    });
    return;
  }

  const { data: profile, error: profileErr } = await supabase
    .from('business_profiles')
    .select('stripe_account_id, stripe_onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr) {
    sendJson(res, 500, { error: profileErr.message });
    return;
  }
  if (!profile?.stripe_account_id) {
    sendJson(res, 409, {
      error: 'Stripe payouts are not set up yet. Start Connect onboarding first.',
    });
    return;
  }

  const totalCents = Math.round(Number(invoice.total) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    sendJson(res, 400, { error: 'Invoice total must be greater than zero.' });
    return;
  }

  const invoiceNumber = String(invoice.invoice_number ?? '').padStart(4, '0');
  const { data: linkData, error: linkErr } = await createInvoicePaymentLink({
    stripeAccountId: profile.stripe_account_id,
    invoiceId: invoice.id,
    jobId: invoice.job_id,
    userId,
    totalCents,
    title: `Invoice #${invoiceNumber}`,
    description: `ScopeLock invoice #${invoiceNumber}`,
  });

  if (linkErr || !linkData?.url) {
    sendJson(res, isStripeConfigErrorMessage(linkErr) ? 503 : 502, {
      error: linkErr || 'Could not create payment link.',
    });
    return;
  }

  const { error: updateErr } = await supabase
    .from('invoices')
    .update({
      stripe_payment_link_id: linkData.id,
      stripe_payment_url: linkData.url,
    })
    .eq('id', invoice.id)
    .eq('user_id', userId);

  if (updateErr) {
    sendJson(res, 500, { error: updateErr.message });
    return;
  }

  sendJson(res, 200, {
    url: linkData.url,
    payment_link_id: linkData.id,
  });
}

async function markInvoicePaidFromWebhook(supabase, invoiceId, paidAt) {
  // Idempotency check - skip if already paid
  const { data: existing } = await supabase
    .from('invoices')
    .select('payment_status')
    .eq('id', invoiceId)
    .maybeSingle();

  if (existing?.payment_status === 'paid') {
    console.log('[stripe webhook] invoice already paid, skipping update', { invoiceId });
    return existing;
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .update({
      payment_status: 'paid',
      paid_at: paidAt,
    })
    .eq('id', invoiceId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  return invoice;
}

async function handleWebhook(req, res, helpers) {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    helpers.sendJson(res, 503, { error: 'Stripe webhook secret is not configured.' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    helpers.sendJson(res, 400, { error: 'Missing Stripe signature header.' });
    return;
  }

  let payload;
  try {
    payload = await helpers.readRawBody(req);
  } catch {
    helpers.sendJson(res, 400, { error: 'Invalid webhook payload.' });
    return;
  }

  const { data: event, error: eventErr } = constructWebhookEvent(payload, signature, secret);
  if (eventErr || !event) {
    helpers.sendJson(res, 400, { error: eventErr || 'Could not verify Stripe webhook.' });
    return;
  }

  console.log('[stripe webhook] received', {
    eventId: event.id,
    eventType: event.type,
    invoiceId: event.data?.object?.metadata?.invoice_id ?? null,
  });

  let supabase;
  try {
    supabase = getServiceSupabase({
      errorCode: 'STRIPE_CONFIG',
      errorMessage: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for Stripe routes.',
    });
  } catch (error) {
    helpers.sendJson(res, 503, {
      error: error instanceof Error ? error.message : 'Stripe is unavailable.',
    });
    return;
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    console.log('[stripe webhook] async payment failed', {
      eventId: event.id,
      invoiceId: event.data?.object?.metadata?.invoice_id ?? null,
    });
    helpers.sendJson(res, 200, { ok: true });
    return;
  }

  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded'
  ) {
    console.log('[stripe webhook] ignoring unhandled event type', { eventId: event.id, eventType: event.type });
    helpers.sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  const session = event.data?.object;
  const invoiceId = session?.metadata?.invoice_id;
  if (typeof invoiceId !== 'string' || !invoiceId.trim()) {
    helpers.sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  if (event.type === 'checkout.session.completed' && session?.payment_status !== 'paid') {
    helpers.sendJson(res, 200, { ok: true, pending: true });
    return;
  }

  try {
    await markInvoicePaidFromWebhook(supabase, invoiceId, paymentDateFromEvent(event));
    console.log('[stripe webhook] marked invoice paid', { invoiceId, eventId: event.id, eventType: event.type });
  } catch (error) {
    helpers.sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Could not reconcile invoice payment.',
    });
    return;
  }

  helpers.sendJson(res, 200, { ok: true });
}

export async function tryHandleStripeRoute(req, res, helpers) {
  const route = parseStripeRoute(req);
  if (!route) return false;

  switch (route.kind) {
    case 'connect-start':
      await handleConnectStart(req, res, helpers.sendJson);
      return true;
    case 'connect-status':
      await handleConnectStatus(req, res, helpers.sendJson);
      return true;
    case 'payment-link':
      await handleInvoicePaymentLink(req, res, helpers.sendJson, route.invoiceId);
      return true;
    case 'webhook':
      await handleWebhook(req, res, helpers);
      return true;
    default:
      return false;
  }
}
