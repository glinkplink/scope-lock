# IronWork — "Forge" UI Redesign Tracker

Dark-mode, mobile-first redesign based on `newUI.html`. Target: demo-ready on phone.
Design system target: **Outfit** (body) + **Chakra Petch** (headings/mono) with spark-orange accents and deep iron backgrounds.

**Rule:** PDFs and generated HTML stay light-mode. Only the app shell and interactive UI surfaces get the dark treatment.

**Important implementation note:** this is not a pure CSS pass. Several sections require prop changes, shell/navigation work, and in some cases explicit backend scope decisions.

---

## Status Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

---

## Preflight Decisions

These need to be treated as explicit scope decisions before implementation starts.

- [x] **Design-system reset is intentional**
  - Forge shell shipped for Sections 1–2; `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and Cursor rules updated to match.
- [x] **Bottom navigation behavior is defined**
  - Global bottom nav cannot simply replace the current draft-flow tabs.
  - `form` and `preview` currently rely on the shell-level `tab-nav` to switch between edit and preview.
  - **Decision:** contextual **`tab-nav`** for `form` / `preview` is **kept**; bottom nav is only for top-level signed-in routes (Home, Work Orders, Profile, create FAB).
- [ ] **Work Orders filtering/search scope is defined**
  - Current list data comes from `list_work_orders_dashboard_page(userId, limit, cursor)` with no server-side search/filter args.
  - Decision: phase 1 uses client-side filtering on loaded rows only, or phase 2 adds backend support.

---

## Section 1 — Tokens + Fonts + Root Shell
**Files:** `src/index.css`, `src/App.css` (`:root` + shared shell only), `index.html`
**Impact:** Establishes dark-mode baseline without touching PDF/document rendering.
**Effort:** ~45 min

### Changes
- [x] Add Google Fonts import for `Chakra Petch` + `Outfit` in `index.html`
- [x] Remove `Teko` from active UI usage; keep only if needed as fallback during migration
- [x] Replace app-shell tokens in `src/App.css :root`
  - Add iron palette, spark accent tokens, shared status tokens, surface tokens, radius scale, shell sizing tokens
  - Keep agreement/PDF variables intact
  - Keep spacing scale unless a concrete component requires changes
- [x] Update `src/index.css`
  - Change `color-scheme: light` to match the new app shell
  - Ensure base text/background defaults do not fight dark mode
- [x] Update `body`
  - `font-family: 'Outfit'`
  - dark background / light text
  - optional grain overlay if it remains subtle and does not hurt readability
- [x] Update `.app` and `#root` shell sizing
  - Actual root element is `#root`, not `#app`
  - Constrain mobile shell width and center it without breaking desktop usability
- [x] Add global `@media (prefers-reduced-motion: reduce)` handling

### Notes
- This section should not introduce page-specific CSS into `App.css`.
- Shared tokens, shell layout, and cross-cutting primitives belong in `App.css`; feature-specific rules stay co-located.

---

## Section 2 — App Shell + Navigation
**Files:** `src/App.tsx`, `src/App.css`
**Impact:** Highest visual impact, but must preserve current navigation behavior.
**Effort:** ~1.5 hours

### Current constraints
- Header actions differ for signed-out vs signed-in users.
- Work-order draft flow uses `form` and `preview` views with a dedicated shell-level tab switcher.
- There is no `handleNewWorkOrder` function today; the existing action is `draftFlow.createNewAgreement`.

### Changes
- [x] Restyle the header
  - sticky top
  - new logo mark treatment
  - dark action buttons
  - remove any unused tagline treatment
- [x] Add a signed-in bottom nav for stable top-level destinations
  - `Home`
  - `Work Orders`
  - `Profile`
  - center create action wired to `draftFlow.createNewAgreement`
- [x] Keep signed-out shell simple
  - no authenticated destinations shown
  - preserve `Sign In`
- [x] Preserve draft-flow switching
  - keep a contextual `Edit Work Order / Preview` switcher for `view === 'form' || view === 'preview'`
  - this can be restyled, but should not disappear unless an equivalent replacement exists
