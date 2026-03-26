# ScopeLock Architecture

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
  is set to that client’s id. Requires migration **`0004_clients_name_normalized.sql`**.
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
│   │   ├── CaptureModal.tsx          # Anonymous first Download & Save: account + profile stub
│   │   ├── EditProfilePage.tsx       # Edit profile + agreement defaults
│   │   ├── HomePage.tsx              # Landing; Create Work Order
│   │   ├── WorkOrdersPage.tsx        # List jobs + invoice actions; row opens detail
│   │   ├── WorkOrderDetailPage.tsx   # Saved job → agreement + change orders + PDFs
│   │   ├── ChangeOrderWizard.tsx     # Create/edit change order (3 steps)
│   │   ├── AgreementDocumentSections.tsx # Renders AgreementSection[] (preview + detail + PDF body)
│   │   ├── InvoiceWizard.tsx         # Invoice steps (pricing, due date, payment methods)
│   │   ├── InvoiceFinalPage.tsx      # Preview, download, edit, notes
│   │   ├── InvoicePreviewModal.tsx   # Full-screen invoice preview overlay
│   │   ├── JobForm.tsx               # Work Agreement form (structured job site, Geoapify optional)
│   │   └── AgreementPreview.tsx      # Preview + Download & Save + PDF; hosts CaptureModal when anonymous
│   ├── data/
│   │   └── sample-job.json           # Fallback defaults for new agreements
│   ├── hooks/
│   │   └── useAuth.ts                # Auth state hook (Supabase session)
│   ├── lib/
│   │   ├── supabase.ts               # Supabase client singleton
│   │   ├── auth.ts                   # signUp / signIn / signOut helpers
│   │   ├── agreement-generator.ts    # Pure domain logic: agreement section model
│   │   ├── agreement-sections-html.ts # Agreement body HTML string (combined WO+CO PDFs)
│   │   ├── change-order-generator.ts # Change order HTML + combined WO + approved COs
│   │   ├── agreement-pdf.ts          # PDF HTML wrapper + fetch/download blob (Puppeteer)
│   │   ├── job-site-address.ts       # Multiline job_location, parse for client autofill, single-line PDF
│   │   ├── us-phone-input.ts         # US phone mask (JobForm + EditProfilePage)
│   │   ├── geoapify-autocomplete.ts  # Job site suggestions (optional API key)
│   │   ├── job-to-welder-job.ts      # Job row + profile → WelderJob for generator/PDF
│   │   ├── invoice-generator.ts      # Pure HTML for invoice body (preview + PDF)
│   │   └── db/
│   │       ├── profile.ts            # getProfile, upsertProfile, updateNextWoNumber (counter patch)
│   │       ├── clients.ts            # listClients / upsertClient / deleteClient (JobForm search when authed)
│   │       ├── jobs.ts               # listJobs, saveWorkOrder, create/update/delete
│   │       ├── change-orders.ts      # list/create/update/delete change orders; computeCOTotal
│   │       └── invoices.ts           # createInvoice (RPC counter), updateInvoice, list, get, mark downloaded
│   ├── types/
│   │   ├── index.ts                  # WelderJob, AgreementSection, SignatureBlockData
│   │   └── db.ts                     # BusinessProfile, Client, Job, ChangeOrder
│   ├── App.tsx                       # Root component - view state machine
│   └── main.tsx                      # Entry point
├── server/
│   └── app-server.mjs               # App server + /api/pdf Puppeteer route
├── supabase/
│   ├── config.toml                   # Supabase CLI config
│   └── migrations/
│       ├── 0001_initial_schema.sql   # Initial tables + indexes + triggers + RLS
│       └── 0002_invoices.sql         # invoices table, next_invoice_number(), profile counter column
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
First Download & Save → CaptureModal → signUp + upsertProfile + saveWorkOrder + PDF
      ↓
[Signed in, no profile row] → BusinessProfileForm (rare edge case)
      ↓
[Signed in + profile] → HomePage; header: Work Orders, Edit profile (gear)
      ↓
Work Orders → WorkOrdersPage → row → WorkOrderDetailPage (agreement + change orders + PDFs)
                      → Change Order → ChangeOrderWizard → detail (refresh list)
                      → Invoice → InvoiceWizard (optional CO lines on **new** invoices) → InvoiceFinalPage → Download → Work Orders + success banner
      ↓
Create Work Order → JobForm → Preview tab → AgreementPreview (Download & Save / PDF)
      ↓
Header Sign In → AuthPage (email + password only)
      ↓
