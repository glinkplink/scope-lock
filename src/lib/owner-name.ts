/**
 * Normalize owner first + last for `business_profiles.owner_name` and agreement preview stubs.
 * Same join rule is used for customer first/last → `jobs.customer_name` / `WelderJob.customer_name`.
 */

/** Trim each part, collapse internal runs of spaces, join with a single space. */
export function normalizeOwnerFullName(firstName: string, lastName: string): string {
  const f = firstName.trim().replace(/\s+/g, ' ');
  const l = lastName.trim().replace(/\s+/g, ' ');
  return `${f} ${l}`.trim();
}

/**
 * Split a stored full name into two form fields (first token = first name, rest = last).
 * Inverse of {@link normalizeOwnerFullName} for typical "Jane Smith" style names.
 */
export function splitFullNameForForm(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, ' ');
  if (!t) return { first: '', last: '' };
  const i = t.indexOf(' ');
  if (i === -1) return { first: t, last: '' };
  return { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}
