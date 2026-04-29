# IronWork Architecture

## Agent documentation & living documents

**Canonical short rules for all agents:** **[AGENTS.md](./AGENTS.md)**. `CLAUDE.md` is a pointer to AGENTS.md for Claude Code auto-loading.

**Cursor enforcement:** **[.cursor/rules/ScopeLock-Project-Rules.mdc](./.cursor/rules/ScopeLock-Project-Rules.mdc)** and **[.cursor/rules/high-priority.mdc](./.cursor/rules/high-priority.mdc)** — aligned with AGENTS.md.

`AGENTS.md`, `ARCHITECTURE.md`, and the Cursor rule files are **living documents** and should stay aligned.

- **After each substantive code change** that affects architecture, deployment, system boundaries, routes, patterns, stack/dependencies, or cross-cutting implementation conventions, update whichever of these files are affected.
- **When editing any of these agent-facing files**, compare the same topic across the others and keep them aligned, especially for architecture/deployment constraints, CSS co-location, HTML/`esc()` rules, and minimal-diff/file-discipline guidance.
- `AGENTS.md` is the first-stop rules file; this document is the deeper system and deployment reference and should only be loaded by agents as needed.
- **Public branding:** Use **IronWork** in product prose and user-facing copy. Legacy internal identifiers, repo paths, storage keys, and factual filenames such as **`ScopeLock-Project-Rules.mdc`** may remain where renaming would be risky or inaccurate.

## Product Purpose

IronWork helps independent welders quickly generate short, professional job agreements for small jobs. The goal is to prevent disputes, clarify scope, and protect the welder from being blamed for issues outside their work.

The generated document is a concise 1–3 page agreement, not a long legal contract.

### Target Users (For MVP)
- Independent welders
- Small welding shops
- Mobile welders doing repair or fabrication jobs

### Primary Workflow
A contractor can **start a work order without signing in**. They fill the job form and preview the agreement; on first **Download & Save** or anonymous **Save & Send for Signature** they create an account (business name, email, password). If Supabase email confirmation is enabled, IronWork stores the pending work order locally, waits for confirmation, then restores the draft and creates `business_profiles` once a confirmed session exists. The user then reviews and clicks the save/send action again to persist the work order. If confirmation is disabled and Supabase returns a session immediately, the legacy same-screen capture path creates the profile, persists the work order, and continues the requested action. Returning users sign in from the header, then use **Work Orders**, **Invoices**, and **Edit profile** as needed. Profile defaults (exclusions, warranty, payment methods, etc.) apply to **new** drafts after they exist in `business_profiles`.

## Tech Stack

- **Vite**: Fast build tool and dev server
- **React**: UI framework
- **TypeScript**: Type safety and better DX
- **Supabase**: Authentication (email/password) and Postgres database
- **Puppeteer Core**: Chrome-based PDF rendering on the app server

### Why This Stack?
- Supabase provides auth + Postgres with minimal backend code
- Row-level security enforces per-user data isolation at the DB layer
- Fast development and hot reload with Vite
- One-command local development with the app server handling both frontend delivery and PDF rendering
- Can be packaged into iOS/Android apps later using Capacitor

### Known Trade-offs
- **Puppeteer requires an app server** instead of pure static hosting for PDF generation.
  The frontend sends the rendered agreement HTML to the app's **`POST /api/pdf`** route so Chrome can
  render the file with much closer parity to the on-screen preview. **`POST /api/pdf` requires**
  **`Authorization: Bearer <Supabase access_token>`**; the Node process must define **`SUPABASE_URL`**
  and **`SUPABASE_SERVICE_ROLE_KEY`** at **runtime** (same as invoice/e-sign) so the server can verify
  the JWT. **`GET /api/pdf/health`** remains unauthenticated for uptime checks. Puppeteer uses
  **`setRequestInterception`** with an allowlist (**`data:`**, **`about:`**, **`fonts.googleapis.com`**,
  **`fonts.gstatic.com`**) and **`setJavaScriptEnabled(false)`** to reduce SSRF risk from untrusted HTML.
- **PWA install support is metadata-first:** the app includes a manifest, platform icons, and a
  minimal service worker for installability and shell caching, but it is **not** an offline-first
  product. Auth, PDFs, Stripe, DocuSeal, and data mutations still require network access. The
  service worker does **not** cache Vite JS/CSS chunks; `src/boot.ts` clears legacy app-shell
  caches once before loading `main.tsx` so a stale asset cache cannot keep serving HTML as JS/CSS.
- **Static asset serving is strict:** production serves SPA fallback HTML only for extensionless
  app routes. Missing `/assets/*` files and missing file-like URLs return 404 instead of
  `index.html`, which makes deploy/dist mismatches visible instead of causing MIME errors.

### E-sign (DocuSeal)

- **Routes (same app server as PDFs):** `POST /api/esign/work-orders/:jobId/send`, `POST /api/esign/work-orders/:jobId/resend`, `GET /api/esign/work-orders/:jobId/status`, `POST /api/esign/change-orders/:coId/send`, `POST /api/esign/change-orders/:coId/resend`, `GET /api/esign/change-orders/:coId/status`, `POST /api/webhooks/docuseal`, and `GET /api/webhooks/docuseal` (connectivity probe → `{ ok: true }`). DocuSeal must call the **public** webhook URL on the same host as the app.
- **Auth:** Send/resend require `Authorization: Bearer <Supabase access_token>`; the server verifies the JWT and ensures the target row belongs to that user before calling DocuSeal or writing with the **service role**. The webhook uses **`DOCUSEAL_WEBHOOK_HEADER_NAME`** + **`DOCUSEAL_WEBHOOK_HEADER_VALUE`** only (no Supabase session). The server compares those values using **SHA-256 digests** and `timingSafeEqual` (fixed-length compare; operators still configure the **raw** shared secret in env). After header checks, the handler **verify-on-receive**s via DocuSeal `GET /submissions/:id`, rejects stale correlations, then updates the matching **work order or change order `esign_*` fields**.
- **Send payload:** `POST .../send` accepts **exactly one** document entry; every `documents[i].html` (and optional `html_header` / `html_footer`) must be a string. Total UTF-8 size of those HTML fields is capped (**2 MiB**) before the DocuSeal request. Misconfigured server env for e-sign surfaces as **503** with a generic JSON body; unexpected handler failures return **500** with a generic message (details stay in server logs).
- **Resend:** V1 uses **`PUT /submitters/{esign_submitter_id}`** on the submitter id returned from the first send — not a second HTML submission for the same document. If DocuSeal replies that the submitter already completed, the server reconciles local `esign_*` fields from `GET /submissions/{esign_submission_id}` so the UI can self-heal from missed completion webhooks.
- **HTML:** The client builds DocuSeal-specific HTML in **`src/lib/docuseal-agreement-html.ts`** (work orders) and **`src/lib/docuseal-change-order-html.ts`** (change orders) — embedded styles + `esc()`; customer fields use DocuSeal HTML field tags; send payloads include contextual **email** `message` subject/body (contractor name, document reference, `{{submitter.link}}`). Optional canvas **SP signature** PNG (`docuseal-signature-image.ts`) is embedded for CO send/resend when provided. The server forwards those payloads to DocuSeal; it does not re-derive sections from raw rows.
- **Status sync:** `GET .../work-orders/:jobId/status` and `GET .../change-orders/:coId/status` (authenticated) fetch the DocuSeal submission when needed, reconcile, and update **`jobs` / `change_orders`**. Work-order and change-order detail pages call each endpoint **once** when the user opens that screen (and again after send/resend paths that already refreshed). **Webhooks** still update the same rows; there is **no** client interval polling.
- **DB:** Migration **`0010_jobs_esign.sql`** adds **`jobs.esign_*`** columns; **`0011_jobs_esign_status_check.sql`** adds the status CHECK constraint; **`0012_jobs_inflight_esign_by_user_created_at.sql`** adds an index for in-flight polling; **`0013_change_orders_esign.sql`** adds matching **`change_orders.esign_*`** columns + constraint + index; **`0016_invoices_esign_and_issuance.sql`** adds **`invoices.issued_at`** for business issuance tracking. **`WorkOrderListJob.esign_status`** powers the work-orders list progress strip; work-order and change-order detail surfaces share the same Sent / Opened / Signed timeline card. Invoice business badges derive from `issued_at` (no e-sign tracking).
- **Hosted deploys (e.g. Render):** The Node process must have **`DOCUSEAL_API_KEY`**, **`SUPABASE_URL`**, **`SUPABASE_SERVICE_ROLE_KEY`**, and webhook header secrets in the **runtime** environment (dashboard env vars—not only `VITE_*` at build). Blueprint/`render.yaml` sync can overwrite dashboard-only vars if the YAML omits them. **End-to-end DocuSeal checks** (inbound email copy, signed PDF appearance, webhook delivery) use the **deployed** public URL and that environment; localhost can still run e-sign when `.env.local` is complete.

