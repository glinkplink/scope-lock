# ScopeLock

Work agreement generator for contractors (initially welders). Contractors fill out a job form and get a professional PDF agreement to send to clients.

**Important:** This is not a static single-page app you can drop on pure CDN hosting. **Every PDF** (work order, invoice, change order, and combined work order + approved change orders) is produced by a **Node process** that runs **Puppeteer** against a **local Chrome/Chromium** binary. The UI and `/api/pdf` are intended to run **on the same origin** so the browser can `POST` HTML + metadata to the server without cross-origin configuration.

---

## What you need to run it

- **Node.js** (recent LTS is fine)
- **Chrome or Chromium** installed on the same machine (or container) that runs `server/app-server.mjs`
- A **Supabase** project with migrations applied (`business_profiles`, `clients`, `jobs`, `change_orders`, `invoices`, RPCs such as `next_invoice_number`, `next_co_number`, etc.)

---

## Quick start

```bash
npm install

# Copy env vars and fill in from Supabase (Project Settings → API)
cp .env.example .env.local

# Dev: one process serves Vite (HMR) + static API routes + POST /api/pdf
npm run dev
```

By default the app listens on **`http://127.0.0.1:3000`**. On startup the server logs which Chrome path it uses for PDF rendering.

Check that PDF infrastructure is reachable:

```bash
curl -s http://127.0.0.1:3000/api/pdf/health
# {"ok":true}
```

---

## Scripts

| Command | What runs |
|--------|-----------|
| `npm run dev` | **`node server/app-server.mjs`** with `NODE_ENV` ≠ `production`: Vite in **middleware mode** (hot reload) + **`POST /api/pdf`** |
| `npm run build` | TypeScript project references + Vite production bundle → `dist/` |
| `npm run preview` | **`NODE_ENV=production node server/app-server.mjs`**: serves **`dist/`** as static files + **`POST /api/pdf`**. **Run `npm run build` first** or the app shell will be missing/outdated. |
| `npm run lint` | ESLint |

There is **no** `vite preview` workflow as the primary way to run the product: the supported path is **always** the custom app server so PDFs work.

---

## Environment variables

