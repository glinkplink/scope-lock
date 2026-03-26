# Work Orders Data Fetch Plan (Revised)

## Why this plan is the right one

This plan targets the layer that is actually causing user-facing slowness:

- `WorkOrdersPage` is a list/dashboard screen, so **fast initial render** matters most.
- The codebase already separates jobs/invoices via DB helpers in `src/lib/db/`, so adding specialized lightweight queries fits existing architecture.
- Existing `optimization.md` work appears to focus more on structural refactor, not runtime fetch-path performance.

---

## Recommended execution order

## 1) Keep optimization.md test guardrail
- Run tests before changes.
- Keep tests green throughout.

> This remains the safety baseline for all perf changes.

---

## 2) Implement A + B + C first (highest ROI, lowest risk)

### A) Decouple rendering from invoice fetch
- File: `src/components/WorkOrdersPage.tsx`
- Ensure rows render from jobs data alone.
- Do **not** require invoice data to render list rows.
- Treat invoice state as progressive enhancement:
  - rows appear first
  - invoice badge/action resolves after invoice-status fetch

### B) Add specialized jobs query for Work Orders (do not blindly mutate broad query)
- File: `src/lib/db/jobs.ts`
- Keep existing `listJobs` if used elsewhere.
- Add a dedicated helper (e.g. `listJobsForWorkOrders`) selecting only list-view columns:
  - `id, wo_number, customer_name, job_type, agreement_date, created_at, price`

### C) Add specialized lightweight invoice-status query
- File: `src/lib/db/invoices.ts`
- Add dedicated helper (e.g. `listInvoiceStatusByJob`) selecting only:
  - `id, job_id, status, invoice_number, created_at`
- Keep full invoice helpers unchanged for detail/edit flows.

---

## 3) Delay D to phase 2 (only if still needed)
- Start simple with a hard initial cap:
  - newest 25–50 jobs
  - optional “Load more”
- Avoid building full pagination upfront unless A/B/C still leave the page sluggish.

---

## 4) Put E last (index tuning)
Only do DB index tuning if:
- Supabase/Postgres query analysis confirms slow plans, or
- dataset growth makes it likely soon, or
- app is still slow after query-shape/render-decoupling fixes.

Potential index follow-ups (if needed):
- `jobs(user_id, created_at desc)`
- `invoices(user_id, created_at desc)`

---

## Tightened acceptance criteria

- Work Orders rows render as soon as jobs fetch completes.
- First visible rows render even if invoice query is slow or fails.
- Invoice actions/badges progressively appear after invoice-status fetch.
- Initial payload size is reduced versus current implementation.
- No regression in invoice edit/detail flows (full invoice helpers still intact).

---

## Practical sequence against optimization.md

1. Keep tests green (optimization.md rule).
2. Ship A, B, C for Work Orders fetch path.
3. Add simple cap + optional “Load more” only if needed.
4. Re-measure perceived speed.
5. Resume broader optimization.md structural work (App state extraction/CSS split).
6. Apply index tuning only if validated by query evidence.

---

## Bottom line

- **Do now:** A + B + C  
- **Maybe next:** capped fetch + Load more  
- **Later:** index tuning  
- **After perf fix:** continue structural refactors from optimization.md

This sequence maximizes UX improvement quickly while minimizing regression risk.