### Stripe Connect / payments

- **Routes (same app server as PDFs):** `POST /api/stripe/connect/start`, `GET /api/stripe/connect/status`, `POST /api/stripe/invoices/:invoiceId/payment-link`, and `POST /api/stripe/webhook`. Invoice email + optional payment link: **`POST /api/invoices/:invoiceId/send`** (see **`invoice-routes.mjs`**).
- **Auth:** Connect start/status and invoice payment-link routes require `Authorization: Bearer <Supabase access_token>`; the server verifies the JWT and loads the caller’s `business_profiles` row via the Supabase service role. The webhook does **not** use Supabase auth; it verifies the Stripe signature with `STRIPE_WEBHOOK_SECRET`.
- **Invoice issuance gate:** Payment-link creation and Stripe-backed invoice email are blocked until the parent work order is signature-satisfied (`jobs.esign_status = 'completed'` or `jobs.offline_signed_at` set). **`POST /api/invoices/:id/send`** enforces the same gate for **email-only** sends (no Stripe) so the work order cannot be bypassed. `createOrReuseInvoicePaymentLink` throws when unsigned; already-issued invoices with an existing `stripe_payment_url` still reuse that link.
- **Account creation:** `createConnectedAccount` keeps **Express** and always requests `card_payments` and `transfers` capabilities and sets `business_profile.mcc = '1799'` (Special Trade Contractors). First-time prefill is intentionally limited to `email`, `business_profile.name`, and an optional absolute-HTTPS `business_profile.url`. Do **not** prefill country, address, identity/person, phone, or bank fields; that would reduce Stripe-hosted/networked onboarding reuse options for existing Stripe users. Omitting capabilities or MCC causes `card_payments` to stay `inactive` even after onboarding completes; omitting MCC puts all required fields in `past_due`.
- **Onboarding complete signal:** `isStripeOnboardingComplete` uses `account.charges_enabled` (not `details_submitted`). Stripe sets `details_submitted = true` prematurely even when required fields are still `past_due`; `charges_enabled` is the reliable gate.
- **Payment link capability guard:** Before creating a payment link or sending an invoice **with** a payment link, the server uses **`assertStripeInvoicePaymentsReady`** in **`server/lib/stripe.mjs`** (via `getConnectedAccount`, `card_payments === 'active'`). Returns 409 with a user-facing message if `pending` (onboarding incomplete/under review) or `inactive` (never completed).
- **Profile integration:** `business_profiles.stripe_account_id` stores the connected account id. `business_profiles.stripe_onboarding_complete` is reconciled from Stripe account state by `GET /api/stripe/connect/status` when the user returns from onboarding, and the same reconciliation runs before `POST /api/stripe/connect/start` issues a fresh onboarding link for an existing connected account.
- **Return flow:** Stripe onboarding returns to `/?stripe_connect=return` and refresh uses `/?stripe_connect=refresh`. The client moves the user to **Edit Profile**, clears the query param from the URL, reloads profile state, and surfaces a status banner there.
- **Repeat connect behavior:** Clicking **Connect Stripe** for a profile that already has `stripe_account_id` must reuse that same connected account. IronWork should never create a second connected account for the same business profile just because the user re-opened onboarding.
- **Hosted deploys (e.g. Render):** The runtime environment must include **`STRIPE_SECRET_KEY`**, **`STRIPE_WEBHOOK_SECRET`**, and optionally **`APP_BASE_URL`** if forwarded headers are not sufficient to derive the public origin for Connect return links.

### Observability (app server)

- **Optional `SENTRY_DSN`:** **Production stance:** external error tracking is **intentionally omitted**—leave `SENTRY_DSN` unset unless you explicitly adopt Sentry later. When set, `@sentry/node` is initialized in `server/app-server.mjs` after dotenv loads. Uncaught exceptions flush the Sentry client then exit the process; unhandled promise rejections are reported without exiting. The main HTTP listener callback is wrapped in try/catch so unexpected errors still log and can be sent to Sentry before a generic **500** response (when headers are not yet sent).
- **Uptime:** External monitors should probe **`GET /api/pdf/health`** (returns **`{ "ok": true }`**) on the public origin; the app does not ship a separate heartbeat endpoint. **Runbook** (Better Stack MCP verification, optional Render logs/metrics): **[PRODUCTION.md](./PRODUCTION.md)** → *Human Intervention* → **Better Stack** / **Render**.

### Design system tokens (`src/App.css :root`)

