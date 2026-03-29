# ScopeLock — CLAUDE.md

Work agreement generator for contractors (initially welders). Contractors fill out a job form and get a professional PDF agreement to send to clients.

---

## Agent documentation & living documents

**Canonical short rules for all agents:** **[AGENTS.md](./AGENTS.md)** (Codex and others should start there for shared repo rules).

**Cursor:** **[.cursor/rules/ScopeLock-Project-Rules.mdc](./.cursor/rules/ScopeLock-Project-Rules.mdc)** (full rules, `alwaysApply`) and **[.cursor/rules/high-priority.mdc](./.cursor/rules/high-priority.mdc)** (terse guardrails, `alwaysApply`).

**Architecture reference:** **[ARCHITECTURE.md](./ARCHITECTURE.md)** (system design, deployment constraints, portability, and roadmap detail).

`AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and those Cursor rule files are **living documents** and should describe the same project reality with different levels of detail.

- **After each substantive code change** (new UI, routes, patterns, stack or dependencies, security or style conventions), **review and update** whichever files are affected.
- **When editing any of these agent-facing files**, **compare the same topic across the others** and **align** them so guidance does not drift or contradict—especially **CSS co-location**, **HTML / `esc()`** (see below), **architecture / deployment constraints**, and **file-creation / minimal-diff discipline**.
- If a rule is intended to be global, mirror it in every file that carries global rules or replace duplication with a single explicit pointer. Do not let one file silently become stricter than the others.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | React 19 + TypeScript + Vite |
| Auth + DB | Supabase (email/password auth, Postgres, RLS) |
| App Server | Node **`server/app-server.mjs`**: Vite **middleware** (dev) or static **`dist/`** when `NODE_ENV=production`; loads **`.env`** then **`.env.local`** (`dotenv`) for server-only secrets |
| PDF | Puppeteer Core + **system Chrome**; all document PDFs via **same-origin** `POST /api/pdf` |
| E-sign | DocuSeal **HTML submissions** from the client; work-order and change-order **send/resend** plus authenticated **`GET .../status`** (DocuSeal sync), **`POST /api/webhooks/docuseal`** (see **ARCHITECTURE.md**) |
| Styling | Plain CSS (`index.css`, global `App.css`, and co-located component/page CSS files) — no Tailwind |
| Font | Barlow (+ Dancing Script for agreement signature) — field notebook aesthetic |

---

## Running the app

```bash
npm run dev       # one process: Vite (HMR) + SPA + POST /api/pdf + e-sign routes + DocuSeal webhook  (default http://127.0.0.1:3000)
npm run build     # tsc + vite bundle → dist/  (set VITE_* first for production builds)
npm run preview   # NODE_ENV=production: serve dist/ + /api/pdf + same API routes  — run build first
npm run lint      # eslint
```

**Client env** (Vite, `.env.local` — see `.env.example`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEOAPIFY_API_KEY=...   # optional — job site street autocomplete
```