**Client (Vite — must be prefixed with `VITE_`, read at build time):**

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEOAPIFY_API_KEY=...   # optional — job site street autocomplete
```

Put these in **`.env.local`** (see `.env.example`).

**Server (read at runtime by `server/app-server.mjs` — not `VITE_`):**

| Variable | Purpose |
|----------|---------|
| `PUPPETEER_EXECUTABLE_PATH` or `CHROME_PATH` | Absolute path to Chrome/Chromium. If unset, defaults to **`/usr/bin/google-chrome-stable`** (typical on Debian/Ubuntu; adjust on macOS/Windows or in Docker). |
| `PORT` | HTTP port (default **3000**) |
| `HOST` | Bind address (default **127.0.0.1** — set to `0.0.0.0` in containers/cloud if you need external access) |
| `NODE_ENV` | When set to **`production`**, the server serves **`dist/`** instead of Vite dev middleware. `npm run preview` sets this for you. |

---

## PDFs and `/api/pdf`

- The **browser** builds HTML strings (agreement, invoice, change order, or combined body) and sends them in the **JSON body** of **`POST /api/pdf`**.
- The **server** loads fonts, sets viewport, runs Puppeteer, returns a PDF blob. Work order / invoice headers (e.g. WO #, Invoice #, CO #) come from fields in that JSON (e.g. `marginHeaderLeft`, `workOrderNumber`), matching `server/app-server.mjs` + `agreement-pdf.ts`.
- **Same origin:** the frontend posts to a relative URL (`/api/pdf`), so production deployments should put the SPA and this API behind **one** host (or a reverse proxy that makes them look like one host).

---

## Auth and product flow

**Anonymous (no Supabase session)**

- **Home → Create Work Order → JobForm → Preview.** Header shows **Sign In** only (no Work Orders, no profile gear).
- **Download & Save** opens **CaptureModal**: business name, email, password → **`signUp`**, minimal **`upsertProfile`**, **`saveWorkOrder`**, then PDF download. That is the primary **account creation** path for new contractors.

**Returning user**

- **Sign In** → **AuthPage** (email + password). There is no separate “create account” marketing funnel on that screen; new accounts are created through capture on first save (or through any future onboarding you add).

**Signed in but missing `business_profiles` row** (rare)

- Full-screen **BusinessProfileForm** until a profile exists.

**Signed in with profile**

- **Home**, **Work Orders**, **Edit profile** (gear). **Work order drafts** while editing a new job are **in-memory** until **Download & Save** persists the job (and upserts **clients** by normalized name). **Invoices** and **change orders** are persisted in Postgres; change orders are created from **Work Order detail**, and invoice wizards can attach approved change orders as line items when configured in the UI.

Session persistence is standard Supabase client behavior (refresh survives page reload).

---

## Features

- Mobile-first responsive design
- **Open product:** full agreement flow before sign-in; **account + profile stub on first Download & Save**
- Email/password auth via Supabase
- Business profile and defaults (exclusions, assumptions, warranty, payment methods, tax, WO/invoice counters, etc.) in the database
- **Work Orders** list, detail, agreement PDF re-download
- **Change orders:** wizard from detail, statuses, standalone and combined PDFs, optional inclusion on new invoices (`line_items.source` for stable edit behavior)
- **Invoices:** wizard from a work order → PDF download; persisted rows
- Job site autocomplete (optional Geoapify key)
- US phone formatting on job form and edit profile
- Work agreement generator (numbered sections), preview, **server PDF** parity, print support

---

## Tech stack

- **Vite** + **React** + **TypeScript**
- **Supabase** (auth + Postgres + RLS)
- **Node `http` server** + **Vite middleware** (dev) or **static `dist/`** (production)
- **Puppeteer Core** + **system Chrome/Chromium**
- Plain CSS — no Tailwind

---

## Project structure

```
src/
  App.tsx                    # View state machine; anonymous + authenticated flows
  components/
    AuthPage.tsx             # Sign-in (returning users)
    BusinessProfileForm.tsx  # Signed-in user missing profile row (edge case)
    CaptureModal.tsx         # Account creation on first Download & Save
    HomePage.tsx
    JobForm.tsx
    AgreementPreview.tsx
    AgreementDocumentSections.tsx
    EditProfilePage.tsx
    WorkOrdersPage.tsx, WorkOrderDetailPage.tsx
    ChangeOrderWizard.tsx
    InvoiceWizard.tsx, InvoiceFinalPage.tsx, InvoicePreviewModal.tsx
  lib/
    supabase.ts, auth.ts
    agreement-generator.ts, agreement-sections-html.ts, change-order-generator.ts
    agreement-pdf.ts, invoice-generator.ts
    job-site-address.ts, us-phone-input.ts, geoapify-autocomplete.ts
    job-to-welder-job.ts
    db/                      # profile, clients, jobs, invoices, change-orders
  hooks/useAuth.ts
  types/                     # WelderJob, DB row types
  data/sample-job.json
server/
  app-server.mjs             # HTTP server: Vite (dev) or dist (prod) + POST /api/pdf
supabase/migrations/       # Apply via CLI or dashboard SQL editor
```

---

## Database

Tables include: `business_profiles`, `clients`, `jobs`, `change_orders`, `invoices` — all with RLS.

```bash
npx supabase db push
```

Or paste each migration into Supabase Dashboard → SQL Editor.

---

## Deployment

ScopeLock **must** run as a **long-lived Node process** with **Chrome available** on that same environment. Typical shape:

1. **`npm ci`** (or `npm install`)
2. Set **`VITE_*`** vars for the build environment and run **`npm run build`**
3. Run **`NODE_ENV=production node server/app-server.mjs`** (or **`npm run preview`**) with:
   - **`PUPPETEER_EXECUTABLE_PATH`** or **`CHROME_PATH`** pointing at a real binary (in Docker, install `chromium` or Google Chrome and set the path explicitly)
   - **`HOST=0.0.0.0`** and **`PORT`** if the platform assigns a port
4. Put a **reverse proxy** (nginx, Caddy, load balancer) in front if needed; keep **one public origin** for both HTML/JS and **`/api/pdf`**
5. Optional: probe **`GET /api/pdf/health`** for readiness (returns `{"ok":true}`)

**What does not work alone:** uploading only the contents of `dist/` to static hosting with no server-side `POST /api/pdf` handler — PDF download buttons will fail.

For more detail (preview vs PDF parity, fonts, viewport), see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Roadmap

**Current priorities:** change orders, client e-sign, Stripe / ACH payments.

Full backlog and completed work: **[ARCHITECTURE.md — Roadmap](./ARCHITECTURE.md#roadmap)**.

---

## License

MIT
