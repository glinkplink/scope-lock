# ScopeLock Architecture

## Agent documentation & living documents

**Canonical short rules for all agents:** **[AGENTS.md](./AGENTS.md)**.

**Detailed project context:** **[CLAUDE.md](./CLAUDE.md)**.

**Cursor enforcement:** **[.cursor/rules/ScopeLock-Project-Rules.mdc](./.cursor/rules/ScopeLock-Project-Rules.mdc)** and **[.cursor/rules/high-priority.mdc](./.cursor/rules/high-priority.mdc)**.

`AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and those Cursor rule files are **living documents** and should stay aligned.

- **After each substantive code change** that affects architecture, deployment, system boundaries, routes, patterns, stack/dependencies, or cross-cutting implementation conventions, update whichever of these files are affected.
- **When editing any of these agent-facing files**, compare the same topic across the others and keep them aligned, especially for architecture/deployment constraints, CSS co-location, HTML/`esc()` rules, and minimal-diff/file-discipline guidance.
- `AGENTS.md` remains the first-stop rules file; this document is the deeper system and deployment reference.

## Product Purpose

ScopeLock helps independent welders quickly generate short, professional job agreements for small jobs. The goal is to prevent disputes, clarify scope, and protect the welder from being blamed for issues outside their work.

The generated document is a concise 1–3 page agreement, not a long legal contract.

### Target Users (For MVP)
- Independent welders
- Small welding shops
- Mobile welders doing repair or fabrication jobs

### Primary Workflow
A contractor can **start a work order without signing in**. They fill the job form and preview the agreement; on first **Download & Save** they create an account (business name, email, password) and the work order is persisted. Returning users sign in from the header, then use **Work Orders**, **Invoices**, and **Edit profile** as needed. Profile defaults (exclusions, warranty, payment methods, etc.) apply to **new** drafts after they exist in `business_profiles`.

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
  The frontend sends the rendered agreement HTML to the app's `/api/pdf` route so Chrome can
  render the file with much closer parity to the on-screen preview.

### E-sign (DocuSeal)

- **Routes (same app server as PDFs):** `POST /api/esign/work-orders/:jobId/send`, `POST /api/esign/work-orders/:jobId/resend`, `GET /api/esign/work-orders/:jobId/status`, `POST /api/esign/change-orders/:coId/send`, `POST /api/esign/change-orders/:coId/resend`, `GET /api/esign/change-orders/:coId/status`, `POST /api/webhooks/docuseal`, and `GET /api/webhooks/docuseal` (connectivity probe → `{ ok: true }`). DocuSeal must call the **public** webhook URL on the same host as the app.
- **Auth:** Send/resend require `Authorization: Bearer <Supabase access_token>`; the server verifies the JWT and ensures the target row belongs to that user before calling DocuSeal or writing with the **service role**. The webhook uses **`DOCUSEAL_WEBHOOK_HEADER_NAME`** + **`DOCUSEAL_WEBHOOK_HEADER_VALUE`** only (no Supabase session). The server compares those values using **SHA-256 digests** and `timingSafeEqual` (fixed-length compare; operators still configure the **raw** shared secret in env). After header checks, the handler **verify-on-receive**s via DocuSeal `GET /submissions/:id`, rejects stale correlations, then updates the matching **work order or change order `esign_*` fields**.
- **Send payload:** `POST .../send` accepts **exactly one** document entry; every `documents[i].html` (and optional `html_header` / `html_footer`) must be a string. Total UTF-8 size of those HTML fields is capped (**2 MiB**) before the DocuSeal request. Misconfigured server env for e-sign surfaces as **503** with a generic JSON body; unexpected handler failures return **500** with a generic message (details stay in server logs).
- **Resend:** V1 uses **`PUT /submitters/{esign_submitter_id}`** on the submitter id returned from the first send — not a second HTML submission for the same document. If DocuSeal replies that the submitter already completed, the server reconciles local `esign_*` fields from `GET /submissions/{esign_submission_id}` so the UI can self-heal from missed completion webhooks.
- **HTML:** The client builds DocuSeal-specific HTML in **`src/lib/docuseal-agreement-html.ts`** (work orders) and **`src/lib/docuseal-change-order-html.ts`** (change orders) — embedded styles + `esc()`; customer fields use DocuSeal HTML field tags; send payloads include contextual **email** `message` subject/body (contractor name, document reference, `{{submitter.link}}`). Optional canvas **SP signature** PNG (`docuseal-signature-image.ts`) is embedded for CO send/resend when provided. The server forwards those payloads to DocuSeal; it does not re-derive sections from raw rows.
- **Status poll:** `GET .../work-orders/:jobId/status` and `GET .../change-orders/:coId/status` (authenticated) fetch the DocuSeal submission, reconcile, and update **`jobs` / `change_orders`** so the UI can refresh without resend. Detail pages use this on a short timer while `esign_status` is in-flight; webhooks still update the same rows.
- **DB:** Migration **`0010_jobs_esign.sql`** adds **`jobs.esign_*`** columns; **`0011_jobs_esign_status_check.sql`** adds the status CHECK constraint; **`0012_jobs_inflight_esign_by_user_created_at.sql`** adds an index for in-flight polling; **`0013_change_orders_esign.sql`** adds matching **`change_orders.esign_*`** columns + constraint + index; **`0016_invoices_esign_and_issuance.sql`** adds **`invoices.issued_at`** for business issuance tracking. **`WorkOrderListJob.esign_status`** powers the work-orders list progress strip; work-order and change-order detail surfaces share the same Sent / Opened / Signed timeline card. Invoice business badges derive from `issued_at` (no e-sign tracking).
- **Hosted deploys (e.g. Render):** The Node process must have **`DOCUSEAL_API_KEY`**, **`SUPABASE_URL`**, **`SUPABASE_SERVICE_ROLE_KEY`**, and webhook header secrets in the **runtime** environment (dashboard env vars—not only `VITE_*` at build). Blueprint/`render.yaml` sync can overwrite dashboard-only vars if the YAML omits them. **End-to-end DocuSeal checks** (inbound email copy, signed PDF appearance, webhook delivery) use the **deployed** public URL and that environment; localhost can still run e-sign when `.env.local` is complete.

### Stripe Connect / payments

- **Routes (same app server as PDFs):** `POST /api/stripe/connect/start`, `GET /api/stripe/connect/status`, `POST /api/stripe/invoices/:invoiceId/payment-link`, and `POST /api/stripe/webhook`.
- **Auth:** Connect start/status and invoice payment-link routes require `Authorization: Bearer <Supabase access_token>`; the server verifies the JWT and loads the caller’s `business_profiles` row via the Supabase service role. The webhook does **not** use Supabase auth; it verifies the Stripe signature with `STRIPE_WEBHOOK_SECRET`.
- **Profile integration:** `business_profiles.stripe_account_id` stores the connected account id. `business_profiles.stripe_onboarding_complete` is reconciled from Stripe account state by `GET /api/stripe/connect/status` when the user returns from onboarding.
- **Return flow:** Stripe onboarding returns to `/?stripe_connect=return` and refresh uses `/?stripe_connect=refresh`. The client moves the user to **Edit Profile**, clears the query param from the URL, reloads profile state, and surfaces a status banner there.
- **Hosted deploys (e.g. Render):** The runtime environment must include **`STRIPE_SECRET_KEY`**, **`STRIPE_WEBHOOK_SECRET`**, and optionally **`APP_BASE_URL`** if forwarded headers are not sufficient to derive the public origin for Connect return links.

### PDF vs preview (`server/app-server.mjs` + `AgreementPreview.tsx`)
- **Web fonts**: PDF HTML includes the same Google Fonts `<link>`s as `index.html` (Barlow + **Dancing
  Script** for the Service Provider signature). The server waits for `document.fonts.ready`, loads
  Dancing Script explicitly, then a short delay before `page.pdf()` so the script face renders.
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
- **Header and footer** (Work Order # or optional **invoice** label, Confidential, footer
  `Service Provider - [business name]`, phone when present, page numbers) use Puppeteer
  `displayHeaderFooter` with `headerTemplate` / `footerTemplate` — they are **not** duplicated in
  the document body HTML. Footer uses `business_profiles.business_name` (not owner/welder name).
  Invoice PDFs send **`marginHeaderLeft`** (e.g. `Invoice #0001`) in the JSON body; when present it
  replaces the left header cell. Work Order PDFs omit it and keep **`workOrderNumber`** behavior.
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
├── src/
│   ├── components/
│   │   ├── AuthPage.tsx              # Sign-in only (email + password)
│   │   ├── BusinessProfileForm.tsx   # Signed-in user with no profile row (edge case)
│   │   ├── CaptureModal.tsx          # Anonymous first Download & Save / Send: account + optional defaults opt-in
│   │   ├── EditProfilePage.tsx       # Edit profile + agreement defaults
│   │   ├── HomePage.tsx              # Landing; Create Work Order
│   │   ├── WorkOrdersPage.tsx        # List jobs + invoice actions; row opens detail
│   │   ├── WorkOrderDetailPage.tsx   # Saved job → agreement + job-level invoice strip + change orders + PDFs + e-sign timeline
│   │   ├── ChangeOrderWizard.tsx     # Create/edit change order (3 steps; saves + sends to DocuSeal on finish)
│   │   ├── ChangeOrderDetailPage.tsx # Saved CO → HTML/PDF + e-sign actions + timeline
│   │   ├── AgreementDocumentSections.tsx # Renders AgreementSection[] (preview + detail + PDF body)
│   │   ├── InvoiceWizard.tsx         # Invoice steps (pricing, due date, payment methods)
│   │   ├── InvoiceFinalPage.tsx      # Final invoice detail; PDF actions + payment link placeholder
│   │   ├── InvoicePreviewModal.tsx   # Full-screen invoice preview overlay
│   │   ├── JobForm.tsx               # Work Agreement form (structured job site, Geoapify optional)
│   │   └── AgreementPreview.tsx      # Preview + Download & Save + PDF; hosts CaptureModal when anonymous
│   ├── data/
│   │   └── sample-job.json           # Fallback defaults for new agreements
│   ├── hooks/
│   │   ├── useAppNavigation.ts       # URL/history-backed view state
│   │   ├── useAuth.ts                # Auth state hook (Supabase session)
│   │   ├── useAuthProfile.ts         # Profile loading + capture redirect handling
│   │   ├── useChangeOrderFlow.ts     # Detail/wizard/detail navigation for COs
│   │   ├── useEsignPoller.ts         # Shared timer + visibility wiring for e-sign polling
│   │   ├── useInvoiceFlow.ts         # Invoice wizard/final page flow state
│   │   ├── useScaledPreview.ts       # 816px preview scaling for WO/invoice mini previews
│   │   ├── useWorkOrderDraft.ts      # New/edit draft state + next_wo_number refresh path
│   │   └── useWorkOrderRowActions.ts # Work Orders row hydration/open/invoice helpers
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
│   │   ├── docuseal-agreement-html.ts     # DocuSeal HTML for work order (embedded CSS + field tags; esc())
│   │   ├── docuseal-change-order-html.ts  # DocuSeal HTML for change order (embedded CSS + field tags; esc(); optional SP signature PNG)
│   │   ├── docuseal-header-footer.ts      # html_header / html_footer strings for DocuSeal submissions
│   │   ├── docuseal-constants.ts          # Shared DocuSeal role name(s)
│   │   ├── docuseal-signature-image.ts    # Render DocuSeal SP signature image
│   │   ├── esign-api.ts                   # send/resend WO and CO for signature (app server API)
│   │   ├── stripe-connect.ts              # Authenticated Stripe Connect start/status helpers
│   │   ├── esign-labels.ts                # E-sign status strings for UI
│   │   ├── esign-live.ts                  # Shared polling cadence + in-flight status helpers + timestamp formatting
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
│   │       ├── clients.ts            # listClients / upsertClient / deleteClient (JobForm search when authed)
│   │       ├── jobs.ts               # listJobs, saveWorkOrder, dashboard page/summary RPC mapping, create/update/delete
│   │       ├── change-orders.ts      # list/create/update/delete change orders; computeCOTotal
│   │       └── invoices.ts           # createInvoice (RPC counter), updateInvoice, list/get, issuance tracking
│   ├── types/
│   │   ├── index.ts                  # WelderJob, AgreementSection, SignatureBlockData
│   │   ├── db.ts                     # BusinessProfile, Client, Job, ChangeOrder (+ esign_* fields)
│   │   └── capture-flow.ts           # CaptureFlow type for anonymous capture modal
│   ├── App.tsx                       # Root component - view state machine + lazy-loaded document/dashboard screens
│   └── main.tsx                      # Entry point
├── server/
│   ├── app-server.mjs               # App server + /api/pdf + e-sign + Stripe routes
│   ├── stripe-routes.mjs            # Stripe Connect start/status, payment-link, Stripe webhook
│   ├── lib/stripe.mjs               # Stripe SDK helpers for accounts, payment links, webhook verification
│   ├── esign-routes.mjs             # JWT send/resend; webhook + service-role e-sign updates
│   └── docuseal-esign-state.mjs     # DocuSeal submission → shared esign_* patch fields
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
│       ├── 0012_jobs_inflight_esign_by_user_created_at.sql  # index for in-flight WO polling
│       ├── 0013_change_orders_esign.sql        # DocuSeal esign_* columns + constraint + index on change_orders
│       ├── 0014_work_orders_dashboard.sql      # list_work_orders_dashboard RPC (used for targeted row refresh)
│       ├── 0015_work_orders_dashboard_page.sql # list_work_orders_dashboard_page + get_work_orders_dashboard_summary RPCs
│       ├── 0016_invoices_esign_and_issuance.sql # invoices.issued_at + legacy DocuSeal esign_* columns
│       ├── 0017_remove_invoice_esign.sql       # drops invoice-specific esign_* columns; keeps issued_at
│       └── 0018_stripe_scaffolding.sql         # stripe_account_id + stripe_onboarding_complete on business_profiles; stripe_payment_link_id, stripe_payment_url, payment_status CHECK ('unpaid'|'paid'|'offline'), paid_at on invoices
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
[Signed in + profile] → HomePage; header: Work Orders, Edit profile (gear)
      ↓