- [x] Add bottom padding to `.app-main` where needed so fixed nav does not cover content
- [x] Review footer treatment
  - remove or restyle if it clashes with the phone-shell presentation

### Do not do
- [ ] Do not globally replace the current draft tabs with Home / Work Orders / Profile and call it done *(constraint respected in Sections 1–2 implementation)*

---

## Section 3 — Shared Buttons + Form Primitives
**Files:** `src/App.css` (shared primitives only)
**Impact:** Unblocks visual consistency across forms, modals, detail pages, and wizards.
**Effort:** ~45 min

### Changes
- [x] Normalize shared button classes
  - primary
  - secondary
  - success
  - danger
  - full-width utility
- [x] Restyle shared `.form-group` inputs/selects/textareas for dark mode
- [x] Restyle shared `.form-section`
- [x] Restyle shared section headings / labels where they are intentionally cross-cutting
- [x] Update shared select-arrow asset color for dark mode
- [x] Keep focus states strong and accessible

### Notes
- If a button or field style exists mainly for one screen, move it into that screen’s CSS instead of growing `App.css`.

---

## Section 4 — HomePage Dashboard
**Files:** `src/components/HomePage.tsx`, `src/components/HomePage.css`, `src/App.tsx`
**Impact:** First screen for both demo and logged-in use.
**Effort:** ~1.5 to 2 hours

### Current constraints
- `HomePage` is currently a static CTA page.
- `App.tsx` only passes `onCreateAgreement`.
- Signed-in dashboard content needs new props or local data loading.

### Changes
- [ ] Replace signed-out state with the new simplified hero
  - remove current “Cover your ass.” messaging
  - keep a clear single CTA
- [ ] Add signed-in dashboard state
  - greeting
  - stats
  - quick actions
  - recent work orders
- [ ] Add data plumbing
  - either fetch summary/recent jobs inside `HomePage`
  - or pass them from `App.tsx`
- [ ] Add “Work Orders” quick action
- [ ] Reuse visual card system planned for the Work Orders list

### Data scope
- [ ] Use `get_work_orders_dashboard_summary` for totals
- [ ] Define a concrete source for “recent work orders”
  - either first page of `list_work_orders_dashboard_page`
  - or a dedicated helper

---

## Section 5 — Work Orders List Refresh
**Files:** `src/components/WorkOrdersPage.tsx`, `src/components/WorkOrdersPage.css`
**Impact:** High-value daily-use screen.
**Effort:** ~2 to 3 hours for visual refresh, more if backend filtering/search is added

### Changes
- [ ] Refresh toolbar styling and CTA treatment
- [ ] Convert rows to card treatment if it improves scanability on mobile
- [ ] Replace current summary strip styling with new dashboard cards
- [ ] Add improved empty state
- [ ] Preserve existing operational affordances
  - open detail
  - open change-orders section
  - invoice entry points
  - profile-completion nudge

### Optional phase 2
- [ ] Add status chips
- [ ] Add search field

### Constraint
- [ ] Status chips/search need an explicit data decision
  - client-side filtering of already loaded rows only
  - or backend/RPC changes for full dataset behavior

### Status model
- [ ] Do not collapse real business states too aggressively
  - work-order e-sign progress still matters
  - invoice states include `draft`, `invoiced`, `paid`, and `paid offline`

---

## Section 6 — Job Form
**Files:** `src/components/JobForm.tsx`, `src/components/JobForm.css`
**Impact:** Core demo flow.
**Effort:** ~1 to 1.5 hours

### Changes
- [ ] Add dark-shell form treatment
- [ ] Restyle headings, sections, inputs, textareas, select controls
- [ ] Restyle checkbox groups and autocomplete dropdowns
- [ ] Add spacing to avoid bottom-nav overlap where necessary
- [ ] If a back row is added, wire it to actual navigation instead of making it decorative

### Constraint
- [ ] Preserve existing structured address autocomplete and client-search interactions

