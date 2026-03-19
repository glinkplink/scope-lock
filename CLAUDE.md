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
| Font | System font stack — DIN-style field notebook aesthetic |

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
```

---

## Project structure

```
src/
  App.tsx                    # Root — auth routing + onboarding state machine
  App.css                    # All app styles (field notebook design system)
  index.css                  # Base reset + font stack
  components/
    AuthPage.tsx             # Sign-in only (email + password), for returning users
    BusinessProfileForm.tsx  # Landing page for unauthenticated users AND new user step 1
    PasswordCreationPage.tsx # New user onboarding step 2 — create password
    HomePage.tsx             # Dashboard after login
    JobForm.tsx              # Work agreement form
    AgreementPreview.tsx     # Agreement preview + PDF export handoff
    EditProfilePage.tsx      # Edit existing business profile + agreement defaults
  lib/
    supabase.ts              # Supabase client singleton
    auth.ts                  # signUp, signIn, signOut
    agreement-generator.ts   # Pure functions: agreement text generation
    db/
      profile.ts             # getProfile, upsertProfile
      clients.ts             # listClients, upsertClient, deleteClient (UI not built yet)
      jobs.ts                # listJobs, createJob, updateJob, deleteJob (UI not built yet)
  hooks/
    useAuth.ts               # Supabase auth state listener
  types/
    db.ts                    # BusinessProfile, Client, Job, ChangeOrder, CompletionSignoff
    index.ts                 # WelderJob, AgreementSection, SignatureBlockData
  data/
    sample-job.json          # Default/placeholder values for new agreements
server/
  app-server.mjs            # App server + /api/pdf Puppeteer route
```

---

## Auth + onboarding flow

**New user:**
1. Lands on `BusinessProfileForm` (`isNewUser=true`) — this IS the sign-up page
2. Fills in business profile fields → clicks "Continue"
3. `PasswordCreationPage` — creates password
4. `handleCreateAccount` in `App.tsx`: calls `signUp` then `upsertProfile` together
5. Success → `HomePage`

**Returning user:**
1. Lands on `BusinessProfileForm` → clicks "Sign In"
2. `AuthPage` (email + password only)
3. "Don't have an account? Sign up" → back to `BusinessProfileForm`
4. Success → `HomePage`

**State lives in `App.tsx`:**
- `showAuthPage` — toggles between landing/onboarding and sign-in page
- `onboardingStep` — `'profile' | 'password' | null`
- `onboardingData` — holds profile fields between onboarding steps 1 and 2
- `justCompletedSignup` — prevents premature "no profile" redirect while profile saves after new signup
- `accountCreating` — shows "Creating your account..." loading state during signUp + upsertProfile
- `showSuccessBanner` — passed to `HomePage` to show welcome banner after first login
- `view` — `'home' | 'form' | 'preview' | 'profile'`

**`BusinessProfileForm` has two modes:**
- `isNewUser=true`: unauthenticated landing/signup form — calls `onContinue(profileData)` 
- Edit mode (has `userId` + `initialProfile`): authenticated profile edit — calls `onSave()`

---

## Database schema

Tables: `business_profiles`, `clients`, `jobs`, `change_orders`, `completion_signoffs`

All tables have RLS — users can only read/write their own rows (`user_id = auth.uid()`).

Key `business_profiles` columns:
- `default_exclusions text[]` — pre-populated exclusions for new agreements
- `default_assumptions text[]` — pre-populated assumptions for new agreements

Migrations are in `supabase/migrations/` — apply via Supabase CLI (`npx supabase db push`) or paste SQL into Supabase Dashboard → SQL Editor.

---

## What is and isn't persisted

| Feature | Persisted |
|---|---|
| Business profile | Yes — Supabase DB |
| Default exclusions/assumptions | Yes — Supabase DB |
| Auth session | Yes — Supabase session (survives refresh) |
| Current Work Agreement (job form state) | No — in-memory only |
| Clients | No — helpers exist, no UI yet |
| Jobs | No — helpers exist, no UI yet |
| Change orders / completion signoffs | No — schema only |

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

The PDF renderer uses the same agreement HTML/CSS as the preview through the app server's `/api/pdf` route, so preview/PDF parity is intentional.

---

## Git

- Main branch: `main`
- Active dev branch: `output`
- Push changes to `output`; merge to `main` when stable
