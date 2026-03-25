# ScopeLock — CLAUDE.md

Work agreement generator for contractors (initially welders). Contractors fill out a job form and get a professional PDF agreement to send to clients.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | React 19 + TypeScript + Vite |
| Auth + DB | Supabase (email/password auth, Postgres, RLS) |
| App Server | Node + Vite middleware |
| PDF | Puppeteer Core using system Chrome via `/api/pdf` |
| Styling | Plain CSS (`App.css`, `index.css`) — no Tailwind |
| Font | Barlow (+ Dancing Script for agreement signature) — field notebook aesthetic |

---

## Running the app

```bash
npm run dev       # app server + frontend + /api/pdf
npm run build     # tsc + vite build
npm run preview   # production app server serving dist/
npm run lint      # eslint
```

Env vars go in `.env.local`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEOAPIFY_API_KEY=...   # optional; job site street autocomplete (Geoapify)
```

---

## Project structure

```
src/
  App.tsx                    # Root — view state machine, auth-aware shell
  App.css                    # All app styles (field notebook design system)
  index.css                  # Base reset + font stack
  components/
    AuthPage.tsx             # Sign-in only (email + password); header “Sign In”
    BusinessProfileForm.tsx  # Full-screen when signed in but no profile row (edge case)
    CaptureModal.tsx         # Anonymous Download & Save: business name, email, password
    HomePage.tsx             # Home after login; “Create Work Order”
    JobForm.tsx              # Work agreement form (structured job site + Geoapify autocomplete)
    AgreementPreview.tsx     # Preview + Download & Save / PDF; hosts CaptureModal when anonymous
    AgreementDocumentSections.tsx  # Renders agreement sections (preview, detail, PDF body)
    EditProfilePage.tsx      # Edit business profile + agreement defaults
    WorkOrdersPage.tsx       # List jobs; invoice actions; opens detail
    WorkOrderDetailPage.tsx  # Saved job → agreement view + Download PDF
    InvoiceWizard.tsx        # Create/edit invoice (steps)
    InvoiceFinalPage.tsx     # Invoice preview, download, notes
    InvoicePreviewModal.tsx  # Full-screen invoice HTML preview
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
    payment-methods.ts, tax.ts, defaults.ts
    db/
      profile.ts             # getProfile, upsertProfile, updateNextWoNumber
      clients.ts             # listClients, upsertClient, deleteClient
      jobs.ts                # listJobs, createJob, updateJob, deleteJob, saveWorkOrder
      invoices.ts            # Invoice CRUD + mark downloaded
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
- First **Download & Save** opens **CaptureModal**: business name, email, password → `signUp` + minimal `upsertProfile` → save work order → PDF download. Profile/session races are handled via `getSession`, upsert return row, and `loadProfile` where needed.

**Returning user:**
- **Sign In** → `AuthPage` (email + password only; no “sign up” link — new accounts are created via capture on Download & Save).
- After sign-in: **Home**, **Work Orders**, **gear (Edit profile)** as today.

**Signed in but no `business_profiles` row** (edge case): full-screen **BusinessProfileForm** until a profile exists.

**`view` in `App.tsx`:** `'home' | 'form' | 'preview' | 'profile' | 'work-orders' | 'work-order-detail' | 'invoice-wizard' | 'invoice-final' | 'auth'` (plus `pushState` / `popstate` for back/forward).

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
| Change orders | No — schema only |

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

The PDF renderer uses the same agreement HTML/CSS as the preview through the app server's `/api/pdf` route, so preview/PDF parity is intentional. **Job site address** in the agreement is rendered as a **single line** for PDF/display (`jobLocationSingleLine`).

---

## Git

- Main branch: `main`
- Feature development may use branches such as `output` or `auth` before merging to `main`
