# ScopeLock Architecture

## Product Purpose

ScopeLock helps independent welders quickly generate short, professional job agreements for small jobs. The goal is to prevent disputes, clarify scope, and protect the welder from being blamed for issues outside their work.

The generated document is a concise 1–3 page agreement, not a long legal contract.

### Target Users (For MVP)
- Independent welders
- Small welding shops
- Mobile welders doing repair or fabrication jobs

### Primary Workflow
A welder signs up, sets up their business profile (saved to the database), then opens the app to answer a few quick questions about a job and generates a simple professional agreement they can send to the client before work begins.

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
- **Header and footer** (Work Order #, Confidential, footer `Service Provider - [business name]`,
  phone when present, page numbers) use Puppeteer `displayHeaderFooter` with `headerTemplate` /
  `footerTemplate` — they are **not** duplicated in the document body HTML. Footer uses
  `business_profiles.business_name` (not owner/welder name).
- **Body** includes the centered **Work Order** title, numbered sections, tables, and signatures
  only. Section 1 uses **plain-text** Agreement Date and Job Site Address (blue label, black value,
  no table box), then a **3-column party table** (row labels | Service Provider | Customer): header
  row is all light-blue cells; **Name**, **Phone**, and **Email** label cells match other agreement
  tables; values are white. Profile fills the SP column; the form fills the customer column.
- **Optional sections**: Exclusions, Customer Obligations, Workmanship Warranty (when days is 0),
  and Dispute Resolution (when negotiation days is 0) are omitted when empty or zero. **Section
  numbers are assigned at render time** (1…n with no gaps); the signature block stays unnumbered.
- **Governing state** is not collected on the work order form; dispute copy uses generic
  “applicable state” language.

## Folder Structure

```
scope-lock/
├── src/
│   ├── components/
│   │   ├── AuthPage.tsx              # Sign up / sign in form
│   │   ├── BusinessProfileForm.tsx   # First-time onboarding form
│   │   ├── EditProfilePage.tsx       # Edit profile + agreement defaults
│   │   ├── HomePage.tsx              # Post-login landing page
│   │   ├── JobForm.tsx               # Work Agreement input form
│   │   └── AgreementPreview.tsx      # Agreement preview + Puppeteer PDF handoff
│   ├── data/
│   │   └── sample-job.json           # Fallback defaults for new agreements
│   ├── hooks/
│   │   └── useAuth.ts                # Auth state hook (Supabase session)
│   ├── lib/
│   │   ├── supabase.ts               # Supabase client singleton
│   │   ├── auth.ts                   # signUp / signIn / signOut helpers
│   │   ├── agreement-generator.ts    # Pure domain logic: agreement text generation
│   │   └── db/
│   │       ├── profile.ts            # getProfile / upsertProfile
│   │       ├── clients.ts            # listClients / upsertClient / deleteClient
│   │       └── jobs.ts               # listJobs / createJob / updateJob / deleteJob
│   ├── types/
│   │   ├── index.ts                  # WelderJob, AgreementSection, SignatureBlockData
│   │   └── db.ts                     # BusinessProfile, Client, Job, ChangeOrder, CompletionSignoff
│   ├── App.tsx                       # Root component - view state machine
│   └── main.tsx                      # Entry point
├── server/
│   └── app-server.mjs               # App server + /api/pdf Puppeteer route
├── supabase/
│   ├── config.toml                   # Supabase CLI config
│   └── migrations/
│       ├── 0001_initial_schema.sql   # All 5 tables + indexes + triggers + RLS
│       └── 0002_add_default_exclusions_assumptions.sql
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
[Not signed in] → AuthPage (sign up / sign in)
      ↓
[Signed in, no profile] → BusinessProfileForm (onboarding)
      ↓
[Profile exists] → HomePage ("Create Work Agreement")
      ↓
CTA button → JobForm (Work Agreement details)
      ↓
Tab nav → AgreementPreview (Print / Download PDF)
      ↓
Header "Edit Profile" → EditProfilePage (edit business info + defaults)
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
- `db/profile.ts`: Profile CRUD
- `db/clients.ts`: Client CRUD (helpers ready, UI not yet built)
- `db/jobs.ts`: Job CRUD (helpers ready, jobs still in-memory in UI)

### UI Components (`src/components/`)
- React components for user interaction
- Form state management
- Mobile-first responsive design

### Type Definitions (`src/types/`)
- `index.ts`: WelderJob and agreement types (used by domain logic + UI)
- `db.ts`: Database row types matching Supabase schema

## Database Schema

Five tables in Supabase Postgres, all with row-level security:

| Table | Key Columns |
|---|---|
| `business_profiles` | user_id (unique), business_name, owner_name, phone, email, address, google_business_profile_url, default_exclusions[], default_assumptions[] |
| `clients` | user_id, name, phone, email, address, notes |
| `jobs` | user_id, client_id, all WelderJob fields, status |
| `change_orders` | user_id, job_id, description, price_delta, time_delta, approved |
| `completion_signoffs` | user_id, job_id, client_name, signed_at, notes |

All tables use `auth.uid()` RLS policies: users can only read/write their own rows.

## What Is and Isn't Persisted

| Feature | Persisted | Notes |
|---|---|---|
| Business profile | Yes | Supabase DB |
| Default exclusions/assumptions | Yes | Supabase DB, pre-populate new agreements |
| Auth session | Yes | Supabase session (survives refresh) |
| Work Agreement (current job) | In-memory while editing | **Download & Save** persists via `saveWorkOrder` |
| Clients | No | DB helpers exist, UI not yet built |
| Change orders | No | Schema only |
| Completion signoffs | No | Schema only |

## Portability Considerations

### Current (Web MVP)
- Runs in browser
- Auth + profile persistence via Supabase
- Job agreements are in-memory (no per-job persistence yet)
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
- [x] Business profile persistence
- [x] Default exclusions/assumptions saved to profile
- [x] Authenticated landing page (Home)
- [x] Edit Profile page

### Near-Term
- [ ] Research standard welder work agreements/ contracts and edit ours to
      match
- [ ] Deploy the app server and Puppeteer route alongside production hosting
- [ ] Client list and client selection UI - user's clients are saved in DB so their details can we auto-filled later in future work orders.
- [ ] Custom branding (logo)
- [ ] Add a 'Generate Invoice' function that allows the user to easily create/ send an invoice based on their work agreement. 

### Later
- [ ] Multiple agreement templates
- [ ] Change order flow (schema exists)
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
VITE_SUPABASE_URL=     # Supabase project URL
VITE_SUPABASE_ANON_KEY= # Supabase anon (public) key
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