- **Forge shell (dark app UI):** `--iron-*` (iron palette), `--spark` (orange accent), `--nav-height`, `--header-height`, `--shell-radius-*`, `--font-app` (Outfit stack).
- **Status chips (shared shell):** list and detail surfaces use the canonical **`.iw-status-chip`** system from `App.css`: **`--draft`** (yellow; includes **Downloaded**), **`--outstanding`** (orange, labeled **Pending** on invoice rows), **`--paid`** (solid green), **`--offline`** (outlined green), and **`--negative`** (red). **Home** recent rows use rolled-up job progress (`Sent`, `Signed`, `Completed`); **Work Orders** rows use signature/download progress (`Downloaded`, `Sent`, `Opened`, `Signed`, with offline-signed collapsed to `Signed` on rows); **Invoices** rows keep invoice lifecycle (`Draft`, `Downloaded`, `Pending`, `Paid`). Detail pages expand the same state machines with labels like `Signed offline`, `Sent via Stripe`, `Paid via Stripe`, and `Paid offline`. Across all three list surfaces, the **green row tint** means the job or invoice is fully complete because the latest standard invoice is `paid` or `offline`.
- **Shared shell form panels:** `--form-panel-bg`, `--form-panel-border`, `--form-control-bg`, `--form-control-border`, `--form-control-text`, `--form-label`, `--form-placeholder`, `--focus-ring-spark`. Primary CTAs use `.btn-primary` (spark), not legacy navy.
- **Light document tokens:** `--primary`, `--surface`, `--surface-white`, `--border`, `--text-primary`, `--agreement-section-blue`, `--radius`, `--radius-lg`, `--font-document` (Barlow stack). These remain the semantics for light UI surfaces (agreement preview sheet, e-sign timeline card, CaptureModal fields, invoice wizard summary box, payment-method document copy) and for document markup. **`buildPdfHtml`** inlines raw `App.css`; do not redefine these to dark semantics without pinning light values in the PDF HTML wrapper.
- **`body` font** is Outfit; on-screen agreement/invoice preview sheets set `font-family: var(--font-document)` on scoped document containers so preview matches PDF.

### PDF vs preview (`server/app-server.mjs` + `AgreementPreview.tsx`)
- **Web fonts**: **`index.html`** loads Outfit, Chakra Petch, Barlow, and Dancing Script (Forge shell + document faces). **`buildPdfHtml`** (`agreement-pdf.ts`) embeds its **own** Google Fonts `<link>` for **Barlow + Dancing Script** and sets PDF `body` to Barlow; it does **not** depend on the SPA font link. The server uses **`waitUntil: 'load'`** (bounded by aborted non-allowlisted requests), then waits for `document.fonts.ready`, loads Dancing Script explicitly, then a short delay before `page.pdf()` so the script face renders. **On-screen** agreement/invoice preview sheets use **`--font-document`** (Barlow stack) on scoped containers so typography matches PDF while the app `body` uses Outfit.
- **Raw `App.css` in PDF HTML:** The client inlines raw `App.css` into PDF HTML. **Light document tokens** in `:root` (`--text-primary`, `--agreement-*`, etc.) must stay valid for markup; Forge shell tokens are additive. If legacy document variables are ever switched to dark semantics, **pin light values** in `buildPdfHtml` after the inlined CSS.
- **Viewport**: PDF generation uses **`page.setViewport({ width: 816, height: 1056 })`** (Letter at
  96dpi) so layout is consistent regardless of client screen size.
- **Preview (native 816 + optional desktop upscale)**: Sheet HTML is **816px** wide with **no
  shrink-to-fit transform** (matches PDF). **`.agreement-preview-stage`** is **`width: 100%`**,
  **`max-width: 816px`**, centered. From **`min-width: 1024px`**, if **`.agreement-preview-measure`**
  is wider than **816px**, JS sets **`transform: scale(min(parentWidth / 816, 1.5))`** on
  **`.agreement-preview-upscale`** (`transform-origin: top center`); stage **`min-height`** =
  **`nativeHeight × scale`**. **`ResizeObserver`** on the measure node + **`matchMedia`** keep scale
  in sync. **`overflow-x: auto`** on the measure when needed; page scroll stays in **`app-main`**.
  Print CSS removes upscale and uses full-width sheet layout.
- **Header and footer** (explicit left/right document labels, Confidential, footer
  `Service Provider - [business name]`, phone when present, page numbers) use Puppeteer
  `displayHeaderFooter` with `headerTemplate` / `footerTemplate` — they are **not** duplicated in
  the document body HTML. Footer uses `business_profiles.business_name` (not owner/welder name).
  `POST /api/pdf` accepts **`headerLeft`** and **`headerRight`**. Work Order PDFs send
  `headerLeft: "Work Order #0007"` and blank `headerRight`; Invoice PDFs send
  `headerLeft: "Invoice #0001"` and `headerRight: "WO #0007"` when available; Change Orders use
  `headerLeft` for CO and `headerRight` for WO. Legacy `marginHeaderLeft` / `workOrderNumber`
  remain fallback inputs only for older callers during the transition.
- **Body** includes the centered **Work Order** title, numbered sections, tables, and signatures
  only. Section 1 uses **plain-text** Agreement Date and Job Site Address (blue label, black value,
  no table box). **Job site** is rendered as a **single line** in agreement output (`jobLocationSingleLine`), even when the form stores a multiline `job_location`. Then a **3-column party table** (row labels | Service Provider | Customer): header
  row is all light-blue cells; **Name**, **Phone**, and **Email** label cells match other agreement
  tables; values are white. Profile fills the SP column; the form fills the customer column.
- **Optional sections**: Exclusions and Customer Obligations omit when the **job** lists have no
  non-empty lines (profile defaults are copied into **new** drafts only; clearing the form removes
  the section from preview/PDF). **Change Orders & Hidden Damage** omits when both
  `change_order_required` and `hidden_damage_possible` are false; each checkbox adds only its clause.
  If that section is omitted and workmanship warranty is 0, the completion opening appears under
  **Completion & Acceptance** instead. Workmanship Warranty (days is 0) and Dispute Resolution
  (negotiation days is 0) omit similarly. **Section numbers are assigned at render time** (1…n with
  no gaps); the signature block stays unnumbered.
- **Governing state** on the job is synced from **job site state** (`governing_state`); dispute copy references governing law using that value when present.

### Download & Save (`saveWorkOrder` in `jobs.ts` + `AgreementPreview.tsx`)
- **Order:** The **first** click on Download & Save per preview mount runs **`saveWorkOrder`**
  (insert if no **`existingJobId`**, else update). Later clicks on the same mount **skip** the DB and
  only run **`fetchPdfBlob`** + **`downloadPdfBlob`** (no duplicate job rows from repeat downloads).
  Save failure → **no** PDF request and **no** download. If save succeeds but PDF fails, the user sees
  a **“Work order saved, but PDF failed…”** message and **`onSaveSuccess`** still runs (profile
  **`next_wo_number`** bump on new inserts only).
- **Clients:** Before the job row is written, the app **upserts** a **`clients`** row keyed by
  **`name_normalized`** (`lower(trim(name))`) with display **`name`** trimmed; **`jobs.client_id`**
  is set to that client’s id. This behavior is part of the current schema; see the applied
  migrations in `supabase/migrations/` rather than a standalone `0004_clients_name_normalized.sql`
  file.
