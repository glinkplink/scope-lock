/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  isAllowedPdfResourceUrl,
  sanitizePdfContentDispositionFilename,
} from '@scope-server/lib/pdf-security.mjs';

describe('sanitizePdfContentDispositionFilename', () => {
  it('strips CRLF, quotes, and path tricks', () => {
    expect(sanitizePdfContentDispositionFilename('ok.pdf')).toBe('ok.pdf');
    const injected = sanitizePdfContentDispositionFilename('evil\r\nSet-Cookie: a');
    expect(injected).not.toMatch(/[\r\n]/);
    expect(sanitizePdfContentDispositionFilename('x"y.pdf')).not.toContain('"');
    expect(sanitizePdfContentDispositionFilename('../../../etc/passwd')).not.toContain('..');
  });
});

describe('isAllowedPdfResourceUrl', () => {
  it('allows data, about, Google Fonts', () => {
    expect(isAllowedPdfResourceUrl('data:font/woff2;base64,xx')).toBe(true);
    expect(isAllowedPdfResourceUrl('about:blank')).toBe(true);
    expect(isAllowedPdfResourceUrl('https://fonts.googleapis.com/css2?family=Barlow')).toBe(true);
    expect(isAllowedPdfResourceUrl('https://fonts.gstatic.com/s/barlow.woff2')).toBe(true);
  });

  it('blocks arbitrary hosts', () => {
    expect(isAllowedPdfResourceUrl('https://evil.com/x')).toBe(false);
    expect(isAllowedPdfResourceUrl('http://169.254.169.254/')).toBe(false);
  });
});
