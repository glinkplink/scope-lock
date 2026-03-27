# Agent instructions — ScopeLock

This file is for **every** automated assistant (Cursor, Claude, Codex, and others). It defines **non‑negotiable** repo conventions. Full product context lives in **[CLAUDE.md](./CLAUDE.md)**, and deeper system/deployment reference lives in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Living documentation & cross-agent alignment

The following are **living documents**, not one-time setup notes:

| File | Role |
|------|------|
| **[AGENTS.md](./AGENTS.md)** (this file) | Short canonical rules for all agents; first stop for shared repo rules |
| **[CLAUDE.md](./CLAUDE.md)** | Deep project memory: stack, flows, structure, design system, and detailed architecture notes |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | System architecture, deployment, operational constraints, and longer-form implementation reference |
| **[.cursor/rules/ScopeLock-Project-Rules.mdc](./.cursor/rules/ScopeLock-Project-Rules.mdc)** | Cursor: full project + product rules (`alwaysApply`); should mirror the same global rules |
| **[.cursor/rules/high-priority.mdc](./.cursor/rules/high-priority.mdc)** | Cursor: terse guardrails (`alwaysApply`); should reinforce the same highest-priority global rules |

**After each substantive code change** (new pages/components, new routes, new patterns, dependency or stack changes, security or styling conventions), **review and update** whichever of these files are affected so they stay true to the codebase.

**When you edit any one of these files**, **compare the same topic** in the others (especially CSS co-location, HTML/`esc()` rules, architecture/deployment constraints, and file-creation discipline). **Align wording and intent** so no agent inherits conflicting guidance. If a rule is global, propagate it everywhere that carries global rules, or replace duplication with a single explicit pointer—**do not leave one file silent while another mandates behavior**.

---

## CSS co-location (mandatory)

1. **Own your styles:** Co-locate styles with the page or component that owns them—same directory, `ComponentName.tsx` imports `./ComponentName.css` (or the project’s established pairing for that file).

2. **`src/App.css` scope only:** Use `App.css` for design tokens (`:root`), app shell/layout, **shared** utility classes, print/PDF globals, and other **truly cross-cutting** rules. It is **not** for styles that exist mainly to serve one screen, one wizard step, one modal, or one feature.

3. **No new feature CSS in `App.css`:** Do **not** add new page-specific or feature-specific rules to `App.css`. If a selector targets one route, page, modal, or wizard, it belongs in that owner’s co-located CSS file.

4. **New UI surfaces get a CSS file:** New pages and major components **must** ship with their own CSS file paired with the TSX (e.g. `FooPage.tsx` + `FooPage.css`).

5. **Single owner:** If a style is used by **only** one page or component, it belongs in **that** page’s or component’s CSS file—not in `App.css` and not in an unrelated sibling’s CSS.

6. **Global exceptions:** Shared badge/section labels, header chrome, and other **reused** primitives may stay in `App.css` when they are intentionally global—match existing patterns (see CLAUDE.md structure tree comments).

---

## Related hard rules

- **HTML string generators:** User-controlled text in HTML builders must use `esc()` from `src/lib/html-escape.ts` (see CLAUDE.md → “Generated HTML strings”).
- **Shared rules stay shared:** If you add or tighten a repo-wide rule here, mirror it in `CLAUDE.md` and the Cursor rule files in the same change.
- **Domain vs UI, minimal diffs, no mystery dependencies:** See **ScopeLock-Project-Rules.mdc** and **high-priority.mdc**.

When in doubt, read **CLAUDE.md** for product/context detail and **ARCHITECTURE.md** for system/deployment detail, then apply the rules above.