- **WO number:** **`wo_number`** is included only on **insert**; **updates** omit it so the stored
  WO# cannot be overwritten from the client. New drafts get it from **`next_wo_number`**. It is
  **not** on the edit form. **Preview** has no document title; Puppeteer **`headerTemplate`** prints
  **WO#** in the PDF margin header.

## Folder Structure

```
scope-lock/
├── public/
│   ├── ironwork_symbol_forgeblock.svg # Canonical icon source
│   ├── manifest.webmanifest         # iOS / Android / PWA install metadata
│   └── sw.js                        # Minimal same-origin app-shell service worker; no JS/CSS chunk caching
├── src/
│   ├── components/
│   │   ├── AuthPage.tsx              # Sign-in only (email + password)
│   │   ├── BusinessProfileForm.tsx   # Signed-in user with no profile row (edge case)
│   │   ├── CaptureModal.tsx          # Anonymous first Download & Save / Send: account + optional defaults opt-in
│   │   ├── ClientsPage.tsx           # Saved clients list with inline contact editing + work-order activity context
│   │   ├── EditProfilePage.tsx       # Edit profile + agreement defaults
│   │   ├── HomePage.tsx              # Guest marketing landing + signed-in dashboard (`get_work_orders_dashboard_summary` + first page of `list_work_orders_dashboard_page`; recent WO rows share Work Orders dashboard card layout + chips via `work-order-dashboard-display`, without the create-invoice CTA)
│   │   ├── LandingPreviewModal.tsx   # Full-document lightbox for landing PDF placeholders (WO / invoice)
│   │   ├── WorkOrdersPage.tsx        # Work-order list + signature/invoice filters; row opens detail, row footer opens change-orders section
│   │   ├── WorkOrderDetailPage.tsx   # Saved job → agreement + change orders + PDFs + e-sign / offline-sign actions
│   │   ├── ChangeOrderWizard.tsx     # Create/edit change order (3 steps; saves + sends to DocuSeal on finish)
│   │   ├── ChangeOrderDetailPage.tsx # Saved CO → HTML/PDF + e-sign / offline-sign actions + timeline
│   │   ├── AgreementDocumentSections.tsx # Renders AgreementSection[] (preview + detail + PDF body)
│   │   ├── InvoiceWizard.tsx         # Single WO invoice steps (pricing, due date, payment methods + billable CO picker)
│   │   ├── InvoiceFinalPage.tsx      # Final invoice detail; PDF actions + send/payment-link issuance gate
│   │   ├── InvoicePreviewModal.tsx   # Full-screen letter-sheet preview overlay (invoice final, WO detail, CO detail)
│   │   ├── JobForm.tsx               # Work Agreement form (structured job site, Geoapify optional)
│   │   └── AgreementPreview.tsx      # Preview + Download & Save + PDF; hosts CaptureModal when anonymous
│   ├── data/
│   │   └── sample-job.json           # Fallback defaults for new agreements
│   ├── hooks/
│   │   ├── useAppNavigation.ts       # URL/history-backed view state
│   │   ├── useAuth.ts                # Auth state hook (Supabase session)
│   │   ├── useAuthProfile.ts         # Profile loading + capture redirect handling
│   │   ├── useChangeOrderFlow.ts     # Detail/wizard/detail navigation for COs
│   │   ├── useInvoiceFlow.ts         # Work-order invoice wizard/final page flow state
│   │   ├── useScaledPreview.ts       # 816px preview scaling for WO/invoice mini previews
│   │   └── useWorkOrderDraft.ts      # New/edit draft state + next_wo_number refresh path
│   ├── lib/
│   │   ├── supabase.ts               # Supabase client singleton
│   │   ├── auth.ts                   # signUp / signIn / signOut helpers
│   │   ├── agreement-generator.ts    # Pure domain logic: agreement section model
│   │   ├── agreement-sections-html.ts # Agreement body HTML string (combined WO+CO PDFs)
│   │   ├── html-escape.ts            # esc() for generator HTML strings
│   │   ├── change-order-generator.ts # Change order HTML + combined WO + listed COs
│   │   ├── change-order-document.css # PDF/preview scoped styles for .change-order-document (imported ?raw by agreement-pdf.ts)
│   │   ├── agreement-pdf.ts          # PDF HTML wrapper + fetch/download blob (Puppeteer)
│   │   ├── job-site-address.ts       # Multiline job_location, parse for client autofill, single-line PDF
│   │   ├── us-phone-input.ts         # US phone mask (JobForm + EditProfilePage)
│   │   ├── geoapify-autocomplete.ts  # Job site suggestions (optional API key)
│   │   ├── job-to-welder-job.ts      # Job row + profile → WelderJob for generator/PDF
│   │   ├── invoice-generator.ts      # Pure HTML for invoice body (preview + PDF)
│   │   ├── work-order-signature.ts   # Shared signature-satisfied helper (DocuSeal completed vs offline-signed)
│   │   ├── change-order-signature.ts # Shared CO signature/billable helper (DocuSeal completed vs offline-signed)
│   │   ├── docuseal-agreement-html.ts     # DocuSeal HTML for work order (embedded CSS + field tags; esc())
│   │   ├── docuseal-change-order-html.ts  # DocuSeal HTML for change order (embedded CSS + field tags; esc(); optional SP signature PNG)
│   │   ├── docuseal-header-footer.ts      # html_header / html_footer strings for DocuSeal submissions
│   │   ├── docuseal-constants.ts          # Shared DocuSeal role name(s)
│   │   ├── docuseal-signature-image.ts    # Render DocuSeal SP signature image
│   │   ├── esign-api.ts                   # send/resend WO and CO for signature (app server API)
│   │   ├── stripe-connect.ts              # Authenticated Stripe Connect start/status helpers
│   │   ├── esign-labels.ts                # E-sign status strings for UI
│   │   ├── esign-live.ts                  # E-sign timestamp formatting for detail UI
│   │   ├── esign-progress.ts              # Shared e-sign step/tone model for detail timeline + list strip
│   │   ├── fetch-with-supabase-auth.ts    # Same-origin fetch with Bearer from Supabase session
│   │   ├── guest-agreement-profile.ts     # BusinessProfile-shaped stub from guest form fields for preview
│   │   ├── owner-name.ts                  # Normalize owner full name for profile + preview stubs
│   │   ├── defaults.ts                    # Payment/warranty/exclusion default constants
│   │   ├── invoice-line-items.ts          # Invoice line item parsing, validation, source types
│   │   ├── payment-terms.ts               # Payment terms presets + validators
│   │   ├── work-order-list-label.ts       # Job type display formatting for Work Orders list
│   │   ├── payment-methods.ts, tax.ts
│   │   └── db/
│   │       ├── profile.ts            # getProfile, upsertProfile, updateNextWoNumber (counter patch)
│   │       ├── clients.ts            # listClients / listClientItems / upsertClient / deleteClient (JobForm search + Clients page)
│   │       ├── jobs.ts               # listJobs, saveWorkOrder, dashboard page/summary RPC mapping, create/update/delete
│   │       ├── change-orders.ts      # list/create/update/delete change orders; computeCOTotal
│   │       └── invoices.ts           # createInvoice (RPC counter), updateInvoice, list/get, issuance tracking
│   ├── types/
│   │   ├── index.ts                  # WelderJob, AgreementSection, SignatureBlockData
│   │   ├── db.ts                     # BusinessProfile, Client, Job, ChangeOrder (+ esign_* fields)
│   │   └── capture-flow.ts           # CaptureFlow type for anonymous capture modal
│   ├── App.tsx                       # Root component - view state machine + lazy-loaded document/dashboard screens
│   ├── boot.ts                       # Production cache recovery before loading the app entry
│   └── main.tsx                      # React entry point + service worker registration
├── server/
│   ├── app-server.mjs               # App server + /api/pdf + e-sign + Stripe + invoice routes
│   ├── stripe-routes.mjs            # Stripe Connect start/status, payment-link, Stripe webhook
│   ├── invoice-routes.mjs           # POST /api/invoices/:id/send; POST /api/invoices/:id/mark-paid-offline; POST /api/invoices/:id/unmark-paid-offline; email PDF + optional payment link; WO signature gate; `issued_at` on first send
│   ├── esign-routes.mjs             # JWT send/resend; webhook + service-role e-sign updates
│   ├── docuseal-esign-state.mjs     # DocuSeal submission → shared esign_* patch fields
│   └── lib/
│       ├── stripe.mjs               # Stripe SDK helpers: account creation (capabilities + MCC), payment links, webhook verification
│       ├── logger.mjs               # Structured JSON logger (log.info / log.warn / log.error)
│       └── rate-limit.mjs           # Per-IP rate limiter for PDF, e-sign send/resend, invoice send, Connect start
├── supabase/
│   ├── config.toml                   # Supabase CLI config
│   └── migrations/
│       ├── 0001_initial_schema.sql
│       ├── 0002_invoices.sql
│       ├── 0003_cash_app_normalization.sql
│       ├── 0004_default_tax_rate.sql
│       ├── 0005_change_orders.sql    # structured COs + backfill + legacy next_co_number helper
│       ├── 0006_change_order_creation_lock.sql # atomic create_change_order RPC with advisory lock
│       ├── 0007_structured_payment_terms.sql  # payment_terms_days + late_fee_rate on profiles & jobs
│       ├── 0008_block_co_after_job_invoice.sql # RPC guard: no new COs after finalized WO invoice
│       ├── 0009_jobs_other_classification.sql  # persist "Specify" text when job type is Other
│       ├── 0010_jobs_esign.sql                 # DocuSeal esign_* columns on jobs
│       ├── 0011_jobs_esign_status_check.sql    # CHECK constraint on jobs.esign_status
│       ├── 0012_jobs_inflight_esign_by_user_created_at.sql  # index for in-flight WO e-sign queries
│       ├── 0013_change_orders_esign.sql        # DocuSeal esign_* columns + constraint + index on change_orders
│       ├── 0014_work_orders_dashboard.sql      # list_work_orders_dashboard RPC (used for targeted row refresh)
│       ├── 0015_work_orders_dashboard_page.sql # list_work_orders_dashboard_page + get_work_orders_dashboard_summary RPCs
│       ├── 0016_invoices_esign_and_issuance.sql # invoices.issued_at + legacy DocuSeal esign_* columns
│       ├── 0017_remove_invoice_esign.sql       # drops invoice-specific esign_* columns; keeps issued_at
│       ├── 0018_stripe_scaffolding.sql         # stripe_account_id + stripe_onboarding_complete on business_profiles; stripe_payment_link_id, stripe_payment_url, payment_status CHECK ('unpaid'|'paid'|'offline'), paid_at on invoices
│       ├── 0019_work_orders_dashboard_invoice_payment_status.sql # latest_invoice JSON includes payment_status for dashboard actions
│       ├── 0020_esign_resent_at.sql            # esign_resent_at on jobs and change_orders for durable resend state
│       ├── 0021_jobs_offline_signed_at.sql     # offline_signed_at on jobs for manual paper signatures
│       ├── 0022_update_work_orders_rpcs_offline_signed.sql # dashboard RPCs expose offline_signed_at for list + row refresh
│       ├── 0023_dashboard_payment_status.sql
│       ├── 0024_landing_email_captures.sql     # marketing email capture; RLS: anon + authenticated INSERT only (no public SELECT)
│       ├── 0025_dashboard_summary_offline_mixed_invoices.sql # shared job-level invoice line-item classifier + mixed invoice dashboard summary
│       ├── 0026_prevent_duplicate_job_level_invoices.sql # trigger blocks future duplicate job-level invoices; dashboard RPCs use shared classifier
│       └── 0027_change_orders_offline_sign_and_invoice_gate.sql # CO offline_signed_at + invoice trigger rejects CO-only / unsigned CO billing
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── ARCHITECTURE.md
```