**Server env** (read by `app-server.mjs` at runtime from `.env` / `.env.local`, not `VITE_`): `PUPPETEER_EXECUTABLE_PATH` or `CHROME_PATH` if default Chrome path is wrong; `PORT`, `HOST`; `NODE_ENV=production` for static `dist/` mode. For **DocuSeal** e-sign: `DOCUSEAL_API_KEY`, optional `DOCUSEAL_BASE_URL`, **`DOCUSEAL_WEBHOOK_HEADER_NAME`** + **`DOCUSEAL_WEBHOOK_HEADER_VALUE`** (raw secret in env; server compares **SHA-256** digests for fixed-length timing-safe compare — see **ARCHITECTURE.md**), **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`**. Missing DocuSeal/Supabase server keys on the **running** process → send/resend returns **503** with **`E-sign is temporarily unavailable.`** **Hosted** services (e.g. Render) must set these on the **web service** environment, not only `VITE_*` at build. Quick checks: `GET /api/pdf/health` → `{ "ok": true }`; `GET /api/webhooks/docuseal` → `{ "ok": true }`.

---

## Server, PDFs, deployment (reality check)

- **Not static-only hosting:** Work order, invoice, and change-order PDFs all need the **Node server** and a **local Chrome/Chromium** binary. The browser posts HTML to **`/api/pdf`** on the **same origin** as the UI. **DocuSeal** send/resend, **status** polling, and inbound **webhooks** use the same app server (`/api/esign/...`, `/api/webhooks/docuseal`).
- **Single entrypoint:** Use `npm run dev` or `npm run preview` / `NODE_ENV=production node server/app-server.mjs` — there is no supported “Vite-only” production path if you want working downloads.
- **Operator detail:** Env tables, reverse-proxy notes, and common deployment mistakes → **[README.md](./README.md)** and **[ARCHITECTURE.md](./ARCHITECTURE.md)** (Deployment + Portability).

---

## Project structure

```
src/
  App.tsx                    # Root — view state machine, auth-aware shell
  App.css                    # Global design tokens, app shell/layout, shared utilities, print/PDF globals
  index.css                  # Base reset + font stack
  components/
    AuthPage.tsx             # Sign-in only (email + password); header “Sign In”
    AuthPage.css             # AuthPage-only styles
    BusinessProfileForm.tsx  # Full-screen when signed in but no profile row (edge case)
    BusinessProfileForm.css  # BusinessProfileForm-only styles
    CaptureModal.tsx         # Anonymous Download & Save / Send: account fields + optional “Save defaults?” onboarding opt-in
    CaptureModal.css         # CaptureModal-only styles
    HomePage.tsx             # Home after login; “Create Work Order”
    HomePage.css             # HomePage-only styles
    JobForm.tsx              # Work agreement form (structured job site + Geoapify autocomplete); optional “Your Information” when no profile
    JobForm.css              # JobForm-only styles
    AgreementPreview.tsx     # Preview + Download & Save / Save & Send / PDF; hosts CaptureModal when anonymous
    AgreementPreview.css     # Preview-only chrome (e-sign row, hints)
    AgreementDocumentSections.tsx  # Renders agreement sections (preview, detail, PDF body)
    EditProfilePage.tsx      # Edit business profile + agreement defaults
    EditProfilePage.css      # EditProfilePage-only styles
    WorkOrdersPage.tsx       # List jobs; “Create Work Order” below invoiced/pending summary (same as Home); invoice actions; opens detail
    WorkOrdersPage.css       # WorkOrdersPage-only list/dashboard chrome + invoice warning banner
    WorkOrderDetailPage.tsx  # Saved job → agreement + job-level invoice strip + change orders + PDFs
    WorkOrderDetailPage.css  # WO detail invoice strip + CO sublist (e.g. `.co-list-*`)
    ChangeOrderDetailPage.tsx # Saved change order → HTML/PDF + actions
    ChangeOrderDetailPage.css # CO detail-only chrome (e.g. `.co-detail-*`)
    ChangeOrderWizard.tsx    # Create/edit change order (3 steps)
    ChangeOrderWizard.css    # Wizard-only `.co-*` blocks (shared badge/section labels stay in App.css)
    InvoiceWizard.tsx        # Create/edit invoice; CO pickers + line `source` for merge on edit
    InvoiceWizard.css        # Invoice wizard materials/CO picker/payment group (chips stay global)
    InvoiceFinalPage.tsx     # Invoice preview, download, notes
    InvoiceFinalPage.css     # Invoice final page-only chrome (nav/headings shared in App.css)
    InvoicePreviewModal.tsx  # Full-screen invoice HTML preview
    InvoicePreviewModal.css  # Invoice preview modal overlay/scroll/sheet
  lib/
    supabase.ts              # Supabase client singleton
    auth.ts                  # signUp, signIn, signOut
    agreement-generator.ts   # Pure functions: agreement section model
    agreement-pdf.ts         # Fetch/download PDF blob via /api/pdf
    job-site-address.ts      # formatJobSiteAddress, parseStoredJobSiteAddress, jobLocationSingleLine, …
    us-phone-input.ts        # formatUsPhoneInput (job form + edit profile)
    geoapify-autocomplete.ts # Job site address suggestions (optional API key)
    job-to-welder-job.ts     # Job row + profile → WelderJob
    invoice-generator.ts     # Invoice HTML string
    agreement-sections-html.ts # Agreement sections → HTML string (combined PDFs)
    docuseal-agreement-html.ts # DocuSeal HTML document for WO (embedded CSS + field tags; uses esc())
    docuseal-change-order-html.ts # DocuSeal HTML document for CO (embedded CSS + field tags; uses esc()); optional `providerSignatureDataUrl` for SP signature image (same canvas PNG as WO)
    docuseal-header-footer.ts  # html_header / html_footer strings for DocuSeal submissions
    docuseal-constants.ts      # Shared DocuSeal role name(s)
    docuseal-signature-image.ts # Render DocuSeal SP signature as image in signed documents
    fetch-with-supabase-auth.ts # Same-origin fetch with Bearer from Supabase session
    esign-api.ts               # send/resend work order and change order for signature (app server API)
    esign-labels.ts            # E-sign status strings for UI
    esign-progress.ts          # Shared e-sign step/tone model for detail timeline + list strip
    esign-live.ts              # Shared e-sign polling cadence + in-flight status helpers + timestamp formatting
    html-escape.ts           # esc() for generated HTML (WO / CO / invoice strings)
    owner-name.ts            # normalize owner full name for profile + preview stubs
    guest-agreement-profile.ts # `BusinessProfile`-shaped stub from guest form fields for agreement preview when no DB profile
    change-order-generator.ts # Change order HTML + combined WO + listed COs
    change-order-document.css # PDF/preview styles scoped to .change-order-document (imported ?raw by agreement-pdf.ts)
    invoice-line-items.ts    # Invoice line item parsing, validation, source types
    payment-terms.ts         # Payment terms presets + validators
    work-order-list-label.ts # Job type display formatting for Work Orders list
    payment-methods.ts, tax.ts, defaults.ts
    db/
      profile.ts             # getProfile, upsertProfile, updateNextWoNumber
      clients.ts             # listClients, upsertClient, deleteClient
      jobs.ts                # listJobs, saveWorkOrder, dashboard RPC mapping, create/update/delete
      invoices.ts            # Invoice CRUD + mark downloaded; line item `source` in JSON
      change-orders.ts       # Change order CRUD + totals
  hooks/
    useAppNavigation.ts      # URL/history-backed view state
    useAuth.ts               # Supabase auth state listener
    useAuthProfile.ts        # Profile loading + capture redirect handling
    useChangeOrderFlow.ts    # Detail/wizard/detail navigation for change orders
    useEsignPoller.ts        # Shared timer + visibility wiring for short-lived e-sign polling
    useInvoiceFlow.ts        # Invoice wizard/final page flow state
    useScaledPreview.ts      # 816px preview scaling helpers
    useWorkOrderDraft.ts     # Draft state + next_wo_number refresh after first save; optional onNewDraft (e.g. clear App guest information fields)
    useWorkOrderRowActions.ts # Work Orders row prefetch + CO/invoice hydration helpers
  types/
    db.ts                    # BusinessProfile, Client, Job, Invoice, … (+ esign_* fields on Job, ChangeOrder)
    index.ts                 # WelderJob, AgreementSection, SignatureBlockData
    capture-flow.ts          # CaptureFlow type for anonymous capture modal
  data/
    sample-job.json          # Default/placeholder values for new agreements
