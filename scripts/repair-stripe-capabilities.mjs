/**
 * One-time repair script: request card_payments + transfers on all connected Express accounts
 * that are missing them.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/repair-stripe-capabilities.mjs
 *
 * Dry-run (inspect only, no changes):
 *   DRY_RUN=true STRIPE_SECRET_KEY=sk_live_... node scripts/repair-stripe-capabilities.mjs
 *
 * Reads all connected accounts from the Stripe API (auto-paginated).
 * For each account, checks capability status and requests missing ones.
 * Logs a summary table when done.
 */

import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('ERROR: STRIPE_SECRET_KEY env var is required.');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === 'true';
const stripe = new Stripe(secretKey);

const REQUIRED_CAPABILITIES = ['card_payments', 'transfers'];

const results = {
  already_active: [],
  requested: [],
  pending: [],
  skipped_deauthorized: [],
  errors: [],
};

async function processAccount(account) {
  const id = account.id;

  // Skip deauthorized / rejected accounts
  if (account.requirements?.disabled_reason === 'rejected.fraud' ||
      account.requirements?.disabled_reason === 'rejected.terms_of_service' ||
      account.requirements?.disabled_reason === 'rejected.listed') {
    results.skipped_deauthorized.push({ id, reason: account.requirements.disabled_reason });
    return;
  }

  const caps = account.capabilities ?? {};
  const missing = REQUIRED_CAPABILITIES.filter(cap => caps[cap] !== 'active');

  if (missing.length === 0) {
    results.already_active.push({ id });
    console.log(`[OK]      ${id} — all capabilities active`);
    return;
  }

  const capabilityStatus = REQUIRED_CAPABILITIES.map(c => `${c}=${caps[c] ?? 'none'}`).join(', ');
  console.log(`[NEEDS]   ${id} — ${capabilityStatus} — missing: ${missing.join(', ')}`);

  if (DRY_RUN) {
    results.pending.push({ id, missing });
    return;
  }

  try {
    const update = {};
    for (const cap of missing) {
      update[cap] = { requested: true };
    }

    await stripe.accounts.update(id, { capabilities: update });

    // Re-fetch to check new status
    const updated = await stripe.accounts.retrieve(id);
    const newCaps = updated.capabilities ?? {};
    const stillMissing = REQUIRED_CAPABILITIES.filter(c => newCaps[c] !== 'active');

    if (stillMissing.length === 0) {
      results.requested.push({ id, status: 'active' });
      console.log(`[FIXED]   ${id} — capabilities now active`);
    } else {
      const newStatus = REQUIRED_CAPABILITIES.map(c => `${c}=${newCaps[c] ?? 'none'}`).join(', ');
      results.pending.push({ id, missing: stillMissing, status: newStatus });
      console.log(`[PENDING] ${id} — requested, awaiting Stripe review: ${newStatus}`);
    }
  } catch (err) {
    results.errors.push({ id, error: err.message });
    console.error(`[ERROR]   ${id} — ${err.message}`);
  }
}

async function main() {
  console.log(`Stripe capability repair script${DRY_RUN ? ' (DRY RUN — no changes will be made)' : ''}`);
  console.log('Fetching all connected accounts...\n');

  let count = 0;
  for await (const account of stripe.accounts.list({ limit: 100 })) {
    count++;
    await processAccount(account);
  }

  console.log('\n--- Summary ---');
  console.log(`Total accounts scanned: ${count}`);
  console.log(`Already fully active:   ${results.already_active.length}`);
  console.log(`Capabilities requested: ${results.requested.length}`);
  console.log(`Pending Stripe review:  ${results.pending.length}`);
  console.log(`Skipped (deauthorized): ${results.skipped_deauthorized.length}`);
  console.log(`Errors:                 ${results.errors.length}`);

  if (results.pending.length > 0) {
    console.log('\nPending accounts (onboarding incomplete or under review):');
    for (const a of results.pending) {
      console.log(`  ${a.id}  missing=${a.missing?.join(', ')}  status=${a.status ?? 'not_requested'}`);
    }
    console.log('\nFor each pending account, generate a new onboarding link:');
    console.log('  node scripts/generate-onboarding-links.mjs <account_id1> <account_id2> ...');
  }

  if (results.errors.length > 0) {
    console.log('\nErrored accounts:');
    for (const a of results.errors) {
      console.log(`  ${a.id}: ${a.error}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