## App Navigation Flow

```
User visits app
      ↓
[Anonymous] → HomePage → JobForm → AgreementPreview
      (Header: Sign In only; no Work Orders / gear)
      ↓
First Download & Save → CaptureModal → signUp + upsertProfile (+ optional WO-derived defaults) + saveWorkOrder + PDF
      ↓
[Signed in, no profile row] → BusinessProfileForm (rare edge case)
      ↓
[Signed in + profile] → HomePage (dashboard summary + recent WOs; rows match Work Orders list layout/chips, no invoice button on row; open WO detail; **Back** from detail opened here still returns to Work Orders until a `backTarget` stack exists)
      ↓
Clients → ClientsPage (saved clients; real-time search on name/phone/email/address; inline edit for phone/email/address only)
      ↓
Work Orders → WorkOrdersPage → row → WorkOrderDetailPage (agreement + change orders + PDFs + offline-sign controls)
                     → View & Create Change Orders → WorkOrderDetailPage change-orders section
                     → Change Order → ChangeOrderWizard → detail (refresh list; CO detail also supports offline-sign / undo)
                     → Invoice → InvoiceWizard (single WO invoice; signed/offline-signed CO lines only) → InvoiceFinalPage (PDF + send/payment-link issuance gate; back returns to Work Orders)
      ↓
Invoices → InvoicesPage (standard job-level invoices only; legacy CO-only rows hidden from normal UI) → InvoiceFinalPage (back returns to Invoices list)
      ↓
Create Work Order → JobForm → Preview tab → AgreementPreview (Download & Save / PDF)
      ↓
Header Sign In → AuthPage (email + password only)
      ↓
Edit profile (gear) → EditProfilePage
```

### Auth and profile (behavior summary)

