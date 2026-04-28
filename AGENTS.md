# Agent instructions — IronWork

This file is the **single source of truth** for every automated assistant (Cursor, Claude, Codex, and others). It defines **non‑negotiable** repo conventions. Deeper system/deployment reference lives in **[ARCHITECTURE.md](./ARCHITECTURE.md)** — load it only when the task needs that detail.

---

## Living documentation & cross-agent alignment

The following are **living documents**, not one-time setup notes:

| File | Role |
|------|------|
| **[AGENTS.md](./AGENTS.md)** (this file) | Canonical short rules for all agents; first stop |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Deep system/flow/schema/deployment reference; load on demand |
| **[CLAUDE.md](./CLAUDE.md)** | Pointer to this file (auto-loaded by Claude Code) |
| **[.cursor/rules/ScopeLock-Project-Rules.mdc](./.cursor/rules/ScopeLock-Project-Rules.mdc)** | Cursor: full project rules (`alwaysApply`); aligned with this file |
| **[.cursor/rules/high-priority.mdc](./.cursor/rules/high-priority.mdc)** | Cursor: terse guardrails (`alwaysApply`); aligned with this file |
| **[.cursor/skills/ironwork-workflow/SKILL.md](./.cursor/skills/ironwork-workflow/SKILL.md)** | Cursor: optional **project skill**—quality gates, doc-update reminders, repo touchpoints |

**Automation:** GitHub Actions runs on `main` pushes and pull requests (`.github/workflows/ci.yml` — `lint`, `test`, `build`). Optional local pre-push: commit **`.githooks/pre-push`** is in-repo; enable with `git config core.hooksPath .githooks` (see the skill for detail).

**After each substantive code change** (new pages/components, new routes, new patterns, dependency or stack changes, security or styling conventions), **review and update** whichever of these files are affected so they stay true to the codebase. File-map, flow, schema, and deployment detail belongs in **ARCHITECTURE.md**.

**When you edit any one of these files**, **compare the same topic** in the others (especially CSS co-location, HTML/`esc()` rules, architecture/deployment constraints, and file-creation discipline). **Align wording and intent** so no agent inherits conflicting guidance. If a rule is global, propagate it across AGENTS.md and the Cursor rule files, or replace duplication with a single explicit pointer—**do not leave one file silent while another mandates behavior**.

---

## CSS co-location (mandatory)

1. **Own your styles:** Co-locate styles with the page or component that owns them—same directory, `ComponentName.tsx` imports `./ComponentName.css` (or the project’s established pairing for that file).

2. **`src/App.css` scope only:** Use `App.css` for design tokens (`:root`), app shell/layout, **shared** utility classes, print/PDF globals, and other **truly cross-cutting** rules. It is **not** for styles that exist mainly to serve one screen, one wizard step, one modal, or one feature.

3. **No new feature CSS in `App.css`:** Do **not** add new page-specific or feature-specific rules to `App.css`. If a selector targets one route, page, modal, or wizard, it belongs in that owner’s co-located CSS file.

4. **New UI surfaces get a CSS file:** New pages and major components **must** ship with their own CSS file paired with the TSX (e.g. `FooPage.tsx` + `FooPage.css`).

5. **Single owner:** If a style is used by **only** one page or component, it belongs in **that** page’s or component’s CSS file—not in `App.css` and not in an unrelated sibling’s CSS.

6. **Global exceptions:** Shared badge/section labels, header chrome, and other **reused** primitives may stay in `App.css` when they are intentionally global—match existing patterns.

**Forge shell:** The interactive app uses a **dark** Forge shell (iron palette, spark accent, Outfit + Chakra Petch). Shared **shell** form panels and primary actions use dark surfaces and **spark** CTAs (`App.css`); **PDFs and on-screen agreement/invoice preview sheets** stay **light** with **Barlow** on scoped document containers so preview matches PDF—see **ARCHITECTURE.md → Design system tokens**.

---

## Related hard rules

- **HTML string generators:** User-controlled text in HTML builders must use `esc()` from `src/lib/html-escape.ts`.
- **Invoice model:** IronWork supports exactly **one standard invoice per work order/job**. Standalone change-order invoices are not supported for new behavior; approved/signature-satisfied change orders are billed only as line items on that work-order invoice. Legacy CO-only invoices may remain in the database but are hidden from normal UI flows.
- **Change-order billing gate:** A change order is billable only when it is signature-satisfied: DocuSeal `completed` or `change_orders.offline_signed_at` set. Unsigned change orders may stay visible in invoice UI, but they must remain unavailable for selection and invoice persistence must reject them server-side / DB-side.
- **Invoice issuance gate:** Invoice email send (`POST /api/invoices/:id/send`, email-only or with payment link), and payment-link creation (`POST /api/stripe/invoices/:id/payment-link`), are blocked until the parent work order is signature-satisfied (DocuSeal `completed` or `jobs.offline_signed_at` set). The server enforces this on all `/send` paths. Invoice drafts can still be created before signature.
- **Invoice lifecycle:** `issued_at = null` → Draft; **`issued_at` is set on either (a) the first successful `POST /api/invoices/:id/send`** (email-only or `include_payment_link: true`) **or (b) the first successful PDF download** via `POST /api/invoices/:id/mark-issued` (idempotent; same signature + pending-CO gates as send). This supports manual delivery (no email) while still moving the invoice out of Draft. **`POST /api/stripe/invoices/:id/payment-link` alone does not set `issued_at`.** `payment_status` / `paid_at` are updated by the Stripe webhook.
- **E-sign / invoice UI refresh:** No client interval polling for DocuSeal. Work-order and change-order detail call `GET …/status` once on open (and send/resend already refresh). **`InvoiceFinalPage`** refetches the invoice row once on mount so Stripe webhook updates (e.g. paid) show without navigating away.
- **Public branding:** Use **IronWork** for user-facing copy and product prose. Legacy internal identifiers, storage keys, repo paths, and factual filenames (for example **`ScopeLock-Project-Rules.mdc`**) may remain when renaming would risk breakage or make references inaccurate.
- **Shared rules stay shared:** If you add or tighten a repo-wide rule here, mirror it in the Cursor rule files in the same change.
- **Domain vs UI, minimal diffs, no mystery dependencies:** See **ScopeLock-Project-Rules.mdc** and **high-priority.mdc**.

When in doubt, read **ARCHITECTURE.md** for system/flow/schema/deployment detail, then apply the rules above.

**DocuSeal API / webhooks / HTML field syntax:** Prefer the **DocuSeal MCP** (`ask_docuseal`) when you need documentation-backed answers during implementation; it does not replace env secrets or live account verification.

**DocuSeal on localhost vs hosted:** Send/resend/status routes work on **`npm run dev`** / **`npm run preview`** whenever **server** env is set in `.env` / `.env.local` (`DOCUSEAL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, webhook header vars). **Hosted deploys** (e.g. Render) must define the same **non-`VITE_`** keys on the **running service**—build-time `VITE_*` alone is not enough. **Validating** customer notification emails, signed PDF layout, and webhooks against a **public URL** is done on the **deployed** app (correct env + DocuSeal webhook pointing at that origin); that is separate from whether localhost e-sign is configured.
