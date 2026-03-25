# ScopeLock

Work agreement generator for contractors (initially welders). Contractors fill out a job form and get a professional PDF agreement to send to clients.

## Quick Start

```bash
# Install dependencies
npm install

# Copy env vars and fill in from Supabase dashboard (Project Settings → API)
cp .env.example .env.local

# Start the app server (frontend + /api/pdf)
npm run dev

# Build for production
npm run build
```

## Features

- Mobile-first responsive design
- **Open product:** use the work agreement flow before signing in; create account on first **Download & Save**
- Email/password authentication (Supabase)
- Business profile and defaults (exclusions, assumptions, warranty, payment methods, tax) stored in the database
- Work Orders list, saved job detail, PDF re-download
- **Invoices:** wizard from a work order → PDF download
- Job site address autocomplete (optional Geoapify API key)
- US phone formatting on job form and edit profile
- Work Agreement generator (numbered sections)
- Agreement preview and PDF via app server (Puppeteer) for parity with preview
- Print support

## Tech Stack

- **Vite** + **React** + **TypeScript**
- **Supabase** (auth + Postgres + row-level security)
- **Puppeteer Core** (same-server PDF rendering with Chrome)
- Plain CSS — no Tailwind

## Environment Variables

```
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GEOAPIFY_API_KEY=...   # optional — job site street autocomplete
```

## Project Structure

```
src/
  App.tsx                    # View state machine; anonymous + authenticated flows
  components/
    AuthPage.tsx             # Sign-in (returning users)
    BusinessProfileForm.tsx  # Signed-in user missing profile row (rare)
    CaptureModal.tsx         # Account creation on first Download & Save
    HomePage.tsx
    JobForm.tsx
    AgreementPreview.tsx
    AgreementDocumentSections.tsx
    EditProfilePage.tsx
    WorkOrdersPage.tsx, WorkOrderDetailPage.tsx
    InvoiceWizard.tsx, InvoiceFinalPage.tsx, InvoicePreviewModal.tsx
  lib/
    supabase.ts, auth.ts
    agreement-generator.ts, agreement-pdf.ts, invoice-generator.ts
    job-site-address.ts, us-phone-input.ts, geoapify-autocomplete.ts
    job-to-welder-job.ts
    db/                      # profile, clients, jobs, invoices
  hooks/useAuth.ts
  types/                     # WelderJob, DB row types
  data/sample-job.json
server/
  app-server.mjs             # App server + /api/pdf
supabase/migrations/         # Apply via CLI or dashboard SQL editor
```

## Auth + Product Flow

**Anonymous**

1. Land on **Home** → **Create Work Order** → fill **JobForm** → **Preview**.
2. **Download & Save** opens **CaptureModal** (business name, email, password).
3. App calls `signUp`, `upsertProfile`, saves the work order, downloads PDF.

**Returning user**

1. Tap **Sign In** in the header → **AuthPage** (email + password).
2. After sign-in: **Home**, **Work Orders**, and **Edit profile** (gear) are available.

## Database

Tables include: `business_profiles`, `clients`, `jobs`, `change_orders`, `invoices` — all with RLS.

Apply migrations via Supabase CLI:

```bash
npx supabase db push
```

Or paste each migration file into Supabase Dashboard → SQL Editor.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for stack rationale, data flow, PDF/preview details, and roadmap.

## License

MIT