- **Session:** Supabase email/password; session stored by the Supabase client (survives refresh).
- **New contractors:** Primary signup path is **CaptureModal** on first **Download & Save** or anonymous **Save & Send for Signature** (`signUp` + initial `upsertProfile` + `saveWorkOrder`, then PDF or e-sign send). Capture includes an optional **Save defaults?** checkbox that, when left on, seeds profile exclusions, customer obligations, warranty, negotiation, and payment defaults from the current work order. Stored empty default arrays are now treated as intentionally empty rather than falling back to the system bullet lists.
- **Returning users:** **AuthPage** is sign-in only (email + password).
- **Missing profile row** while signed in: **BusinessProfileForm** blocks the rest of the app until `business_profiles` exists.
- **Profile data** (defaults, counters, payment methods, tax, etc.) lives in **`business_profiles`**; jobs, clients, invoices, and change orders are separate tables with RLS. See **What Is and Isn't Persisted** below.
- **Clients page enrichment:** The app reads editable client fields from **`clients`** and derives list context from related **`jobs`** by **`client_id`**. The displayed count is **all linked jobs**; latest activity uses the most recent job **`agreement_date`** when present, otherwise that job’s **`created_at`**.
- **Stripe Connect entrypoint:** **Edit Profile** owns the Stripe onboarding CTA. The CTA is a separate `type="button"` action, not a second form submit: it saves the profile first, then starts Stripe onboarding if save succeeds.

## Domain Logic vs UI Logic

### Domain Logic (`src/lib/agreement-generator.ts`)
- Pure functions with no side effects
- Agreement text generation from job data
- No React or Supabase dependencies
- Testable in isolation

### Auth + DB Layer (`src/lib/`)
- `supabase.ts`: Supabase client, reads env vars
- `auth.ts`: Thin wrappers over `supabase.auth`
- `db/profile.ts`: Profile CRUD; **`updateNextWoNumber`** uses `.update()` (partial `upsert` 400s on `business_profiles` because `business_name` is NOT NULL)
- `db/clients.ts`: Client CRUD + enriched client-list query; **JobForm** searches/suggests clients when `userId` is set; **ClientsPage** lists/edits saved contact fields; **saveWorkOrder** upserts client by `name_normalized`
- `db/jobs.ts`: Job CRUD + **saveWorkOrder** (insert/update, client upsert); UI lists jobs on **Work Orders**
- `db/invoices.ts`: Invoice CRUD; **`createInvoice`** calls Postgres **`next_invoice_number(p_user_id)`** for atomic numbering (increments `business_profiles.next_invoice_number`); **`updateInvoice`** full-row overwrite; **`mapInvoiceRow`** normalizes **`line_items[].source`**; invoice business state derives from **`issued_at`** (no invoice row → `Invoice`, `issued_at = null` → `Draft`, `issued_at != null` → `Invoiced`). A DB trigger allows only one **job-level** invoice per work order and rejects standalone CO invoices or invoice rows that bill unsigned change orders. Normal invoice list/dashboard UI hides legacy CO-only rows that predate this rule. Offline paid status is server-controlled by `mark-paid-offline` / `unmark-paid-offline` routes; **mark-paid-offline is allowed for draft or invoiced invoices** (no `issued_at` requirement); undo is allowed only while `payment_status = 'offline'`. **`POST /api/invoices/:id/mark-downloaded`** sets `downloaded_at` after a successful PDF download (same signature + CO gates as first-time send, idempotent if already downloaded); invoice send is the only path that sets `issued_at`. **`listInvoiceStatusByJob`** skips malformed rows and returns a non-blocking warning instead of disabling all invoice actions
- `db/change-orders.ts`: **`listChangeOrders`**, **`createChangeOrder`** (RPC to **`public.create_change_order`**: per-job advisory lock + `MAX(co_number)+1` in SQL; rejects when an **issued job-level** invoice exists for the job), **`updateChangeOrder`**, **`deleteChangeOrder`**, **`computeCOTotal`**. Change orders now also track **`offline_signed_at`** so billing/UI can treat paper-signed COs as approved/signature-satisfied.
- `invoice-generator.ts`: Invoice HTML (parties table pattern, line items, tax, payment methods, notes)

### UI Components (`src/components/`)
- React components for user interaction
- Form state management
- Mobile-first responsive design

### Type Definitions (`src/types/`)
- `index.ts`: WelderJob and agreement types (used by domain logic + UI)
- `db.ts`: Database row types matching Supabase schema (`Invoice`, `InvoiceLineItem`, `BusinessProfile.next_invoice_number`)

## Database Schema

Six tables in Supabase Postgres, all with row-level security:

| Table | Key Columns |
|---|---|
| `business_profiles` | user_id (unique), business_name, owner_name, phone, email, address, google_business_profile_url, default_exclusions[], default_assumptions[], default_tax_rate, default_payment_methods[], next_wo_number, next_invoice_number, stripe_account_id, stripe_onboarding_complete, … |
| `clients` | user_id, name, **name_normalized** (dedup key), phone, email, address, notes |
| `jobs` | user_id, client_id, all WelderJob fields, status, **esign_submission_id**, **esign_submitter_id**, **esign_embed_src**, **esign_status** (`not_sent`\|`sent`\|`opened`\|`completed`\|`declined`\|`expired`), esign_submission_state, esign_submitter_state, esign_sent/opened/completed/declined_at, esign_decline_reason, esign_signed_document_url, **offline_signed_at** |
| `change_orders` | user_id, job_id, **co_number** (per-job sequence, UNIQUE with job_id), description, reason, status (`draft` \| `pending_approval` \| `approved` \| `rejected`), **line_items** (jsonb), time_amount / time_unit / time_note, requires_approval, **esign_submission_id**, **esign_submitter_id**, **esign_embed_src**, **esign_status** (`not_sent`\|`sent`\|`opened`\|`completed`\|`declined`\|`expired`), esign_* timestamp/state columns, **offline_signed_at** — legacy `price_delta` / `time_delta` / `approved` were migrated in **0005** |
| `invoices` | user_id, job_id, invoice_number, invoice_date, due_date, legacy `status` (`draft` \| `downloaded`), **issued_at** (business issuance marker; set on **first successful** `POST /api/invoices/:id/send`, email-only or with payment link), **line_items** (jsonb; each row may include **`source`**: `original_scope` \| `change_order` \| `labor` \| `material` \| `manual` \| `legacy`; triggers enforce one standard job-level invoice per `user_id + job_id`, reject standalone CO invoices, and reject unsigned CO billing), tax fields, payment_methods (jsonb snapshot), notes, **stripe_payment_link_id**, **stripe_payment_url**, **payment_status** (`unpaid` \| `paid` \| `offline`; CHECK constraint), **paid_at** (set by Stripe webhook on payment completion) |
| `landing_email_captures` | email, source (default `landing_page`), created_at — **INSERT** allowed for `anon` and `authenticated`; no client **SELECT** (marketing list only via service role / dashboard) |

**Invoice numbering:** `public.next_invoice_number(uuid)` updates `business_profiles` in one statement and returns the allocated number (pre-increment value). No separate `updateNextInvoiceNumber` in app code.

