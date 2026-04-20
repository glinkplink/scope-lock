import {
  assertStripeInvoicePaymentsReady,
  createAccountOnboardingLink,
  createConnectedAccount,
  createInvoicePaymentLink,
  constructWebhookEvent,
  createOrReuseInvoicePaymentLink,
  getConnectedAccount,
} from './lib/stripe.mjs';
import { log } from './lib/logger.mjs';
import { isPayloadTooLarge } from './lib/payload-error.mjs';
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
  // details_submitted can be true even when required fields are past_due and charges are disabled.
  // charges_enabled is the reliable signal that Stripe has actually verified the account.
  return Boolean(account?.charges_enabled);
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
    log.error('stripe authenticate config error', log.errCtx(error));
    sendJson(res, 503, { error: 'Stripe is unavailable.' });
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
    if (!isStripeConfigErrorMessage(error)) {
      log.error('reconcile getConnectedAccount', { message: error });
    }
    return {
      profile: null,
      account: null,
      onboardingComplete: false,
      error: isStripeConfigErrorMessage(error)
        ? error
        : 'Could not load Stripe account status.',
    };
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
      log.error('reconcile onboarding profile update', log.errCtx(updateErr));
      return {
        profile: null,
        account,
        onboardingComplete,
        error: 'Could not save onboarding status.',
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
    log.error('stripe connect start profile error', log.errCtx(profileErr));
    sendJson(res, 500, { error: 'Could not load profile.' });
    return;
  }
  if (!profile) {
    sendJson(res, 404, { error: 'Business profile not found.' });
    return;
  }

  let stripeAccountId = profile.stripe_account_id ?? null;
  if (stripeAccountId) {
    const { profile: reconciledProfile, error } = await reconcileStripeOnboardingStatus(
      supabase,
      profile
    );
    if (error || !reconciledProfile?.stripe_account_id) {
      sendJson(res, isStripeConfigErrorMessage(error) ? 503 : 502, {
        error: error || 'Could not load Stripe account status.',
      });
      return;
    }
    stripeAccountId = reconciledProfile.stripe_account_id;
  }

  if (!stripeAccountId) {
    const { data, error } = await createConnectedAccount(profile);
    if (error || !data?.id) {
      sendJson(res, isStripeConfigErrorMessage(error) ? 503 : 502, {
        error: isStripeConfigErrorMessage(error) ? error : 'Could not create Stripe account.',
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
      log.error('stripe connect update profile error', log.errCtx(updateErr));
      sendJson(res, 500, { error: 'Could not update profile.' });
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
      error: isStripeConfigErrorMessage(linkErr) ? linkErr : 'Could not create onboarding link.',
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
    log.error('stripe connect status profile error', log.errCtx(profileErr));
    sendJson(res, 500, { error: 'Could not load profile.' });
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
    log.error('stripe payment-link invoice error', log.errCtx(invoiceErr));
    sendJson(res, 500, { error: 'Could not load invoice.' });
    return;
  }
  if (!invoice) {
    sendJson(res, 404, { error: 'Invoice not found.' });
    return;
  }

  const { data: profile, error: profileErr } = await supabase
    .from('business_profiles')
    .select('stripe_account_id, stripe_onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr) {
    log.error('stripe payment-link profile error', log.errCtx(profileErr));
    sendJson(res, 500, { error: 'Could not load profile.' });
    return;
  }
  if (!profile?.stripe_account_id) {
    sendJson(res, 409, {
      error: 'Stripe payouts are not set up yet. Start Connect onboarding first.',
    });
    return;
  }

  const cap = await assertStripeInvoicePaymentsReady(profile.stripe_account_id);
  if (!cap.ok) {
    sendJson(res, cap.status, { error: cap.error });
    return;
  }

  try {
    const result = await createOrReuseInvoicePaymentLink({
      invoice,
      userId,
      supabase,
      stripeAccountId: profile.stripe_account_id,
    });
    sendJson(res, 200, {
      url: result.url,
      payment_link_id: result.payment_link_id ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not signed')) {
      sendJson(res, 409, { error: msg });
      return;
    }
    if (msg.includes('greater than zero')) {
      sendJson(res, 400, { error: msg });
      return;
    }
    log.error('stripe payment-link create error', log.errCtx(err));
    sendJson(res, 502, { error: 'Could not create payment link.' });
  }
}

async function markInvoicePaidFromWebhook(supabase, invoiceId, paidAt, eventId) {
  // Idempotency check - skip if already paid
  const { data: existing } = await supabase
    .from('invoices')
    .select('payment_status')
    .eq('id', invoiceId)
    .maybeSingle();

  if (existing?.payment_status === 'paid') {
    log.info('invoice already paid, skipping duplicate', { invoiceId, eventId });
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
    log.warn('stripe webhook secret not configured');
    helpers.sendJson(res, 503, { error: 'Stripe webhook secret is not configured.' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    log.warn('missing stripe signature header');
    helpers.sendJson(res, 400, { error: 'Missing Stripe signature header.' });
    return;
  }

  let payload;
  try {
    payload = await helpers.readRawBody(req);
  } catch (e) {
    if (isPayloadTooLarge(e)) {
      log.warn('stripe webhook payload too large');
      helpers.sendJson(res, 413, { error: 'Request body too large.' });
      return;
    }
    log.warn('invalid webhook payload');
    helpers.sendJson(res, 400, { error: 'Invalid webhook payload.' });
    return;
  }

  const { data: event, error: eventErr } = constructWebhookEvent(payload, signature, secret);
  if (eventErr || !event) {
    log.warn('stripe signature verification failed', { error: eventErr });
    helpers.sendJson(res, 400, { error: 'Could not verify Stripe webhook.' });
    return;
  }

  log.info('stripe webhook received', {
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
    log.error('supabase not configured for stripe webhook', log.errCtx(error));
    helpers.sendJson(res, 503, {
      error: 'Stripe is unavailable.',
    });
    return;
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    log.info('async payment failed', {
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
    log.info('ignoring unhandled event type', { eventId: event.id, eventType: event.type });
    helpers.sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  const session = event.data?.object;
  const invoiceId = session?.metadata?.invoice_id;
  if (typeof invoiceId !== 'string' || !invoiceId.trim()) {
    log.warn('webhook missing invoice_id in metadata', { eventId: event.id, eventType: event.type });
    helpers.sendJson(res, 200, { ok: true, ignored: true });
    return;
  }

  if (event.type === 'checkout.session.completed' && session?.payment_status !== 'paid') {
    log.info('checkout session pending async payment', { eventId: event.id, invoiceId });
    helpers.sendJson(res, 200, { ok: true, pending: true });
    return;
  }

  try {
    await markInvoicePaidFromWebhook(supabase, invoiceId, paymentDateFromEvent(event), event.id);
    log.info('marked invoice paid', { invoiceId, eventId: event.id, eventType: event.type });
  } catch (error) {
    log.error('failed to mark invoice paid', { invoiceId, eventId: event.id, ...log.errCtx(error) });
    helpers.sendJson(res, 500, {
      error: 'Could not reconcile invoice payment.',
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
