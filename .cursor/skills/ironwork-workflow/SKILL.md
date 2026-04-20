---
name: ironwork-workflow
description: >-
  IronWork (scope-lock) repo workflow: quality gates, doc updates, security
  and layout rules. Use before finishing a substantive change, opening a PR, or
  when touching server routes, Supabase, HTML generators, or new UI surfaces.
---

# IronWork — agent workflow

## First reads

- **Canonical rules:** [AGENTS.md](../../../AGENTS.md) at repo root.
- **System/flow/schema/deployment + DocuSeal/Stripe:** [ARCHITECTURE.md](../../../ARCHITECTURE.md).

Cursor also applies [.cursor/rules/ScopeLock-Project-Rules.mdc](../../rules/ScopeLock-Project-Rules.mdc) and [high-priority.mdc](../../rules/high-priority.mdc); this skill is a **checklist**, not a replacement.

## Commands (local quality gate)

From repo root after dependency changes or before a PR:

```bash
npm run lint
npm run test
npm run build   # when TS, Vite, or build graph changed
```

## After substantive code changes

Update the **living docs** that are now wrong or incomplete (same session as the code change when possible): `AGENTS.md`, `ARCHITECTURE.md`, and Cursor rule files if global guidance changed—keep them **aligned** on the same topics (CSS co-location, `esc()`, deployment, invoice/e-sign rules). File-map, flow, schema, and deployment detail belongs in `ARCHITECTURE.md`.

## High-impact invariants

- **HTML string generators** (`src/lib/*generator*.ts`, `docuseal-*.ts`, `agreement-sections-html.ts`, etc.): user-controlled text through **`esc()`** from `src/lib/html-escape.ts`.
- **CSS:** Co-locate with the owning page/component (`Foo.tsx` + `Foo.css`); do not add new feature-specific rules to `src/App.css` except shared shell/tokens (see AGENTS.md).
- **Domain vs UI:** Business logic in `src/lib/` and `src/db/`; avoid coupling domain to React except at boundaries.
- **Schema field names:** Match `src/types/db.ts`, forms, generators, and samples—no invented columns.
- **Supabase:** Migrations live in `supabase/migrations/`; do not assume RLS or RPC behavior that is not in migrations or docs.

## Server / e-sign / payments touchpoints

- App server entry: `server/app-server.mjs`; e-sign routes `server/esign-routes.mjs`; Stripe `server/stripe-routes.mjs`.
- If behavior or env vars change, update **ARCHITECTURE.md** (and AGENTS.md if a repo-wide rule shifted).

## Optional git hook (team choice)

The repo includes **`.githooks/pre-push`** (`npm run lint` + `npm run test`). Enable once per clone:

```bash
git config core.hooksPath .githooks
```

Ensure the script is executable (`chmod +x .githooks/pre-push`) if your checkout strips the bit.

Use **pre-push** (not pre-commit) if you want to allow quick WIP commits without blocking.

## CI

**`.github/workflows/ci.yml`** runs on pushes to `main` and on pull requests: `npm ci`, `lint`, `test`, `build`. Requires **GitHub Actions** enabled for the repository (org policy may need an admin).