Core domain tables use `auth.uid()` RLS policies: users can only read/write their own rows. **`landing_email_captures`** is the exception (anonymous landing-page signups only insert).

### Change orders (`0005_change_orders.sql`)

- Adds structured columns (`co_number`, `reason`, `status`, `line_items` jsonb, schedule fields, etc.).
- **Backfills** existing rows from legacy `price_delta` / `time_delta` / `approved`, assigns **`co_number`** per `job_id` with `ROW_NUMBER()`, then drops the legacy columns.
- **`UNIQUE (job_id, co_number)`**; numbering is allocated inside **`create_change_order`** (see **0006**), so a `23505` from the RPC is unexpected. The client may still show a generic “try again” if it occurs; there is **no** client-side insert retry loop.

### Combined WO + change-order PDFs (v1)

- Agreement body for PDF is built as an HTML **string** via **`agreementSectionsToHtml`** (mirrors **`AgreementDocumentSections`** markup), not from live DOM `outerHTML`.
- **`buildCombinedWorkOrderAndChangeOrdersHtml`** appends **`page-break-before: always`** and HTML for **each** change order in the array (caller supplies the list; no status filter inside this helper).
- Client uses **`fetchHtmlPdfBlob`** / **`downloadPdfBlobToFile`** in **`agreement-pdf.ts`** (same `/api/pdf` JSON shape as work orders and invoices).

### Invoice `line_items[].source`

- **`InvoiceLineItem.source`**: `original_scope` | `change_order` | `labor` | `material` | `manual` | `legacy`. **`mapInvoiceRow`** defaults missing/invalid to **`legacy`**.
- **New invoice:** **`InvoiceWizard`** loads change orders for the job, keeps them visible, and auto-selects only the signature-satisfied ones (DocuSeal `completed` or `offline_signed_at` set). Unsigned COs stay visible but disabled with a gate hint. Selected rows add **`change_order`** lines. All new built rows set **`source`**.
- **Edit invoice:** Partition by **`source`**. **`change_order`** rows (and **`legacy`** rows whose description matches **`/^Change Order #/`**) are **preserved**. Rows **`original_scope`**, **`labor`**, **`material`**, **`manual`** are **replaced** from wizard state on save. **Order:** **fixed** → rebuilt original scope then preserved CO lines; **T&M** → preserved CO lines then all labor lines then all material lines. **T&M** editing round-trips **all** labor and material lines (not only the first).

### Dashboard rollups

- **Home** shows four cards: **Work orders**, **WO's completed**, **Pending**, and **Paid**. `completedJobCount` comes from `get_work_orders_dashboard_summary` and means the latest standard job-level invoice is `paid` or `offline`; the money cards still come from the invoice-financial summary over **`invoices.total`**.
- **Invoices** shows only invoice-financial money cards from the same invoice summary: **Pending** and **Paid**.
- **Work Orders** shows work-order operational counts only: **Work orders** and **WO's signed**. `signedJobCount` includes DocuSeal-completed work orders and work orders marked signed offline.
- `0014_work_orders_dashboard.sql` remains applied and available for targeted row refresh by `job_id`; the main Work Orders list no longer relies on it for initial page load.
- **`list_work_orders_dashboard_page`** pages jobs by `(created_at DESC, id DESC)`, aggregates only the current page’s change orders and invoices, uses `DISTINCT ON (job_id)` for latest job-level invoice lookup, and returns:
  - `change_order_count`
  - `change_orders_preview` (first two COs; used for merge/poll payloads / preview context, not for list-row chip rendering)
  - `has_in_flight_change_orders`
  - `latest_invoice`
- **`get_work_orders_dashboard_summary`** runs separately from the page RPC for whole-dataset work-order count.
- Job-level invoice classification uses a guarded JSONB scan over **`invoices.line_items`**. Legacy CO-only invoices stay outside WO row status, while mixed or standard work-order invoices count as the job-level invoice for WO status.
- The Work Orders list reflects each page load from `list_work_orders_dashboard_page` (and “Load more”); it does **not** periodically refetch rows while the user stays on the dashboard.

## What Is and Isn't Persisted

| Feature | Persisted | Notes |
|---|---|---|
| Business profile | Yes | Supabase DB |
| Default exclusions/assumptions | Yes | Supabase DB, pre-populate new agreements |
| Auth session | Yes | Supabase session (survives refresh) |
| Work Agreement (current job) | In-memory while editing | **Download & Save** persists via `saveWorkOrder` |
| Invoices | Yes | Created at wizard step 3. IronWork now supports one standard work-order invoice per job; new standalone CO invoices are blocked, and unsigned COs cannot be billed until DocuSeal-completed or marked signed offline. Business state is **Draft** until **`issued_at`** is set by the **first successful invoice email send** (`POST /api/invoices/:id/send`), then **Invoiced** (UI displays as **Pending** on rows and **Sent** / **Sent via Stripe** on detail). First successful PDF download calls `POST /api/invoices/:id/mark-downloaded` to set **`downloaded_at`** (same signature + pending-CO gates as send) and drives a **Downloaded** chip while `issued_at` is null; it does not issue the invoice. Creating a payment link alone (`POST /api/stripe/invoices/:id/payment-link`) does **not** set `issued_at`. `payment_status` / `paid_at` are updated by the Stripe webhook for online payments, set to `offline` by `POST /api/invoices/:id/mark-paid-offline`, and reset to `unpaid` / `null` by `POST /api/invoices/:id/unmark-paid-offline` only when the current status is `offline`. **`InvoiceFinalPage`** refetches the invoice row once on mount so **Paid** reflects webhook updates when the user opens that screen; `WorkOrdersPage` and `WorkOrderDetailPage` use list/detail loads (no interval polling).  |
| Clients | Yes (rows) | Upsert on **Download & Save**; **JobForm** customer-name combobox searches when authenticated; **ClientsPage** edits saved `phone` / `email` / `address` only and does **not** rewrite historical jobs |
| Change orders | Yes | **ChangeOrderWizard** + detail page; **`create_change_order`** RPC allocates `co_number` under an advisory lock (see **0006**); no client-side retry loop |
| Completion signoffs | No | Schema only |

## Portability Considerations

### Current (Web MVP)

- **Browser:** React UI; Supabase client talks to Supabase for auth, Postgres (RLS), and RPCs.
- **Same host as UI:** PDF generation is **not** outsourced to a third-party API. The browser `POST`s rendered HTML + metadata to **`/api/pdf`** on the **same origin** as the SPA. Deployments must preserve that (single Node server, or reverse proxy routing both static assets and `/api/pdf` to the Node process).
- **Server process:** `server/app-server.mjs` is the only supported entry for local and production runs:
  - **Development:** `npm run dev` → Vite **middleware mode** inside the Node server + `POST /api/pdf`.
  - **Production:** `npm run preview` (or `NODE_ENV=production node server/app-server.mjs`) serves **`dist/`** after `npm run build`, still with `POST /api/pdf`.