Work Orders → WorkOrdersPage → row → WorkOrderDetailPage (agreement + job-level invoice strip + change orders + PDFs)
                      → Change Order → ChangeOrderWizard → detail (refresh list)
                      → Invoice → InvoiceWizard (optional CO lines on **new** invoices) → InvoiceFinalPage (PDF + payment link placeholder)
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
- `db/clients.ts`: Client CRUD; **JobForm** searches/suggests clients when `userId` is set; **saveWorkOrder** upserts client by `name_normalized`
- `db/jobs.ts`: Job CRUD + **saveWorkOrder** (insert/update, client upsert); UI lists jobs on **Work Orders**
- `db/invoices.ts`: Invoice CRUD; **`createInvoice`** calls Postgres **`next_invoice_number(p_user_id)`** for atomic numbering (increments `business_profiles.next_invoice_number`); **`updateInvoice`** full-row overwrite; **`mapInvoiceRow`** normalizes **`line_items[].source`**; invoice business state derives from **`issued_at`** (no invoice row → `Invoice`, `issued_at = null` → `Draft`, `issued_at != null` → `Invoiced`). PDF sharing is manual or via future payment links. **`listInvoiceStatusByJob`** skips malformed rows and returns a non-blocking warning instead of disabling all invoice actions
- `db/change-orders.ts`: **`listChangeOrders`**, **`createChangeOrder`** (RPC to **`public.create_change_order`**: per-job advisory lock + `MAX(co_number)+1` in SQL; rejects when an **issued job-level** invoice exists for the job), **`updateChangeOrder`**, **`deleteChangeOrder`**, **`computeCOTotal`**
- `invoice-generator.ts`: Invoice HTML (parties table pattern, line items, tax, payment methods, notes)

