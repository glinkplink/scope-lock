/**
 * Owner first/last capture for users without a profile (anonymous / WO flow before profile exists).
 * Single source for normalization, completeness check, and user-facing copy.
 */

/** Shown when first or last name is missing before Preview or before capture (shared message). */
export const OWNER_NAME_INCOMPLETE_MESSAGE =
  'Enter your first and last name on the work order form (Your Name section).';

/** Trim each part, collapse internal runs of spaces, join with a single space. */
export function normalizeOwnerFullName(firstName: string, lastName: string): string {
  const f = firstName.trim().replace(/\s+/g, ' ');
  const l = lastName.trim().replace(/\s+/g, ' ');
  return `${f} ${l}`.trim();
}

export function isOwnerNameComplete(firstName: string, lastName: string): boolean {
  return firstName.trim().length > 0 && lastName.trim().length > 0;
}

/** Null when both names are present; otherwise the shared incomplete message. */
export function getOwnerNameCaptureBlockReason(
  firstName: string,
  lastName: string
): string | null {
  if (isOwnerNameComplete(firstName, lastName)) return null;
  return OWNER_NAME_INCOMPLETE_MESSAGE;
}
