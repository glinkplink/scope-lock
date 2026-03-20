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
- Email/password authentication (Supabase)
- Business profile stored in database
- Reusable default exclusions and assumptions saved to profile
- Work Agreement generator (12 sections)
- Agreement preview
- PDF download rendered through the app server with Puppeteer for preview parity
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
```

## Project Structure

```
src/
  App.tsx                    # Root — auth routing + onboarding state machine
  components/
    AuthPage.tsx             # Sign-in page (returning users)
    BusinessProfileForm.tsx  # Landing page / new user onboarding step 1
    PasswordCreationPage.tsx # New user onboarding step 2
    HomePage.tsx             # Dashboard after login
    JobForm.tsx              # Work agreement form
    AgreementPreview.tsx     # Agreement preview + PDF export handoff
    EditProfilePage.tsx      # Edit business profile + agreement defaults
  lib/
    supabase.ts              # Supabase client
    auth.ts                  # signUp, signIn, signOut
    agreement-generator.ts   # Agreement text generation
    db/
      profile.ts             # getProfile, upsertProfile
      clients.ts             # listClients, upsertClient, deleteClient
      jobs.ts                # listJobs, createJob, updateJob, deleteJob
  hooks/
    useAuth.ts               # Supabase auth state listener
  types/
    index.ts                 # WelderJob and agreement types
    db.ts                    # BusinessProfile, Client, Job etc.
  data/
    sample-job.json          # Default/placeholder values for new agreements
server/
  app-server.mjs             # App server + /api/pdf Puppeteer route
supabase/
  migrations/               # Apply via Supabase CLI or dashboard SQL editor
    0001_initial_schema.sql
    0002_add_default_exclusions_assumptions.sql
```

## Auth + Onboarding Flow

**New user:**
1. Lands on `BusinessProfileForm` (sign-up + profile in one)
2. Fills in business details → Continue
3. `PasswordCreationPage` → creates Supabase account + saves profile
4. Redirects to `HomePage`

**Returning user:**
1. Lands on `BusinessProfileForm` → clicks "Sign In"
2. `AuthPage` (email + password)
3. Redirects to `HomePage`

## Database

Four tables: `business_profiles`, `clients`, `jobs`, `change_orders`

All tables use RLS — users can only access their own rows.

Apply migrations via Supabase CLI:
```bash
npx supabase db push
```
Or paste each migration file into Supabase Dashboard → SQL Editor.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for stack rationale, data flow, and roadmap.

## License

MIT
