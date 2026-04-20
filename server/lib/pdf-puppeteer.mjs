import { isAllowedPdfResourceUrl } from './pdf-security.mjs';

/**
 * SSRF-harden PDF rendering: block page scripts, allow minimal network for Google Fonts + data:/about:.
 * @param {import('puppeteer-core').Page} page
 */
export async function preparePdfPageForRendering(page) {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    try {
      if (isAllowedPdfResourceUrl(request.url())) {
        void request.continue();
      } else {
        void request.abort();
      }
    } catch {
      try {
        void request.abort();
      } catch {
        /* ignore */
      }
    }
  });
}
