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
  # SENTRY_DSN — do not set for current production; error tracking (Sentry) intentionally out of scope
  ```
- [x] **Set `VITE_*` vars as build-time args** (Render: Environment → add to Build env vars) — these are baked into the client bundle at build time, not runtime
- [x] **Verify the health check** after first deploy: `curl https://[your-domain]/api/pdf/health` → `{"ok":true}`
- [ ] **Set an appropriate plan** — Puppeteer + Chromium needs at least 512MB RAM; 1GB recommended
- [x] **Confirm Docker build is used** (the repo has a `Dockerfile` — set Render to use Docker deploy, not static)
- [ ] **Optional — ship logs to Better Stack** — In Render **Observability → Log Streams**, configure **Log Endpoint** and **Token** per [Better Stack’s Render integration](https://betterstack.com/docs/logs/render/) (application logs only).
- [ ] **Optional — ship metrics to Better Stack** — **Separate** from Log Streams: use Render **Metrics Stream** with **Better Stack** as a destination and the **OpenTelemetry** / metrics path in Better Stack’s docs—not the same wiring as logs.

### Better Stack (external uptime + Cursor MCP)

IronWork does **not** embed Better Stack in code; use Better Stack (or any provider) for **HTTP uptime** against **`GET /api/pdf/health`**. The [Better Stack Uptime API](https://betterstack.com/docs/uptime/api/create-a-new-monitor/) can create monitors programmatically.

- [ ] **Create the uptime monitor** — **Default: manual** in Better Stack **Uptime** (or via Uptime API): URL `https://[your-domain]/api/pdf/health`, interval ~few minutes, alerts as needed. **Exception:** if your **live** Better Stack MCP tool inventory in Cursor exposes **create/update monitor** tools, you may use those instead—check **Cursor → MCP → Better Stack** after connecting.
- [ ] **Connect Cursor MCP** — Use Better Stack’s **remote HTTP MCP** with **OAuth** (preferred). Minimal server URL **`https://mcp.betterstack.com`** — align local **`mcp.json`** with [Better Stack MCP](https://betterstack.com/docs/getting-started/integrations/mcp/).
- [ ] **Verify via MCP (after OAuth works)** — (1) Confirm MCP connection and tools load. (2) List monitors (`uptime_list_monitors`; call `telemetry_list_teams` first only if your session requires a `team_id`). (3) Find the production **`/api/pdf/health`** monitor by URL or name. (4) Fetch details (`uptime_get_monitor_details` in docs; Cursor may register the same tool as `uptime_get_monitor` or with a `_tool` suffix—use the exact name from your tool list). (5) Check availability (`uptime_get_monitor_availability`). (6) Check response times (`uptime_get_monitor_response_times`).
- [ ] **Success check** — Monitor exists for the prod health URL, shows healthy in Better Stack, and `curl` to `/api/pdf/health` returns `{"ok":true}` (see smoke checklist below).
- [ ] **Optional — log source via MCP** — With MCP authenticated, `telemetry_list_teams`, optional `telemetry_list_data_regions`, and `telemetry_create_source` (tool names in Cursor may include a `_tool` suffix) can create a Better Stack log source; use the **Log Endpoint** and **Token** Better Stack/Render show alongside Render **Log Streams** ([Render integration](https://betterstack.com/docs/logs/render/), [Create a source API](https://betterstack.com/docs/logs/api/create-a-source/)).

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

- [x] **Error tracking (Sentry)** — **Intentionally not pursued** for production: leave **`SENTRY_DSN` unset** on the web service. `@sentry/node` remains in the codebase only for optional future use if you adopt it later.
- [x] **Uptime** — External HTTP monitor (e.g. Better Stack) against `GET /api/pdf/health` at a few-minute interval with email alerts. **Operational detail:** Human Intervention → **Better Stack** and optional Render Log Streams / Metrics Stream above.
- [x] **No structured logging on Stripe webhook** — payment events (paid, failed, amount mismatch) now logged with event IDs
- [x] **Stripe webhook idempotency audit trail** — duplicate events now logged with event ID
- [x] **`Paid` status on Work Order detail** — `WorkOrderDetailPage` now surfaces invoice `payment_status`

---

## Smoke Test Checklist (Run After Every Production Deploy)

Run these manually or automate as integration tests before marking a deploy healthy. The first two rows are **HTTP** checks: use **curl** or a browser with a **full URL** (host + path). The app server must be running (e.g. `npm run dev` → default `http://127.0.0.1:3000`).

- [x] `GET /api/pdf/health` → `{ "ok": true }` — e.g. `curl -sS http://127.0.0.1:3000/api/pdf/health` locally, or `curl -sS https://ironwork.app/api/pdf/health` after deploy
- [x] `GET /api/webhooks/docuseal` → `{ "ok": true }` — e.g. `curl -sS http://127.0.0.1:3000/api/webhooks/docuseal`
- [x] Sign in → Create Work Order → fill form → Preview renders
- [x] Download PDF (work order) → file opens correctly
- [ ] Send for Signature → DocuSeal email received → sign → work order status updates in dashboard
- [ ] Create Invoice → wizard completes → InvoiceFinalPage shows payment link button
- [x] Click "Create Payment Link" → link generated and copied to clipboard
- [ ] Mark test invoice as paid via Stripe webhook/test flow → Work Orders dashboard shows `Paid`
- [x] Edit Profile → Stripe section visible → "Connect Stripe" button present
- [x] Click "Connect Stripe" → redirects to Stripe onboarding (test mode)
- [ ] Complete onboarding → returns to app → profile shows "Connected"

---

## Roadmap (Post-Launch)

These are not blockers but are the next logical increments:

1. **Change order invoice billing rules** — decide whether paid COs appear as informational rows on final WO invoices
2. **Stripe payouts visibility** — minimal payouts summary on Edit Profile (not a full dashboard, just "your last payout was $X on DATE")