server/
  app-server.mjs             # App server + /api/pdf + e-sign + DocuSeal webhook routes
  esign-routes.mjs           # JWT send/resend; webhook verify + service-role e-sign updates
  docuseal-esign-state.mjs   # Map DocuSeal submission/submitter → shared esign_* patch (shared w/ tests via @scope-server alias)
```

---

## Generated HTML strings (security)

All user- or client-supplied text interpolated into HTML string generators (`invoice-generator.ts`, `change-order-generator.ts`, `agreement-sections-html.ts`, `docuseal-agreement-html.ts`, `docuseal-change-order-html.ts`, and any combined PDF HTML builders) must go through `esc()` from `src/lib/html-escape.ts`. React text in components (e.g. `AgreementDocumentSections`) is escaped by default; do not add new `dangerouslySetInnerHTML` pipelines built from raw user input without `esc()`.

---

## Auth and product flow

**Anonymous (no session):**
- Full app shell: **Home → Create Work Order → JobForm → Preview**.
- Header shows **Sign In** only (no Work Orders / gear until logged in).
- **Primary signup path:** when there is no profile yet, **JobForm** shows optional **Your Information** (first/last for agreement autosign preview, optional Business Phone for preview). Guest preview stub has no email until capture. **Download & Save** (or **Save & Send for Signature**) → **CaptureModal** (business name, account email, password, optional **Save defaults?** checkbox) → `signUp` + `upsertProfile` (`business_name`, `owner_name`, `email` from modal, `phone` from optional form field, and optionally work-order-derived defaults) → `saveWorkOrder` → PDF or e-sign send. No separate “register” flow in the header for visitors.

**Returning user:**
- **Sign In** → `AuthPage` (email + password only; new accounts still come from capture on first save, not from AuthPage).

**Signed in but no `business_profiles` row** (edge case): full-screen **BusinessProfileForm** until a profile exists.

**After sign-in (with profile):** **Home**, **Work Orders**, **gear (Edit profile)**; session persists via Supabase (refresh-safe).

**Work Orders details worth remembering:**
- `WorkOrdersPage` shows **Contract value** rollups from `job.price`, not invoice totals.
- `WorkOrdersPage` loads from the Supabase RPC `list_work_orders_dashboard`; invoice badge state is part of each dashboard row instead of a separate client-side invoice query/join.
- `WorkOrdersPage` shows inline per-job change-order shortcuts beneath the WO e-sign strip; each shortcut opens CO detail directly, and CO detail returns to Work Orders when entered from that list.
- Work Orders e-sign polling refreshes only in-flight rows and merges them back into the list; it no longer reloads the full dashboard on every poll tick.
- Clicking a work-order row navigates immediately with `jobId`; `WorkOrderDetailPage` loads the full job row locally and shows a loading state while hydrating.
- `WorkOrderDetailPage` has a single **job-level** invoice strip; invoice actions are not rendered per change-order row.
- `ChangeOrderWizard` now saves the CO, sends the DocuSeal request immediately, then routes to `ChangeOrderDetailPage`; CO business `status` tracks approval lifecycle (`pending_approval` after send/open, `approved` on completed signature, `rejected` on decline).
- **`jobs.esign_*` and `change_orders.esign_*`:** list/detail surfaces show e-sign progress, signing actions, and signed artifacts from the same DocuSeal state model. While e-sign is in-flight, detail pages call **`GET /api/esign/work-orders/:id/status`** or **`GET /api/esign/change-orders/:id/status`** (authenticated) to reconcile DocuSeal into the row; webhooks update the same fields. **Email** subject/body for DocuSeal notifications and **signed PDF** layout are best verified on the **deployed** app (public URL + production-like env), not assumed identical to every local setup.

**`view` in `App.tsx`:** `'home' | 'form' | 'preview' | 'profile' | 'work-orders' | 'work-order-detail' | 'co-detail' | 'change-order-wizard' | 'invoice-wizard' | 'invoice-final' | 'auth'` (plus `pushState` / `popstate` for back/forward).
- `App.tsx` lazy-loads preview, Work Orders, detail, change-order, and invoice screens. The initial shell stays eager; heavy document/dashboard flows load on demand, and the Work Orders chunk is idle-prefetched after sign-in.

---

## Database schema

Tables: `business_profiles`, `clients`, `jobs`, `change_orders`, `invoices`

All tables have RLS — users can only read/write their own rows (`user_id = auth.uid()`).

Key `business_profiles` columns:
- `default_exclusions text[]` — pre-populated exclusions for new agreements; `null`/missing falls back to system defaults, stored `[]` is intentional empty
- `default_assumptions text[]` — pre-populated assumptions for new agreements; `null`/missing falls back to system defaults, stored `[]` is intentional empty
- `next_wo_number`, `next_invoice_number` — counters for new work orders / invoices

Migrations are in `supabase/migrations/` — apply via Supabase CLI (`npx supabase db push`) or paste SQL into Supabase Dashboard → SQL Editor.

---

## What is and isn't persisted

| Feature | Persisted |
|---|---|
| Business profile | Yes — Supabase DB |
| Default exclusions/assumptions | Yes — Supabase DB |
| Auth session | Yes — Supabase session (survives refresh) |
| Current work order **draft** (form state) | No — in-memory until **Download & Save** |
| Jobs | Yes — on **Download & Save** (`saveWorkOrder`); listed on **Work Orders** |
| Clients | Yes — upserted on **Download & Save** keyed by `name_normalized`; **JobForm** can search/suggest when `userId` is set |
| Invoices | Yes — wizard + final page; status `draft` / `downloaded` |
| Change orders | Yes — wizard + detail; `create_change_order` RPC + migration **0006_change_order_creation_lock.sql** for atomic numbering |

---

## Design system — field notebook style

The UI should feel like a contractor's work log, not a SaaS product.

**Core rules:**
- `border-radius` max 6px — no soft bubbly cards
- Section labels: uppercase, letter-spaced, 12px, muted color
- Horizontal rules as section dividers (not whitespace)
- Background: `#F7F7F5` (warm paper), not pure white
- Header: `#1A1917` (near-black hardcover)
- Primary action color: `#1C3A5E` (dark navy)
- No gradients, no decorative icons, no shadows beyond 3px