---

## Section 7 — Agreement Preview Shell
**Files:** `src/components/AgreementPreview.tsx`, `src/components/AgreementPreview.css`
**Impact:** Demo-critical screen.
**Effort:** ~1 to 1.5 hours

### Changes
- [ ] Keep document content light-mode
- [ ] Darken only the surrounding preview shell/chrome
- [ ] Restyle action areas and status strips
- [ ] Make preview card feel distinct from the shell
- [ ] Keep scaled-preview behavior intact

### Constraint
- [ ] Do not change agreement generation logic or document markup in ways that affect PDF output

---

## Section 8 — Work Order Detail Page
**Files:** `src/components/WorkOrderDetailPage.tsx`, `src/components/WorkOrderDetailPage.css`
**Impact:** Used from Work Orders and during demo.
**Effort:** ~1.5 to 2 hours

### Changes
- [ ] Restyle header and back affordance
- [ ] Apply light-document-in-dark-shell treatment to the agreement section
- [ ] Refresh e-sign timeline visuals
- [ ] Restyle invoice status strip and change-order cards
- [ ] Restyle offline-sign controls
- [ ] Move page-only styles into `WorkOrderDetailPage.css`

### Status model
- [ ] Preserve invoice distinctions already present in code
  - `Draft`
  - `Invoiced`
  - `Paid`
  - `Paid Offline`

---

## Section 9 — Capture Modal
**Files:** `src/components/CaptureModal.tsx`, `src/components/CaptureModal.css`
**Impact:** Critical anonymous-save conversion point.
**Effort:** ~45 min

### Changes
- [ ] Dark backdrop
- [ ] Dark card
- [ ] Shared form/input treatment
- [ ] Shared primary CTA treatment
- [ ] Accessible focus and error styling

---

## Section 10 — Auth Page
**Files:** `src/components/AuthPage.tsx`, `src/components/AuthPage.css`
**Impact:** Return-user path.
**Effort:** ~45 min

### Changes
- [ ] Dark full-page auth surface
- [ ] Card layout
- [ ] Logo/title treatment
- [ ] Shared input/button primitives
- [ ] Clear error state treatment

---

## Section 11 — Invoice Wizard
**Files:** `src/components/InvoiceWizard.tsx`, `src/components/InvoiceWizard.css`
**Impact:** Stripe demo path.
**Effort:** ~1 to 1.5 hours

### Changes
- [ ] Refresh step indicator
- [ ] Restyle line items and totals panel
- [ ] Restyle CO picker chips
- [ ] Apply shared form/button system

---

## Section 12 — Invoice Final Page
**Files:** `src/components/InvoiceFinalPage.tsx`, `src/components/InvoiceFinalPage.css`
**Impact:** End of invoice flow.
**Effort:** ~1 to 1.5 hours

### Changes
- [ ] Keep invoice preview document light-mode
- [ ] Dark shell around the preview
- [ ] Restyle page controls and status badges
- [ ] Preserve current one-time invoice refetch on mount
- [ ] Keep payment-link and send actions behaviorally unchanged

### Constraint
- [ ] Do not lose signature gating or webhook-driven status handling

---

## Section 13 — Change Order Wizard + Detail
**Files:** `src/components/ChangeOrderWizard.tsx`, `src/components/ChangeOrderWizard.css`, `src/components/ChangeOrderDetailPage.tsx`, `src/components/ChangeOrderDetailPage.css`
**Impact:** Demo stretch path.
**Effort:** ~2 hours

### Changes
- [ ] Refresh wizard step visuals
- [ ] Apply shared dark form treatment
- [ ] Match detail-shell pattern used by work-order detail
- [ ] Restyle status badges and actions

### Status model
- [ ] Preserve actual change-order states
  - `draft`
  - `pending_approval`
  - `approved`
  - `rejected`
- [ ] Do not remap `rejected` to a generic overdue color/state without a deliberate product decision

---

