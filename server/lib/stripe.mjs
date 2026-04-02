import Stripe from 'stripe';

let stripeSingleton = null;

function env(name) {
  const value = process.env[name];
  return value != null && String(value).trim() !== '' ? String(value).trim() : '';
}

export function resetStripeSingleton() {
  stripeSingleton = null;
}

function getStripe() {
  if (stripeSingleton) return stripeSingleton;
  const secretKey = env('STRIPE_SECRET_KEY');
  if (!secretKey) return null;
  stripeSingleton = new Stripe(secretKey);
  return stripeSingleton;
}

export async function createConnectedAccount(email) {
  const stripe = getStripe();
  if (!stripe) {
    return { data: null, error: 'Stripe not configured' };
  }

  try {
    const account = await stripe.accounts.create({
      type: 'express',
      ...(email ? { email } : {}),
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        // MCC 1799: Special Trade Contractors (welders, general contractors)
        // Required for card_payments capability; without it onboarding stalls.
        mcc: '1799',
      },
    });
    return {
      data: {
        id: account.id,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Could not create Stripe account.',
    };
  }
}

export async function createAccountOnboardingLink(accountId, returnUrl, refreshUrl) {
  const stripe = getStripe();
  if (!stripe) {
    return { data: null, error: 'Stripe not configured' };
  }

  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return {
      data: {
        url: link.url,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Could not create onboarding link.',
    };
  }
}

export async function getConnectedAccount(accountId) {
  const stripe = getStripe();
  if (!stripe) {
    return { data: null, error: 'Stripe not configured' };
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      data: {
        id: account.id,
        details_submitted: Boolean(account.details_submitted),
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
        card_payments_status: account.capabilities?.card_payments ?? 'inactive',
        transfers_status: account.capabilities?.transfers ?? 'inactive',
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Could not load Stripe account.',
    };
  }
}

export async function createInvoicePaymentLink(input) {
  const stripe = getStripe();
  if (!stripe) {
    return { data: null, error: 'Stripe not configured' };
  }

  try {
    const link = await stripe.paymentLinks.create(
      {
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: input.title,
                description: input.description,
              },
              unit_amount: input.totalCents,
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['card', 'us_bank_account'],
        metadata: {
          invoice_id: input.invoiceId,
          job_id: input.jobId,
          user_id: input.userId,
        },
      },
      {
        stripeAccount: input.stripeAccountId,
      }
    );

    return {
      data: {
        id: link.id,
        url: link.url,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Could not create payment link.',
    };
  }
}

/**
 * Create or reuse a Stripe payment link for an invoice.
 * Returns the payment link URL and ID, and updates the invoice if a new link is created.
 */
export async function createOrReuseInvoicePaymentLink({ invoice, userId, supabase, stripeAccountId }) {
  // Return existing if already exists (legacy invoices unaffected)
  if (invoice.stripe_payment_url) {
    return { url: invoice.stripe_payment_url, payment_link_id: invoice.stripe_payment_link_id };
  }

  // Gate: Verify parent work order is signature-satisfied before creating new payment link
  const { data: parentJob, error: jobErr } = await supabase
    .from('jobs')
    .select('esign_status, offline_signed_at')
    .eq('id', invoice.job_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (jobErr) {
    throw new Error('Could not verify work order signature status');
  }

  const isSigned = parentJob?.esign_status === 'completed' || parentJob?.offline_signed_at !== null;

  if (!isSigned) {
    throw new Error('Cannot issue invoice: work order is not signed. Sign via DocuSeal or mark as signed offline.');
  }

  // Validate the invoice total
  const totalCents = Math.round(Number(invoice.total) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error('Invoice total must be greater than zero.');
  }

  const invoiceNumber = String(invoice.invoice_number ?? '').padStart(4, '0');
  const { data: linkData, error } = await createInvoicePaymentLink({
    stripeAccountId,
    invoiceId: invoice.id,
    jobId: invoice.job_id,
    userId,
    totalCents,
    title: `Invoice #${invoiceNumber}`,
    description: `IronWork invoice #${invoiceNumber}`,
  });

  if (error || !linkData?.url) {
    throw new Error(error || 'Could not create payment link');
  }

  // Update invoice with payment link info
  const { error: updateErr } = await supabase
    .from('invoices')
    .update({
      stripe_payment_link_id: linkData.id,
      stripe_payment_url: linkData.url,
    })
    .eq('id', invoice.id)
    .eq('user_id', userId);

  if (updateErr) {
    throw updateErr;
  }

  return { url: linkData.url, payment_link_id: linkData.id };
}

export function constructWebhookEvent(payload, signature, secret) {
  const stripe = getStripe();
  if (!stripe) {
    return { data: null, error: 'Stripe not configured' };
  }
  if (!secret) {
    return { data: null, error: 'Stripe webhook secret is not configured' };
  }

  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return { data: event, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Could not verify Stripe webhook.',
    };
  }
}
