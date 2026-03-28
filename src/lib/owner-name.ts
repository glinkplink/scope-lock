/**
 * Normalize owner first + last for `business_profiles.owner_name` and agreement preview stubs.
 */

/** Trim each part, collapse internal runs of spaces, join with a single space. */
export function normalizeOwnerFullName(firstName: string, lastName: string): string {
  const f = firstName.trim().replace(/\s+/g, ' ');
  const l = lastName.trim().replace(/\s+/g, ' ');
  return `${f} ${l}`.trim();
}