- **Chrome/Chromium:** Puppeteer **Core** launches a **system** binary (`PUPPETEER_EXECUTABLE_PATH`, `CHROME_PATH`, or default `/usr/bin/google-chrome-stable`). The PDF route will not work without it.
- **Work order drafts** are in-memory until **Download & Save**; saved jobs live in `jobs` and appear on **Work Orders**.
- **Health:** `GET /api/pdf/health` returns `{ ok: true }` for simple readiness checks.

### Future (Capacitor iOS/Android)
- Can be wrapped with Capacitor
- Supabase JS SDK works in Capacitor environments
- React components are already mobile-first

### Migration Path to Capacitor
1. Install Capacitor: `npm install @capacitor/core @capacitor/cli`
2. Initialize: `npx cap init`
3. Add platforms: `npx cap add ios`
4. Wrap existing React app (no major refactoring)
5. Add native plugins as needed

## Roadmap

### Top priorities (current focus)

1. **Deploy to production**
2. **Custom branding**
3. **ACH / bank payments** (Stripe Connect + payment links are shipped; ACH is next)

The checkbox sections below track shipped work and the longer backlog; the three items above are the **near-term product focus** regardless of where they also appear.

### Completed
- [x] Job input form (Work Agreement)
- [x] Agreement text generation
- [x] Agreement preview
- [x] PDF download with named file
- [x] Print support
- [x] Mobile-first UI
- [x] Email/password authentication
- [x] Open product + capture-on-save account creation
- [x] Business profile persistence
- [x] Default exclusions/assumptions saved to profile
- [x] Authenticated landing page (Home)
- [x] Edit Profile page
- [x] Work Orders list + saved job detail + re-download PDF
- [x] Job + client persistence on Download & Save
- [x] Clients tab with inline saved-client management

### Near-Term
- [x] Research standard welder work agreements/ contracts and edit ours to match
- [x] Generate Invoice flow from work orders (wizard + PDF + persisted invoices)
- [x] DocuSeal e-sign for work orders and change orders (send/resend, webhook, on-enter status sync, progress timeline)
- [x] Stripe Connect Express onboarding (Edit Profile CTA, return/refresh flow, status reconciliation)
- [x] Stripe invoice payment links (create, copy, webhook-driven `payment_status` / `paid_at`)
- [ ] Deploy the app server and Puppeteer route alongside production hosting
- [x] Richer client management UI (beyond JobForm search + save-time upsert)
- [ ] Custom branding (logo)

### Later
- [ ] Multiple agreement templates
- [x] Change order flow (persisted COs, wizard, PDFs, invoice integration)
- [ ] Work Orders rollups from invoice totals (Option A)
- [ ] Completion signoff (schema exists)
- [ ] ACH / bank payments (Stripe Connect + payment links already shipped)
- [ ] Capacitor iOS/Android packaging

## Design Principles

1. **Mobile-First**: Optimized for phone screens, touch-friendly
2. **Minimal**: No unnecessary features or complexity
3. **Fast**: Quick to load, quick to complete a job
4. **Clear**: Readable agreements, simple language
5. **Portable**: Easy to deploy, easy to package

## Development Guidelines

- Use TypeScript for all new code
- Keep components small and focused
- Prefer pure functions for business logic
- No external state management libraries (React state is sufficient)
- Mobile-first CSS (start with mobile, add desktop styles)
- All new tables must include RLS policies
- DB helpers go in `src/lib/db/`

### Frontend file conventions

- Co-locate page/component styles with the page or component that owns them.
- `src/App.css` is reserved for global design tokens, app shell/layout primitives, shared utility classes, and print/PDF-global rules.
- Shared UI primitives reused across multiple surfaces, such as the mini e-sign strip used by Work Orders rows and Change Order rows, are valid `App.css` exceptions.
- Do not add new page-specific or feature-specific sections to `src/App.css`.
- New pages and major components should import their own CSS file (for example `WorkOrdersPage.tsx` + `WorkOrdersPage.css`).
- If a style is only used by one page/component, keep it with that page/component rather than promoting it to a global stylesheet.
- Shared utility logic belongs in `src/lib/`; avoid duplicated helper functions across generators when one utility can keep behavior consistent.
- HTML escaping for generated strings lives in `src/lib/html-escape.ts` (`esc`); agreement, change-order, and invoice generators import it—do not reintroduce parallel `escapeHtml` / local `esc` copies.

## Environment Variables

```
VITE_SUPABASE_URL=      # Supabase project URL
VITE_SUPABASE_ANON_KEY= # Supabase anon (public) key
VITE_GEOAPIFY_API_KEY=  # optional — job site autocomplete
VITE_UMAMI_WEBSITE_ID=  # optional — Umami analytics (`index.html` script tag)
```

Copy `.env.example` to `.env.local` and fill in values from the Supabase dashboard (Project Settings → API).

## Running the Application

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Applying Migrations

```bash
# Apply via Supabase CLI
npx supabase db push

# Or paste migration SQL directly in Supabase Dashboard → SQL Editor
```

## Deployment

IronWork is **not** deployable as a static export only. The product contract includes **Download PDF** for work orders, invoices, change orders, and combined documents; all of those use **`POST /api/pdf`** on the app server.

### Runtime checklist

1. **Build the client** with production env: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and optional `VITE_GEOAPIFY_API_KEY`) in the environment used by `npm run build`, then run **`npm run build`**.
2. **Start the Node server** with **`NODE_ENV=production`** so it serves **`dist/`** instead of Vite dev middleware. **`npm run preview`** does this; alternatively `NODE_ENV=production node server/app-server.mjs`.
3. **Install Chrome or Chromium** on the host (or container image) and set **`PUPPETEER_EXECUTABLE_PATH`** or **`CHROME_PATH`** if the default **`/usr/bin/google-chrome-stable`** is wrong (common on macOS, Windows, Alpine, or minimal CI images).
4. **Bind address:** default **`HOST=127.0.0.1`** is fine locally; for containers and PaaS, set **`HOST=0.0.0.0`** and the platform’s **`PORT`**.
5. **Reverse proxy:** Terminate TLS in front of this process if needed; route **both** static assets and **`/api/pdf`** to the same Node listener (or equivalent path-preserving upstream) so relative `/api/pdf` requests from the browser succeed.
6. **Readiness:** Use **`GET /api/pdf/health`** to verify the HTTP server is up; a full PDF smoke test confirms Chrome launch and Puppeteer.

### Common mistakes

- Serving only **`dist/`** from nginx/S3/Netlify **without** a compatible **`POST /api/pdf`** implementation — PDF buttons will fail or return errors.
- Building without **`VITE_*`** variables set — the bundle will have empty Supabase config.
- Omitting Chrome in Docker — add a package such as Chromium and point **`PUPPETEER_EXECUTABLE_PATH`** at the installed binary (the server already passes `--no-sandbox` / `--disable-setuid-sandbox` for typical container use).

See **[README.md](./README.md)** for a concise operator-facing summary and env var tables.
