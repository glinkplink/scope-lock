import { log } from './logger.mjs';

function missing(name) {
  const v = process.env[name];
  return v == null || String(v).trim() === '';
}

/**
 * Log missing runtime env keys by feature group (boot-time diagnostics).
 */
export function logEnvPreflight() {
  const supabase = missing('SUPABASE_URL') || missing('SUPABASE_SERVICE_ROLE_KEY');
  if (supabase) {
    log.warn('env: Supabase server keys missing', {
      SUPABASE_URL: missing('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: missing('SUPABASE_SERVICE_ROLE_KEY'),
    });
  }

  if (missing('SUPABASE_URL') || missing('SUPABASE_SERVICE_ROLE_KEY')) {
    log.warn('env: POST /api/pdf auth requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server process');
  }

  const stripe =
    missing('STRIPE_SECRET_KEY') ||
    missing('STRIPE_WEBHOOK_SECRET') ||
    missing('SUPABASE_URL') ||
    missing('SUPABASE_SERVICE_ROLE_KEY');
  if (stripe) {
    log.info('env: Stripe features may be limited', {
      STRIPE_SECRET_KEY: missing('STRIPE_SECRET_KEY'),
      STRIPE_WEBHOOK_SECRET: missing('STRIPE_WEBHOOK_SECRET'),
    });
  }

  const resend = missing('RESEND_API_KEY') || missing('RESEND_FROM_EMAIL');
  if (resend) {
    log.info('env: Resend email may be unavailable', {
      RESEND_API_KEY: missing('RESEND_API_KEY'),
      RESEND_FROM_EMAIL: missing('RESEND_FROM_EMAIL'),
    });
  }

  const docuseal = missing('DOCUSEAL_API_KEY');
  if (docuseal) {
    log.info('env: DocuSeal e-sign may be unavailable', { DOCUSEAL_API_KEY: true });
  }

  const puppeteer =
    !process.env.PUPPETEER_EXECUTABLE_PATH &&
    !process.env.CHROME_PATH;
  if (puppeteer) {
    log.info('env: using default Chrome path for PDF (set PUPPETEER_EXECUTABLE_PATH if needed)');
  }

  warnVitePrefixSecrets();
}

function warnVitePrefixSecrets() {
  const suspicious = ['SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'DOCUSEAL_API_KEY', 'RESEND_API_KEY'];
  for (const base of suspicious) {
    const viteName = `VITE_${base}`;
    if (!missing(viteName)) {
      log.warn(`env: ${viteName} is set — server secrets should not use VITE_ prefix`);
    }
  }
}
