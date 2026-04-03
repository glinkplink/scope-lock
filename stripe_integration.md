# Stripe Integration Notes

## Summary

This document captures the current Stripe and invoice-lifecycle decisions for IronWork.

The immediate priority is to finish the invoice e-sign flow and lock down the work-order/change-order invoice model. Stripe should attach to that stable invoice model instead of driving it.

## Decisions Made

- Use Stripe Payment Links for the MVP instead of embedded Checkout.
- Support both card payments and ACH payments in the Stripe MVP.
- Keep Stripe payment state separate from invoice issuance state and separate from DocuSeal e-sign state.
- Do not use invoice PDF download as a lifecycle transition once invoice e-sign exists.
- Invoice issuance should be tied to sending the invoice to the customer, not to signature completion and not to payment completion.
- The existing Node app server is sufficient for Stripe integration. Stripe can be added as new same-origin server routes plus a webhook endpoint.

## Connect Onboarding Shape

- Keep Stripe Connect on **Express** for this pass.
- `business_profiles.stripe_account_id` remains the single Stripe account link for each IronWork profile.
- If the profile already has `stripe_account_id`, clicking **Connect Stripe** must reuse that same connected account and open a fresh Stripe-hosted onboarding link for it.
- If the profile has no Stripe account yet, create one Express connected account and then redirect into Stripe-hosted onboarding.
- Existing Stripe users can sometimes sign in and reuse business information through Stripe-hosted/networked onboarding, but IronWork must not promise that branch in every case.
- Production behavior is the target. Stripe test mode can behave differently from live mode for the quick sign-in/reuse path.

## Connect Prefill Rules

- Safe first-time prefill is intentionally limited to:
  - account `email`
  - `business_profile.name`
  - `business_profile.url` only when the saved profile value parses as an absolute `https://` URL
  - required `business_profile.mcc = '1799'`
- Do **not** prefill country, address, identity/person data, phone, or bank/external-account fields from Edit Profile into Stripe.
- Reason: heavier prefill increases the chance that Stripe skips its existing-account reuse path and forces a fuller onboarding flow.

## Recommended Lifecycle Model

### User-facing invoice badge states

- No invoice row: `Invoice`
- Invoice row exists but has never been sent: `Draft`
- Invoice has been sent to the customer at least once: `Invoiced`
- Invoice has been confirmed paid by Stripe webhook: `Paid`

### Separate state machines

- Invoice issuance state:
  - draft
  - invoiced
  - paid
- Invoice e-sign state:
  - `not_sent`
  - `sent`
  - `opened`
  - `completed`
  - `declined`
  - `expired`
- Stripe payment state:
  - separate `payment_status` field(s), owned by server + webhook updates

`Invoiced` means the invoice was issued to the customer. It does not mean signed and it does not mean paid.

## Stripe MVP Shape

- Create a per-invoice Stripe Payment Link server-side.
- Generate or refresh that link when the invoice is sent from the invoice detail surface.
- Automatically inject the payment link into the outgoing invoice message.
- Use Stripe metadata to attach the IronWork invoice identity to the payment object.
- Use Stripe webhooks to mark the invoice paid.
- Do not rely on browser redirects or client-side polling as the source of truth for payment confirmation.

## Why Payment Links First

- Lower implementation overhead than embedded Checkout.
- Fits the current same-origin Node server architecture.
- Works well with the invoice send flow already being built around DocuSeal.
- Lets IronWork remain the system of record for invoice numbering, invoice PDFs, and invoice composition.

## Invoice E-sign Before Stripe

Stripe should be added after the invoice e-sign flow and invoice domain rules are stable enough that Stripe can attach to a clear invoice object.

That does not mean every future payment rule must be solved first, but these foundations should be settled:

- Invoice send/resend/status flow on invoices
- The meaning of `Draft` vs `Invoiced`
- Work-order invoice vs change-order invoice behavior
- The rule for when a job-level invoice can include change-order charges

## Change Orders And Final Work-Order Invoices

Current working product direction:

- A change order must be signed to be accepted.
- Payment is not the requirement for the welder to proceed with approved change-order work.
- Because Stripe payment state is not built yet, change-order inclusion logic should stay focused on e-sign and invoice composition for now.

Deferred until payment state exists:

- Whether previously paid change-order invoices should appear on a later work-order invoice as informational-only rows
- Whether paid vs unpaid should appear directly in the change-order picker
- How much payment history should be shown on final invoices vs detail pages

For now, keep the implementation centered on e-sign statuses and invoice issuance, not paid/unpaid product behavior.

## Data Model Direction

When Stripe is added, do not overload existing invoice status fields.

Preferred additions on `invoices`:

- invoice-issued field such as `issued_at` or equivalent server-owned indicator
- `payment_status`
- `payment_paid_at`
- Stripe identifiers such as payment link ID / URL and the final paid session or payment intent IDs as needed

DocuSeal fields on invoices should remain parallel to jobs and change orders and should not be reused as payment flags.

## Implementation Order

1. Finish invoice DocuSeal send/resend/status/webhook flow.
2. Finalize work-order vs change-order invoice composition rules.
3. Add Stripe Payment Links with card + ACH support.
4. Add Stripe webhook reconciliation and `Paid` badge behavior.

## Non-Goals For The First Stripe Pass

- Embedded Checkout
- Using download as invoice completion
- Treating DocuSeal `completed` as paid
- Treating paid/unpaid as the same thing as signed/unsigned
- Reworking the full change-order billing history UX before payment state exists
