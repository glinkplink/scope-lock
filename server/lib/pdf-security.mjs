/**
 * Safe filename for Content-Disposition (blocks CRLF injection and path tricks).
 * @param {unknown} input
 * @returns {string}
 */
export function sanitizePdfContentDispositionFilename(input) {
  const fallback = 'document.pdf';
  if (input == null || typeof input !== 'string') return fallback;
  let s = input.trim().replace(/[\r\n\u0000]/g, '').replace(/["<>]/g, '');
  s = s.replace(/^.*[/\\]/, '');
  if (!s || /^\.+$/.test(s)) return fallback;
  s = s.slice(0, 200);
  if (!/\.pdf$/i.test(s)) {
    s = `${s}.pdf`;
  }
  return s || fallback;
}

/**
 * Minimal allowlist for Puppeteer PDF rendering (SSRF guard).
 * Allows data:, about:, and Google Fonts hosts used by agreement/invoice PDF HTML.
 * @param {string} urlString
 */
export function isAllowedPdfResourceUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) return false;
  try {
    const u = new URL(urlString);
    if (u.protocol === 'data:') return true;
    if (u.protocol === 'about:') return true;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com';
  } catch {
    return false;
  }
}
