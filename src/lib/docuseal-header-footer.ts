import type { WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import { esc } from './html-escape';
import { getPdfFooterBusinessName, getPdfFooterPhone } from './agreement-pdf';

/** Footer provider line for DocuSeal header/footer (matches PDF footer intent). */
export function buildDocusealEsignFooterLine(
  profile: BusinessProfile | null,
  welderJob: WelderJob
): string {
  const name = getPdfFooterBusinessName(profile, welderJob).trim();
  const phone = getPdfFooterPhone(profile, welderJob).trim();
  if (name && phone) return `Service Provider - ${name} | ${phone}`;
  if (name) return `Service Provider - ${name}`;
  if (phone) return `Service Provider | ${phone}`;
  return 'Service Provider';
}

/** DocuSeal `html_header` — repeats on each page (PDF-style WO strip). */
export function buildDocusealHtmlHeader(workOrderLabel: string): string {
  const left = esc(workOrderLabel.trim() || '\u00a0');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#aaaaaa;">
<div style="width:100%;padding:0 40px;box-sizing:border-box;">
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cccccc;padding:0 0 4px;width:100%;">
    <span style="flex:1;text-align:left;white-space:nowrap;"><span style="font-size:calc(9px + 1pt);font-weight:700;">${left}</span></span>
    <span style="flex:1;text-align:center;white-space:nowrap;text-transform:uppercase;">Confidential</span>
    <span style="flex:1;text-align:right;white-space:nowrap;">&nbsp;</span>
  </div>
  <div style="height:10px;"></div>
</div>
</body>
</html>`;
}

/** DocuSeal `html_footer` — provider line + page number placeholders. */
export function buildDocusealHtmlFooter(providerLine: string): string {
  const line = esc(providerLine.trim() || 'Service Provider');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#aaaaaa;">
<div style="width:100%;padding:0 40px;box-sizing:border-box;">
  <div style="height:10px;"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #cccccc;padding:4px 0 0;width:100%;">
    <span style="white-space:nowrap;">${line}</span>
    <span style="white-space:nowrap;">Page <span class="pageNumber"></span></span>
  </div>
</div>
</body>
</html>`;
}