**CSS variables** (defined in `App.css :root`):
- `--primary`, `--primary-hover`, `--primary-light`
- `--surface` (#F7F7F5), `--surface-white` (#FAFAF8)
- `--border` (#C8C4BC), `--border-strong` (#8A8680)
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--radius` (4px), `--radius-lg` (6px)

**CSS co-location (mandatory — keep in sync with [AGENTS.md](./AGENTS.md) and [.cursor/rules/ScopeLock-Project-Rules.mdc](./.cursor/rules/ScopeLock-Project-Rules.mdc)):**

1. **Own your styles:** Co-locate with the owning page or component; `ComponentName.tsx` imports `./ComponentName.css` (or the repo’s established pairing).
2. **`App.css` scope only:** `src/App.css` holds design tokens (`:root`), app shell/layout, **shared** utility classes, print/PDF globals, and **truly cross-cutting** rules—not styles that mainly serve one screen, wizard, modal, or feature.
3. **No new feature CSS in `App.css`:** Do not add page-specific or feature-specific rules there; use the owner’s co-located CSS file.
4. **New UI surfaces:** New pages and major components **must** ship with a paired CSS file (e.g. `FooPage.tsx` + `FooPage.css`).
5. **Single owner:** Styles used by only one page or component belong in **that** CSS file, not `App.css` or an unrelated sibling.
6. **Global exceptions:** Intentionally shared primitives (e.g. reused badges, header chrome) may stay in `App.css`; follow comments in the structure tree above.

**Other frontend file rules:**
- New shared HTML helpers belong in `src/lib/`; if multiple generators need the same escaping logic, extract a shared helper there instead of copy-pasting `esc()` helpers.

The app server **`POST /api/pdf`** renders HTML built in the client (agreement, invoice, change order, combined WO+CO) with Puppeteer; preview and PDF are designed to match. **Job site address** in the agreement is a **single line** in output (`jobLocationSingleLine`).

---

## Git

- Main branch: `main`
- Feature development may use branches such as `output` or `auth` before merging to `main`
- **Product priorities** (see **ARCHITECTURE.md → Roadmap**): change orders, client e-sign, Stripe / ACH payments