### UI Components (`src/components/`)
- React components for user interaction
- Form state management
- Mobile-first responsive design

### Type Definitions (`src/types/`)
- `index.ts`: WelderJob and agreement types (used by domain logic + UI)
- `db.ts`: Database row types matching Supabase schema (`Invoice`, `InvoiceLineItem`, `BusinessProfile.next_invoice_number`)

## Database Schema

Four tables in Supabase Postgres, all with row-level security:

| Table | Key Columns |
|---|---|
| `business_profiles` | user_id (unique), business_name, owner_name, phone, email, address, google_business_profile_url, default_exclusions[], default_assumptions[], default_tax_rate, default_payment_methods[], next_wo_number, next_invoice_number, stripe_account_id, stripe_onboarding_complete, … |
| `clients` | user_id, name, **name_normalized** (dedup key), phone, email, address, notes |
| `jobs` | user_id, client_id, all WelderJob fields, status, **esign_submission_id**, **esign_submitter_id**, **esign_embed_src**, **esign_status** (`not_sent`\|`sent`\|`opened`\|`completed`\|`declined`\|`expired`), esign_submission_state, esign_submitter_state, esign_sent/opened/completed/declined_at, esign_decline_reason, esign_signed_document_url |
| `change_orders` | user_id, job_id, **co_number** (per-job sequence, UNIQUE with job_id), description, reason, status (`draft` \| `pending_approval` \| `approved` \| `rejected`), **line_items** (jsonb), time_amount / time_unit / time_note, requires_approval, **esign_submission_id**, **esign_submitter_id**, **esign_embed_src**, **esign_status** (`not_sent`\|`sent`\|`opened`\|`completed`\|`declined`\|`expired`), esign_* timestamp/state columns — legacy `price_delta` / `time_delta` / `approved` were migrated in **0005** |
| `invoices` | user_id, job_id, invoice_number, invoice_date, due_date, legacy `status` (`draft` \| `downloaded`), **issued_at** (business issuance marker; set when first payment link is created), **line_items** (jsonb; each row may include **`source`**: `original_scope` \| `change_order` \| `labor` \| `material` \| `manual` \| `legacy`), tax fields, payment_methods (jsonb snapshot), notes, **stripe_payment_link_id**, **stripe_payment_url**, **payment_status** (`unpaid` \| `paid` \| `offline`; CHECK constraint), **paid_at** (set by Stripe webhook on payment completion) |

