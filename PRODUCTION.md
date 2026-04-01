# ScopeLock — Production Readiness

Comprehensive checklist for taking ScopeLock to production. Organized by who does the work.

---

## Human Intervention Required

Everything in this section requires action outside the codebase — Stripe dashboard, Supabase dashboard, Render, DNS, etc.

### Stripe Dashboard

- [x] **Create a Stripe account** (or switch to live mode if already in test mode)
- [x] **Enable Stripe Connect** for your account (Dashboard → Connect → Get started)
- [x] **Register a webhook endpoint** pointing to `https://[your-domain]/api/stripe/webhook`
  - Events to listen for: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
  - Copy the **Webhook Signing Secret** (`whsec_...`) — this is your `STRIPE_WEBHOOK_SECRET`
- [x] **Get your Secret Key** (Dashboard → Developers → API keys → Secret key `sk_live_...`)
- [ ] **Verify your Connect branding** (Dashboard → Connect → Settings → Branding) — contractors will see your brand during onboarding
- [ ] **Enable ACH Debit** if you want to support it (Dashboard → Settings → Payment methods)
- [ ] **Complete Stripe's platform profile** if required for Connect activation (business info, website, etc.)
- [ ] **Test the full payment flow** in test mode first (use `sk_test_...` keys + `whsec_test_...`) before switching to live keys

### Supabase Dashboard

- [ ] **Apply all migrations** if not already done — paste each file from `supabase/migrations/` into SQL Editor in order, or run `npx supabase db push` from local
  - Confirm migration `0018_stripe_scaffolding.sql` is applied (adds `stripe_account_id`, `stripe_onboarding_complete` to `business_profiles`)
- [ ] **Confirm RLS is enabled** on all tables (Dashboard → Table Editor → each table → RLS toggle)
- [ ] **Set up a backup schedule** if not already configured (Dashboard → Database → Backups)

### Render (or your PaaS of choice)

- [ ] **Set all required environment variables** on the web service (not just build vars):
  ```
  NODE_ENV=production
  APP_BASE_URL=https://your-domain.com         # no trailing slash — required for Stripe Connect redirects
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...                # service role key, not anon key
  VITE_SUPABASE_URL=https://xxx.supabase.co    # build-time
  VITE_SUPABASE_ANON_KEY=...                   # build-time
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  DOCUSEAL_API_KEY=...
  DOCUSEAL_WEBHOOK_HEADER_NAME=...             # exact header name from DocuSeal webhook settings
  DOCUSEAL_WEBHOOK_HEADER_VALUE=...            # raw secret, not hashed
  VITE_GEOAPIFY_API_KEY=...                    # optional — job site autocomplete
  ```
- [ ] **Set `VITE_*` vars as build-time args** (Render: Environment → add to Build env vars) — these are baked into the client bundle at build time, not runtime
- [ ] **Verify the health check** after first deploy: `curl https://[your-domain]/api/pdf/health` → `{"ok":true}`
- [ ] **Set an appropriate plan** — Puppeteer + Chromium needs at least 512MB RAM; 1GB recommended
- [ ] **Confirm Docker build is used** (the repo has a `Dockerfile` — set Render to use Docker deploy, not static)

### DNS / Domain

- [ ] **Point your custom domain** to the Render service and update `APP_BASE_URL` accordingly
- [ ] **Verify HTTPS** is working (Render provides TLS automatically for custom domains)

### DocuSeal

- [ ] **Register a DocuSeal account** and get an API key
- [ ] **Configure a webhook** in DocuSeal pointing to `https://[your-domain]/api/webhooks/docuseal`
  - Copy the header name and secret value — these are `DOCUSEAL_WEBHOOK_HEADER_NAME` and `DOCUSEAL_WEBHOOK_HEADER_VALUE`
- [ ] **Test e-sign flow** end-to-end: send a work order, receive the DocuSeal email, sign, verify the work order updates in ScopeLock

---

## Code / Configuration Work Remaining

### Incomplete Features

- [ ] **"Send Invoice" button is disabled** — `InvoiceFinalPage.tsx` line 253 hardcodes `disabled` with "Coming Soon" label
  - Payment **link generation and copying** is functional; email delivery is not yet wired
  - Unblock this when email sending is implemented (see roadmap below)
- [x] **`stripe_connect=refresh` flow reconciles status** — `useAuthProfile.ts` handles the `refresh` state by calling `getStripeConnectStatus()` then `loadProfile({ silent: true })`, and sets a success/info/error notice. Verified complete.

### Missing Hardening

- [x] **Security headers** — `app-server.mjs` sets `X-Content-Type-Options: nosniff` on all responses (via `COMMON_HEADERS`) and `X-Frame-Options: DENY` on HTML responses. CSP is not set but the minimum is covered.
- [ ] **Rate limiting** — no throttle on `/api/pdf`, `/api/stripe/connect/start`, or `/api/esign/*`
  - PDF generation is CPU/memory-heavy; unthrottled it can be exhausted by a single abusive user
  - Minimum viable: per-IP or per-user cap on `/api/pdf` (e.g. 10 req/min)
- [ ] **`engines` field in `package.json`** — no minimum Node version declared; Dockerfile uses `node:20-slim` but package.json doesn't enforce this

### Nice-to-Have Before GA

- [ ] **Structured logging on Stripe webhook** — payment events (invoice paid, failed, amount mismatch) currently log nothing; hard to debug billing issues without a trail
- [ ] **`"start"` script in `package.json`** — production deployments typically expect `npm start`; currently only `preview` sets `NODE_ENV=production`
- [ ] **Stripe webhook idempotency** — if Stripe retries a webhook, the DB `payment_status` update is idempotent, but logging a duplicate event silently is fine only if there's a way to audit it later

---

## Smoke Test Checklist (Run After Every Production Deploy)

Run these manually or automate as integration tests before marking a deploy healthy:

- [ ] `GET /api/pdf/health` → `{ "ok": true }`
- [ ] `GET /api/webhooks/docuseal` → `{ "ok": true }`
- [ ] Sign in → Create Work Order → fill form → Preview renders
- [ ] Download PDF (work order) → file opens correctly
- [ ] Send for Signature → DocuSeal email received → sign → work order status updates in dashboard
- [ ] Create Invoice → wizard completes → InvoiceFinalPage shows payment link button
- [ ] Click "Get Payment Link" → link generated and copied to clipboard
- [ ] Edit Profile → Stripe section visible → "Connect Stripe" button present
- [ ] Click "Connect Stripe" → redirects to Stripe onboarding (test mode)
- [ ] Complete onboarding → returns to app → profile shows "Connected"

---

## Roadmap (Post-Launch)

These are not blockers but are the next logical increments:

1. **Email invoice delivery** — wire `sendgrid` / `AWS SES` / `resend` to the disabled "Send Invoice" button; inject payment link into the email body
2. **`Paid` badge on Work Orders dashboard** — surface `payment_status = 'paid'` visually on the work order list and detail
3. **Change order invoice billing rules** — decide whether paid COs appear as informational rows on final WO invoices (see `stripe_integration.md`)
4. **Stripe payouts visibility** — minimal payouts summary on Edit Profile (not a full dashboard, just "your last payout was $X on DATE")
5. **Rate limiting middleware** — shared rate limiter across all `/api/*` routes
6. **Sentry or equivalent** — error tracking for server-side crashes (Puppeteer, Stripe API errors, DocuSeal failures)