Edit profile (gear) → EditProfilePage
```

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
- `db/invoices.ts`: Invoice CRUD; **`createInvoice`** calls Postgres **`next_invoice_number(p_user_id)`** for atomic numbering (increments `business_profiles.next_invoice_number`); **`updateInvoice`** full-row overwrite; **`markInvoiceDownloaded`** sets `status = 'downloaded'`; **`mapInvoiceRow`** normalizes **`line_items[].source`**
- `db/change-orders.ts`: **`listChangeOrders`**, **`createChangeOrder`** (with co_number retry), **`updateChangeOrder`**, **`deleteChangeOrder`**, **`computeCOTotal`**
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
| `business_profiles` | user_id (unique), business_name, owner_name, phone, email, address, google_business_profile_url, default_exclusions[], default_assumptions[], default_tax_rate, default_payment_methods[], next_wo_number, next_invoice_number, … |
| `clients` | user_id, name, **name_normalized** (dedup key), phone, email, address, notes |
| `jobs` | user_id, client_id, all WelderJob fields, status |
| `change_orders` | user_id, job_id, **co_number** (per-job sequence, UNIQUE with job_id), description, reason, status (`draft` \| `pending_approval` \| `approved` \| `rejected`), **line_items** (jsonb), time_amount / time_unit / time_note, requires_approval, … — legacy `price_delta` / `time_delta` / `approved` were migrated in **0005** |
| `invoices` | user_id, job_id, invoice_number, invoice_date, due_date, status (`draft` \| `downloaded`), **line_items** (jsonb; each row may include **`source`**: `original_scope` \| `change_order` \| `labor` \| `material` \| `manual` \| `legacy`), tax fields, payment_methods (jsonb snapshot), notes |

**Invoice numbering:** `public.next_invoice_number(uuid)` updates `business_profiles` in one statement and returns the allocated number (pre-increment value). No separate `updateNextInvoiceNumber` in app code.

All tables use `auth.uid()` RLS policies: users can only read/write their own rows.

### Change orders (`0005_change_orders.sql`)

- Adds structured columns (`co_number`, `reason`, `status`, `line_items` jsonb, schedule fields, etc.).
- **Backfills** existing rows from legacy `price_delta` / `time_delta` / `approved`, assigns **`co_number`** per `job_id` with `ROW_NUMBER()`, then drops the legacy columns.
- **`UNIQUE (job_id, co_number)`**; app **`createChangeOrder`** retries the insert **once** after a unique violation (`23505`).

### Combined WO + change-order PDFs (v1)

- Agreement body for PDF is built as an HTML **string** via **`agreementSectionsToHtml`** (mirrors **`AgreementDocumentSections`** markup), not from live DOM `outerHTML`.
- **`buildCombinedWorkOrderAndChangeOrdersHtml`** appends **`page-break-before: always`** and each **approved** change order only.
- Client uses **`fetchHtmlPdfBlob`** / **`downloadPdfBlobToFile`** in **`agreement-pdf.ts`** (same `/api/pdf` JSON shape as work orders and invoices).

### Invoice `line_items[].source`

- **`InvoiceLineItem.source`**: `original_scope` | `change_order` | `labor` | `material` | `manual` | `legacy`. **`mapInvoiceRow`** defaults missing/invalid to **`legacy`**.
- **New invoice:** **`InvoiceWizard`** loads change orders for the job; checkboxes (approved **on** by default) add **`change_order`** lines. All new built rows set **`source`**.
- **Edit invoice:** Partition by **`source`**. **`change_order`** rows (and **`legacy`** rows whose description matches **`/^Change Order #/`**) are **preserved**. Rows **`original_scope`**, **`labor`**, **`material`**, **`manual`** are **replaced** from wizard state on save. **Order:** **fixed** → rebuilt original scope then preserved CO lines; **T&M** → preserved CO lines then all labor lines then all material lines. **T&M** editing round-trips **all** labor and material lines (not only the first).

### Work Orders dashboard rollups (Option B)

- **Invoiced** / **Pending Invoice** on **`WorkOrdersPage`** sum **`job.price`** only (original contract on the saved work order). They **do not** include change-order deltas or invoice totals. The summary strip is labeled **Contract value** so this is explicit. Using invoice totals for rollups (**Option A**) is deferred.

## What Is and Isn't Persisted

| Feature | Persisted | Notes |
|---|---|---|
| Business profile | Yes | Supabase DB |
| Default exclusions/assumptions | Yes | Supabase DB, pre-populate new agreements |
| Auth session | Yes | Supabase session (survives refresh) |
| Work Agreement (current job) | In-memory while editing | **Download & Save** persists via `saveWorkOrder` |
| Invoices | Yes | Created at wizard step 3; status `draft` until **Download Invoice** sets `downloaded`. The **first** download per final-page mount runs **`markInvoiceDownloaded`** and navigation callback; repeat clicks only regenerate the PDF (no duplicate status writes). |
| Clients | Yes (rows) | Upsert on **Download & Save**; **JobForm** customer-name combobox searches when authenticated |
| Change orders | Yes | **ChangeOrderWizard** + detail page; **`next_co_number`** RPC; insert retry once on unique violation |
| Completion signoffs | No | Schema only |

## Portability Considerations

### Current (Web MVP)
- Runs in browser
- Auth + profile persistence via Supabase
- **Work order drafts** are in-memory until **Download & Save**; saved jobs live in `jobs` and appear on **Work Orders**
- Requires an app server for PDF generation

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
- [ ] Deploy the app server and Puppeteer route alongside production hosting
- [ ] Richer client management UI (beyond JobForm search + save-time upsert)
- [ ] Custom branding (logo)

### Later
- [ ] Multiple agreement templates
- [x] Change order flow (persisted COs, wizard, PDFs, invoice integration)
- [ ] Work Orders rollups from invoice totals (Option A)
- [ ] Completion signoff (schema exists)
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

This app now requires a Node app server for PDF generation, so deployment needs to run the server alongside Chrome/Chromium.

Recommended deployment shape:
- Run `npm run build`
- Start the app with `npm run preview` or `node server/app-server.mjs`
- Ensure `PUPPETEER_EXECUTABLE_PATH` or `CHROME_PATH` points to an installed Chrome/Chromium binary if the default path is not valid
- Expose the same origin for both the frontend and `/api/pdf`