## Section 14 — Invoice Preview Modal
**Files:** `src/components/InvoicePreviewModal.tsx`, `src/components/InvoicePreviewModal.css`
**Impact:** Nice polish, low architecture risk.
**Effort:** ~30 min

### Changes
- [ ] Dark full-screen modal shell
- [ ] Restyled close control
- [ ] Light document preview card inside

---

## Section 15 — Edit Profile Page
**Files:** `src/components/EditProfilePage.tsx`, `src/components/EditProfilePage.css`
**Impact:** Signed-in settings path.
**Effort:** ~1 hour

### Changes
- [ ] Restyle page header
- [ ] Apply shared form treatment
- [ ] Refresh Stripe Connect status block
- [ ] Keep all existing behavior and validation

---

## Section 16 — Business Profile Form
**Files:** `src/components/BusinessProfileForm.tsx`, `src/components/BusinessProfileForm.css`
**Impact:** Edge-case only.
**Effort:** ~45 min

### Changes
- [ ] Align with Edit Profile visual system
- [ ] Apply shared form/button primitives

---

## Optional — Toast System
**Files:** `src/components/Toast.tsx`, `src/components/Toast.css`, likely `src/App.tsx`
**Impact:** Useful, not required for the redesign.
**Effort:** ~1 to 2 hours

### Changes
- [ ] Only add if event wiring is worth the scope
- [ ] Fixed placement must not conflict with bottom nav or modal flows

---

## Do NOT Change

These are not redesign targets unless there is a deliberate product/architecture decision.

- `src/lib/agreement-generator.ts`
- `src/lib/invoice-generator.ts`
- `src/lib/docuseal-agreement-html.ts`
- `src/lib/docuseal-change-order-html.ts`
- `src/lib/change-order-generator.ts`
- `src/lib/agreement-sections-html.ts`
- `src/lib/change-order-document.css`
- `src/components/AgreementDocumentSections.tsx`
- `server/`

---

## Execution Order

This order reflects the real dependency graph in the current codebase.

| # | Section | Est. | Why first |
|---|---|---:|---|
| 0 | Preflight decisions | 15–30m | Avoids navigation and data-scope churn |
| 1 | Tokens + Root Shell | 45m | Baseline for all screens |
| 2 | App Shell + Navigation | 1.5h | Highest-impact shell work; must preserve flow |
| 3 | Shared Buttons + Form Primitives | 45m | Unblocks all remaining surfaces |
| 4 | HomePage Dashboard | 1.5–2h | Requires data and prop work |
| 5 | Work Orders List Refresh | 2–3h | Main signed-in screen |
| 6 | Job Form | 1–1.5h | Core creation flow |
| 7 | Agreement Preview Shell | 1–1.5h | Core demo flow |
| 8 | Work Order Detail | 1.5–2h | Needed from list/demo path |
| 9 | Capture Modal | 45m | Anonymous save flow |
| 10 | Auth Page | 45m | Return-user path |
| 11 | Invoice Wizard | 1–1.5h | Stripe flow |
| 12 | Invoice Final Page | 1–1.5h | Stripe flow |
| 13 | Change Order Wizard + Detail | 2h | Demo stretch |
| 14 | Invoice Preview Modal | 30m | Isolated polish |
| 15 | Edit Profile | 1h | Settings path |
| 16 | Business Profile Form | 45m | Edge case |
| 17 | Toast System | 1–2h | Optional |

### Realistic time ranges
- **Demo-critical visual pass (through Section 9):** ~10–13 hours
- **Full redesign with invoice/CO/profile surfaces:** ~14–18 hours
- **Add full Work Orders search/filter backend support:** extra scope, not included above

---

## Implementation Discipline

- [ ] Keep page-specific CSS co-located with the owning component
- [ ] Use `App.css` only for tokens, shell, shared utilities, and truly cross-cutting rules
- [ ] Preserve all document/PDF light-mode output
- [ ] Preserve current business states and gating rules
- [ ] Update tests that assert old copy, shell controls, or old visual-state labels
- [ ] If the Forge design system ships, update the living docs in the same implementation set
