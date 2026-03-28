/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { tryHandleEsignRoute } from '@scope-server/esign-routes.mjs';

function captureRes() {
  let status = 0;
  let body = '';
  return {
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    writeHead(code: number) {
      status = code;
    },
    end(chunk: string) {
      body = chunk;
    },
  };
}

function helpers() {
  return {
    readJsonBody: async () => ({}),
    sendJson(res: ReturnType<typeof captureRes>, code: number, payload: unknown) {
      res.writeHead(code);
      res.end(JSON.stringify(payload));
    },
    sendText(res: ReturnType<typeof captureRes>, code: number, message: string) {
      res.writeHead(code);
      res.end(message);
    },
  };
}

describe('tryHandleEsignRoute', () => {
  it('returns 401 for send without Authorization', async () => {
    const res = captureRes();
    const req = {
      method: 'POST',
      url: '/api/esign/work-orders/550e8400-e29b-41d4-a716-446655440000/send',
      headers: {},
    };
    const handled = await tryHandleEsignRoute(req as never, res as never, helpers());
    expect(handled).toBe(true);
    expect(res.status).toBe(401);
    const j = JSON.parse(res.body) as { error?: string };
    expect(j.error).toMatch(/bearer/i);
  });

  it('responds to GET webhook probe with ok', async () => {
    const res = captureRes();
    const req = { method: 'GET', url: '/api/webhooks/docuseal', headers: {} };
    const handled = await tryHandleEsignRoute(req as never, res as never, helpers());
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('ignores unrelated paths', async () => {
    const res = captureRes();
    const req = { method: 'POST', url: '/api/pdf', headers: {} };
    const handled = await tryHandleEsignRoute(req as never, res as never, helpers());
    expect(handled).toBe(false);
    expect(res.status).toBe(0);
  });
});
