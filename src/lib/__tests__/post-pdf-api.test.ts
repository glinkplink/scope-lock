/**
 * @vitest-environment node
 */
/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

const verifyBearerUserMock = vi.fn();
const readJsonBodyMock = vi.fn();

vi.mock('@scope-server/lib/auth.mjs', () => ({
  verifyBearerUser: (...args: unknown[]) => verifyBearerUserMock(...args),
}));

vi.mock('@scope-server/lib/body.mjs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@scope-server/lib/body.mjs')>();
  return {
    ...mod,
    readJsonBody: (...args: unknown[]) => readJsonBodyMock(...args),
  };
});

import { runPostPdfApi } from '@scope-server/lib/post-pdf-api.mjs';
import { PayloadTooLargeError } from '@scope-server/lib/payload-error.mjs';
import { resetRateLimitWindows } from '@scope-server/lib/rate-limit.mjs';

function mockReq() {
  const stream = new PassThrough();
  const req = stream as unknown as IncomingMessage;
  req.headers = { 'x-forwarded-for': '203.0.113.9' };
  req.method = 'POST';
  req.url = '/api/pdf';
  return { req, stream };
}

function captureRes(): ServerResponse & { statusCode: number; body: string } {
  let code = 0;
  let body = '';
  const res = {
    writeHead(c: number) {
      code = c;
    },
    end(s: string) {
      body = s;
    },
    get statusCode() {
      return code;
    },
    get body() {
      return body;
    },
  } as unknown as ServerResponse & { statusCode: number; body: string };
  return res;
}

describe('runPostPdfApi', () => {
  beforeEach(() => {
    resetRateLimitWindows();
    verifyBearerUserMock.mockReset();
    readJsonBodyMock.mockReset();
  });

  it('returns 401 before readJsonBody when unauthenticated', async () => {
    verifyBearerUserMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing or invalid Authorization bearer token.',
    });
    const { req } = mockReq();
    const res = captureRes();
    const handlePdf = vi.fn();
    await runPostPdfApi(req, res, handlePdf);
    expect(readJsonBodyMock).not.toHaveBeenCalled();
    expect(handlePdf).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('maps PayloadTooLargeError to 413 after auth succeeds', async () => {
    verifyBearerUserMock.mockResolvedValue({ ok: true, userId: 'u1' });
    readJsonBodyMock.mockRejectedValue(new PayloadTooLargeError());
    const { req } = mockReq();
    const res = captureRes();
    await runPostPdfApi(req, res, vi.fn());
    expect(res.statusCode).toBe(413);
  });

  it('returns 429 when PDF rate limit is exhausted (before auth and body read)', async () => {
    verifyBearerUserMock.mockResolvedValue({ ok: true, userId: 'u1' });
    readJsonBodyMock.mockResolvedValue({ html: '<p>x</p>' });
    const handlePdf = vi.fn().mockResolvedValue(true);
    for (let i = 0; i < 10; i++) {
      const { req } = mockReq();
      const res = captureRes();
      await runPostPdfApi(req, res, handlePdf);
      expect(res.statusCode).toBe(0);
    }
    const { req } = mockReq();
    const res = captureRes();
    await runPostPdfApi(req, res, handlePdf);
    expect(res.statusCode).toBe(429);
    expect(verifyBearerUserMock).toHaveBeenCalledTimes(10);
    expect(readJsonBodyMock).toHaveBeenCalledTimes(10);
  });
});