**Invoice numbering:** `public.next_invoice_number(uuid)` updates `business_profiles` in one statement and returns the allocated number (pre-increment value). No separate `updateNextInvoiceNumber` in app code.

All tables use `auth.uid()` RLS policies: users can only read/write their own rows.

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
- **New invoice:** **`InvoiceWizard`** loads change orders for the job; **all** are **selected** by default (uncheck to omit); selected rows add **`change_order`** lines. All new built rows set **`source`**.
- **Edit invoice:** Partition by **`source`**. **`change_order`** rows (and **`legacy`** rows whose description matches **`/^Change Order #/`**) are **preserved**. Rows **`original_scope`**, **`labor`**, **`material`**, **`manual`** are **replaced** from wizard state on save. **Order:** **fixed** → rebuilt original scope then preserved CO lines; **T&M** → preserved CO lines then all labor lines then all material lines. **T&M** editing round-trips **all** labor and material lines (not only the first).

### Work Orders dashboard rollups (Option B)

- **Invoiced** / **Pending Invoice** on **`WorkOrdersPage`** sum **`job.price`** only (original contract on the saved work order). They **do not** include change-order deltas or invoice totals. The summary strip is labeled **Contract value** so this is explicit. Using invoice totals for rollups (**Option A**) is deferred.
- `0014_work_orders_dashboard.sql` remains applied and available for targeted row refresh by `job_id`; the main Work Orders list no longer relies on it for initial page load.
- **`list_work_orders_dashboard_page`** pages jobs by `(created_at DESC, id DESC)`, aggregates only the current page’s change orders and invoices, uses `DISTINCT ON (job_id)` for latest job-level invoice lookup, and returns:
  - `change_order_count`
  - `change_orders_preview` (first two COs; used for merge/poll payloads, not list chips—the UI uses **`change_order_count`** only to show **View & Create Change Orders**)
  - `has_in_flight_change_orders`
  - `latest_invoice`
