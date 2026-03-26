# ScopeLock — CLAUDE.md

Work agreement generator for contractors (initially welders). Contractors fill out a job form and get a professional PDF agreement to send to clients.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | React 19 + TypeScript + Vite |
| Auth + DB | Supabase (email/password auth, Postgres, RLS) |
| App Server | Node **`server/app-server.mjs`**: Vite **middleware** (dev) or static **`dist/`** when `NODE_ENV=production` |
| PDF | Puppeteer Core + **system Chrome**; all document PDFs via **same-origin** `POST /api/pdf` |
| Styling | Plain CSS (`index.css`, global `App.css`, and co-located component/page CSS files) — no Tailwind |
| Font | Barlow (+ Dancing Script for agreement signature) — field notebook aesthetic |

---

## Running the app

```bash
npm run dev       # one process: Vite (HMR) + SPA + POST /api/pdf  (default http://127.0.0.1:3000)
npm run build     # tsc + vite bundle → dist/  (set VITE_* first for production builds)
npm run preview   # NODE_ENV=production: serve dist/ + /api/pdf  — run build first
npm run lint      # eslint
```

**Client env** (Vite, `.env.local` — see `.env.example`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEOAPIFY_API_KEY=...   # optional — job site street autocomplete
```

**Server env** (read by `app-server.mjs` at runtime, not `VITE_`): `PUPPETEER_EXECUTABLE_PATH` or `CHROME_PATH` if default Chrome path is wrong; `PORT`, `HOST`; `NODE_ENV=production` for static `dist/` mode. Quick check: `GET /api/pdf/health` → `{ "ok": true }`.

---

## Server, PDFs, deployment (reality check)

- **Not static-only hosting:** Work order, invoice, and change-order PDFs all need the **Node server** and a **local Chrome/Chromium** binary. The browser posts HTML to **`/api/pdf`** on the **same origin** as the UI.
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
    CaptureModal.tsx         # Anonymous Download & Save: business name, email, password
    CaptureModal.css         # CaptureModal-only styles
    HomePage.tsx             # Home after login; “Create Work Order”
    HomePage.css             # HomePage-only styles
    JobForm.tsx              # Work agreement form (structured job site + Geoapify autocomplete)
    JobForm.css              # JobForm-only styles
    AgreementPreview.tsx     # Preview + Download & Save / PDF; hosts CaptureModal when anonymous
    AgreementDocumentSections.tsx  # Renders agreement sections (preview, detail, PDF body)
    EditProfilePage.tsx      # Edit business profile + agreement defaults
    EditProfilePage.css      # EditProfilePage-only styles
    WorkOrdersPage.tsx       # List jobs; invoice actions; opens detail
    WorkOrdersPage.css       # WorkOrdersPage-only list/dashboard chrome
    WorkOrderDetailPage.tsx  # Saved job → agreement + change orders + PDFs
    WorkOrderDetailPage.css  # WO detail CO sublist (e.g. `.co-list-*`)
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
    change-order-generator.ts # Change order HTML + WO + approved COs
    payment-methods.ts, tax.ts, defaults.ts
    db/
      profile.ts             # getProfile, upsertProfile, updateNextWoNumber
      clients.ts             # listClients, upsertClient, deleteClient
      jobs.ts                # listJobs, createJob, updateJob, deleteJob, saveWorkOrder
      invoices.ts            # Invoice CRUD + mark downloaded; line item `source` in JSON
      change-orders.ts       # Change order CRUD + totals
  hooks/
    useAuth.ts               # Supabase auth state listener
  types/
    db.ts                    # BusinessProfile, Client, Job, Invoice, …
    index.ts                 # WelderJob, AgreementSection, SignatureBlockData
  data/
    sample-job.json          # Default/placeholder values for new agreements
server/
  app-server.mjs             # App server + /api/pdf Puppeteer route
```

---

## Auth and product flow

**Anonymous (no session):**
- Full app shell: **Home → Create Work Order → JobForm → Preview**.
- Header shows **Sign In** only (no Work Orders / gear until logged in).
- **Primary signup path:** first **Download & Save** → **CaptureModal** (business name, email, password) → `signUp` + minimal `upsertProfile` → `saveWorkOrder` → PDF. No separate “register” flow in the header for visitors.

**Returning user:**
- **Sign In** → `AuthPage` (email + password only; new accounts still come from capture on first save, not from AuthPage).

**Signed in but no `business_profiles` row** (edge case): full-screen **BusinessProfileForm** until a profile exists.

**After sign-in (with profile):** **Home**, **Work Orders**, **gear (Edit profile)**; session persists via Supabase (refresh-safe).

**`view` in `App.tsx`:** `'home' | 'form' | 'preview' | 'profile' | 'work-orders' | 'work-order-detail' | 'change-order-wizard' | 'invoice-wizard' | 'invoice-final' | 'auth'` (plus `pushState` / `popstate` for back/forward).

---

## Database schema

Tables: `business_profiles`, `clients`, `jobs`, `change_orders`, `invoices`

All tables have RLS — users can only read/write their own rows (`user_id = auth.uid()`).

Key `business_profiles` columns:
- `default_exclusions text[]` — pre-populated exclusions for new agreements
- `default_assumptions text[]` — pre-populated assumptions for new agreements
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
| Change orders | Yes — wizard + detail; migration **0005_change_orders.sql** |

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

**Frontend file rules:**
- Co-locate page/component styles with the file that owns them.
- `App.css` is for global tokens, shell/layout, shared utility classes, and print/PDF globals only.
- Do not add new page-specific sections to `App.css`.
- New shared HTML helpers belong in `src/lib/`; if multiple generators need the same escaping logic, extract a shared helper there instead of copy-pasting `esc()` helpers.

The app server **`POST /api/pdf`** renders HTML built in the client (agreement, invoice, change order, combined WO+CO) with Puppeteer; preview and PDF are designed to match. **Job site address** in the agreement is a **single line** in output (`jobLocationSingleLine`).

---

## Git

- Main branch: `main`
- Feature development may use branches such as `output` or `auth` before merging to `main`
- **Product priorities** (see **ARCHITECTURE.md → Roadmap**): change orders, client e-sign, Stripe / ACH payments
