# IronWork — Production Readiness

Comprehensive checklist for taking IronWork to production. Organized by who does the work.

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
- [x] **Enable ACH Debit** if you want to support it (Dashboard → Settings → Payment methods)
- [ ] **Complete Stripe's platform profile** if required for Connect activation (business info, website, etc.)
- [ ] **Test the full payment flow** in test mode first (use `sk_test_...` keys + `whsec_test_...`) before switching to live keys
- [x] **Capabilities requested at account creation** — `card_payments` + `transfers` + `mcc: '1799'` (Special Trade Contractors) are set in `createConnectedAccount`; no manual dashboard action required for new accounts
- [ ] **Run repair script for any existing accounts** created before this fix: `STRIPE_SECRET_KEY=sk_live_... node scripts/repair-stripe-capabilities.mjs`

### Supabase Dashboard

- [x] **Apply all migrations** if not already done — paste each file from `supabase/migrations/` into SQL Editor in order, or run `npx supabase db push` from local
  - Confirm through `0022_update_work_orders_rpcs_offline_signed.sql` (`offline_signed_at` on `jobs` plus dashboard RPC exposure)
- [x] **Confirm RLS is enabled** on all tables (Dashboard → Table Editor → each table → RLS toggle)
- [ ] **Set up a backup schedule** if not already configured (Dashboard → Database → Backups) (not doing this yet as it requires a paid plan)

### Render (or your PaaS of choice)

- [x] **Set all required environment variables** on the web service (not just build vars):
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
  SENTRY_DSN=...                               # optional — server-side error tracking (@sentry/node)
  ```
- [x] **Set `VITE_*` vars as build-time args** (Render: Environment → add to Build env vars) — these are baked into the client bundle at build time, not runtime
- [x] **Verify the health check** after first deploy: `curl https://[your-domain]/api/pdf/health` → `{"ok":true}`
- [ ] **Set an appropriate plan** — Puppeteer + Chromium needs at least 512MB RAM; 1GB recommended
- [x] **Confirm Docker build is used** (the repo has a `Dockerfile` — set Render to use Docker deploy, not static)

### DNS / Domain

- [x] **Point your custom domain** to the Render service and update `APP_BASE_URL` accordingly
- [x] **Verify HTTPS** is working (Render provides TLS automatically for custom domains)

### DocuSeal

- [x] **Register a DocuSeal account** and get an API key
- [x] **Configure a webhook** in DocuSeal pointing to `https://[your-domain]/api/webhooks/docuseal`
  - Copy the header name and secret value — these are `DOCUSEAL_WEBHOOK_HEADER_NAME` and `DOCUSEAL_WEBHOOK_HEADER_VALUE`
- [ ] **Test e-sign flow** end-to-end: send a work order, receive the DocuSeal email, sign, verify the work order updates in IronWork

---

## Code / Configuration Work Remaining

### Completed Features

- [x] **"Send Invoice" button implemented** — `InvoiceFinalPage.tsx` has working "Send Invoice" / "Resend Invoice" button with `handleSendInvoice()` handler; uses `resend` package for email delivery
- [x] **`stripe_connect=refresh` flow reconciles status** — `useAuthProfile.ts` handles the `refresh` state by calling `getStripeConnectStatus()` then `loadProfile({ silent: true })`, and sets a success/info/error notice
- [x] **Security headers** — `app-server.mjs` sets `X-Content-Type-Options: nosniff` on all responses (via `COMMON_HEADERS`) and `X-Frame-Options: DENY` on HTML responses
- [x] **Rate limiting** — per-IP throttle on `/api/pdf` (10/min), `/api/stripe/connect/start` (5/min), `/api/esign/*/send|resend` (5/min), `/api/invoices/*/send` (5/min) via `server/lib/rate-limit.mjs`
- [x] **`engines` field in `package.json`** — declares `node: ">=20.0.0"`
- [x] **`"start"` script in `package.json`** — `"start": "NODE_ENV=production node server/app-server.mjs"`
- [x] **Persist resent state in database** — `esign_resent_at` column on `jobs` and `change_orders`; "Resent" label and timestamp survive page navigation (migration `0020_esign_resent_at.sql`)
- [x] **Offline-signed invoice gate** — `jobs.offline_signed_at` column + backend enforcement + UI gating prevents invoice issuance on unsigned work orders unless marked offline-signed

### Known Gaps

- [x] **Error tracking** — Sentry (`@sentry/node`) captures server-side exceptions, unhandled request errors, and process-level `uncaughtException` / `unhandledRejection`. Set `SENTRY_DSN` on the web service. For uptime, use an external HTTP monitor (e.g. Better Stack free tier) against `GET /api/pdf/health` at a few-minute interval with email alerts.
- [x] **No structured logging on Stripe webhook** — payment events (paid, failed, amount mismatch) now logged with event IDs
- [x] **Stripe webhook idempotency audit trail** — duplicate events now logged with event ID
- [x] **`Paid` status on Work Order detail** — `WorkOrderDetailPage` now surfaces invoice `payment_status`

---

## Smoke Test Checklist (Run After Every Production Deploy)

Run these manually or automate as integration tests before marking a deploy healthy:

- [ ] `GET /api/pdf/health` → `{ "ok": true }`
- [ ] `GET /api/webhooks/docuseal` → `{ "ok": true }`
- [ ] Sign in → Create Work Order → fill form → Preview renders
- [ ] Download PDF (work order) → file opens correctly
- [ ] Send for Signature → DocuSeal email received → sign → work order status updates in dashboard
- [ ] Create Invoice → wizard completes → InvoiceFinalPage shows payment link button
- [ ] Click "Create Payment Link" → link generated and copied to clipboard
- [ ] Mark test invoice as paid via Stripe webhook/test flow → Work Orders dashboard shows `Paid`
- [ ] Edit Profile → Stripe section visible → "Connect Stripe" button present
- [ ] Click "Connect Stripe" → redirects to Stripe onboarding (test mode)
- [ ] Complete onboarding → returns to app → profile shows "Connected"

---

## Roadmap (Post-Launch)

These are not blockers but are the next logical increments:

1. **Change order invoice billing rules** — decide whether paid COs appear as informational rows on final WO invoices
2. **Stripe payouts visibility** — minimal payouts summary on Edit Profile (not a full dashboard, just "your last payout was $X on DATE")