- **`get_work_orders_dashboard_summary`** runs separately from the page RPC so whole-dataset totals do not depend on the currently loaded page.
- Job-level invoice classification still uses a guarded JSONB scan over **`invoices.line_items`**: an invoice is job-level only when no line item has a non-empty `change_order_id`.
- While e-sign is in flight, the page polls only already-loaded rows and merges those updates without resetting pagination state.

## What Is and Isn't Persisted

| Feature | Persisted | Notes |
|---|---|---|
| Business profile | Yes | Supabase DB |
| Default exclusions/assumptions | Yes | Supabase DB, pre-populate new agreements |
| Auth session | Yes | Supabase session (survives refresh) |
| Work Agreement (current job) | In-memory while editing | **Download & Save** persists via `saveWorkOrder` |
| Invoices | Yes | Created at wizard step 3. Business state is **Draft** until `issued_at` is set (Stripe payment-link creation sets this), then **Invoiced**. `payment_status` (`unpaid`/`paid`/`offline`) and `paid_at` are set by the Stripe webhook; the **Paid** badge on `InvoiceFinalPage` renders from the prop — no in-page polling. Downloading the PDF does **not** transition invoice lifecycle. |
| Clients | Yes (rows) | Upsert on **Download & Save**; **JobForm** customer-name combobox searches when authenticated |
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
2. **Richer client management UI**
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

### Near-Term
- [x] Research standard welder work agreements/ contracts and edit ours to match
- [x] Generate Invoice flow from work orders (wizard + PDF + persisted invoices)
- [x] DocuSeal e-sign for work orders and change orders (send/resend, webhook, polling, progress timeline)
- [x] Stripe Connect Express onboarding (Edit Profile CTA, return/refresh flow, status reconciliation)
- [x] Stripe invoice payment links (create, copy, webhook-driven `payment_status` / `paid_at`)
- [ ] Deploy the app server and Puppeteer route alongside production hosting
- [ ] Richer client management UI (beyond JobForm search + save-time upsert)
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

ScopeLock is **not** deployable as a static export only. The product contract includes **Download PDF** for work orders, invoices, change orders, and combined documents; all of those use **`POST /api/pdf`** on the app server.

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
