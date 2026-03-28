/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import type { EsignRouteHelpers } from '@scope-server/esign-routes.mjs';
import { tryHandleEsignRoute } from '@scope-server/esign-routes.mjs';

type ProcEnv = Record<string, string | undefined>;
function nodeEnv(): ProcEnv {
  return (globalThis as unknown as { process: { env: ProcEnv } }).process.env;
}

const JOB_UUID = '550e8400-e29b-41d4-a716-446655440000';
const USER_UUID = '660e8400-e29b-41d4-a716-446655440001';

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

function defaultHelpers(readJsonBody: () => Promise<unknown> = async () => ({})): EsignRouteHelpers {
  return {
    readJsonBody: async () => readJsonBody(),
    sendJson(res: unknown, code: number, payload: unknown) {
      const r = res as ReturnType<typeof captureRes>;
      r.writeHead(code);
      r.end(JSON.stringify(payload));
    },
    sendText(res: unknown, code: number, message: string) {
      const r = res as ReturnType<typeof captureRes>;
      r.writeHead(code);
      r.end(message);
    },
  } as unknown as EsignRouteHelpers;
}

function baseJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_UUID,
    user_id: USER_UUID,
    customer_email: 'client@example.com',
    wo_number: 1,
    esign_submission_id: null,
    esign_submitter_id: null,
    esign_embed_src: null,
    esign_status: 'not_sent',
    ...overrides,
  };
}

function docusealSubmissionResponse(submissionId: number | string) {
  return {
    id: submissionId,
    status: 'pending',
    submitters: [
      {
        id: 77,
        role: 'Customer',
        status: 'sent',
        external_id: JOB_UUID,
        embed_src: 'https://docuseal.example/sign/1',
      },
    ],
  };
}

describe('tryHandleEsignRoute', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 }))
      )
    );
    const procEnv = nodeEnv();
    for (const k of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DOCUSEAL_API_KEY',
      'DOCUSEAL_WEBHOOK_HEADER_NAME',
      'DOCUSEAL_WEBHOOK_HEADER_VALUE',
    ]) {
      prevEnv[k] = procEnv[k];
    }
    const env = nodeEnv();
    env.SUPABASE_URL = 'http://localhost:54321';
    env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    env.DOCUSEAL_API_KEY = 'test-docuseal-key';
    env.DOCUSEAL_WEBHOOK_HEADER_NAME = 'X-Docuseal-Webhook-Secret';
    env.DOCUSEAL_WEBHOOK_HEADER_VALUE = 'correct-secret';
    createClientMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const restoreEnv = nodeEnv();
    for (const k of Object.keys(prevEnv)) {
      const v = prevEnv[k];
      if (v === undefined) delete restoreEnv[k];
      else restoreEnv[k] = v;
    }
  });

  it('returns 401 for send without Authorization', async () => {
    const res = captureRes();
    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: {},
    };
    const handled = await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(handled).toBe(true);
    expect(res.status).toBe(401);
    const j = JSON.parse(res.body) as { error?: string };
    expect(j.error).toMatch(/bearer/i);
  });

  it('responds to GET webhook probe with ok', async () => {
    const res = captureRes();
    const req = { method: 'GET', url: '/api/webhooks/docuseal', headers: {} };
    const handled = await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('ignores unrelated paths', async () => {
    const res = captureRes();
    const req = { method: 'POST', url: '/api/pdf', headers: {} };
    const handled = await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(handled).toBe(false);
    expect(res.status).toBe(0);
  });

  it('send returns 401 when Supabase rejects the JWT', async () => {
    const res = captureRes();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Invalid JWT' },
        })),
      },
      from: vi.fn(),
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer bad-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/session/i);
  });

  it('send returns 404 when the job is not owned by the caller', async () => {
    const res = captureRes();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        })),
      })),
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        documents: [{ html: '<p>x</p>' }],
      }))
    );
    expect(res.status).toBe(404);
  });

  it('send POSTs DocuSeal payload with submitter external_id = job id and updates the job', async () => {
    const res = captureRes();
    const updatedRow = {
      ...baseJobRow(),
      esign_submission_id: '900',
      esign_submitter_id: '77',
      esign_status: 'sent',
    };

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: baseJobRow(), error: null })),
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: updatedRow, error: null })),
              })),
            })),
          })),
        })),
      })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u.includes('/submissions/html') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { submitters?: { external_id?: string }[] };
        expect(body.submitters?.[0]?.external_id).toBe(JOB_UUID);
        return new Response(JSON.stringify(docusealSubmissionResponse(900)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        documents: [{ html: '<p>Agreement</p>' }],
      }))
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { jobId?: string; esign_submission_id?: string };
    expect(body.jobId).toBe(JOB_UUID);
    expect(body.esign_submission_id).toBe('900');
  });

  it('resend returns 400 when esign_submitter_id was never set', async () => {
    const res = captureRes();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: baseJobRow({ esign_submitter_id: null }),
                error: null,
              })),
            })),
          })),
        })),
      })),
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/resend`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/send first/i);
  });

  it('resend PUTs DocuSeal submitters/{id}', async () => {
    const res = captureRes();
    const jobWithSubmitter = baseJobRow({
      esign_submitter_id: '77',
      esign_submission_id: '900',
      esign_status: 'sent',
    });
    const refreshed = { ...jobWithSubmitter, esign_embed_src: 'https://docuseal.example/sign/1' };

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi
        .fn()
        .mockImplementationOnce(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: jobWithSubmitter, error: null })),
              })),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: refreshed, error: null })),
                })),
              })),
            })),
          })),
        })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u.endsWith('/submitters/77') && init?.method === 'PUT') {
        return new Response('{}', { status: 200 });
      }
      if (u.includes('/submissions/900') && init?.method === 'GET') {
        return new Response(JSON.stringify(docusealSubmissionResponse(900)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('fail', { status: 500 });
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/resend`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(200);
    const putCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/submitters/77'));
    expect(putCalls.length).toBe(1);
  });

  it('resend reconciles signed state when DocuSeal says submitter already completed', async () => {
    const res = captureRes();
    const jobWithSubmitter = baseJobRow({
      esign_submitter_id: '77',
      esign_submission_id: '900',
      esign_status: 'sent',
    });
    const refreshed = {
      ...jobWithSubmitter,
      esign_status: 'completed',
      esign_completed_at: '2026-03-28T05:05:00Z',
      esign_signed_document_url: 'https://docuseal.example/signed.pdf',
    };

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi
        .fn()
        .mockImplementationOnce(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: jobWithSubmitter, error: null })),
              })),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: refreshed, error: null })),
                })),
              })),
            })),
          })),
        })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u.endsWith('/submitters/77') && init?.method === 'PUT') {
        return new Response(
          JSON.stringify({ error: 'Submitter has already completed the submission.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('/submissions/900') && init?.method === 'GET') {
        const submission = docusealSubmissionResponse(900);
        submission.status = 'completed';
        submission.completed_at = '2026-03-28T05:05:00Z';
        submission.submitters[0].status = 'completed';
        submission.submitters[0].completed_at = '2026-03-28T05:05:00Z';
        submission.submitters[0].documents = [{ url: 'https://docuseal.example/signed.pdf' }];
        return new Response(JSON.stringify(submission), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('fail', { status: 500 });
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/resend`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.esign_status).toBe('completed');
    expect(body.esign_signed_document_url).toBe('https://docuseal.example/signed.pdf');
  });

  it('resend returns fresh sent state when optional submission refresh fails', async () => {
    const res = captureRes();
    const jobWithSubmitter = baseJobRow({
      esign_submitter_id: '77',
      esign_submission_id: '900',
      esign_status: 'opened',
      esign_opened_at: '2026-03-27T10:00:00Z',
    });
    const fallbackUpdated = {
      ...jobWithSubmitter,
      esign_status: 'sent',
      esign_sent_at: '2026-03-28T12:00:00Z',
      esign_submission_state: 'sent',
      esign_submitter_state: 'sent',
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    };

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi
        .fn()
        .mockImplementationOnce(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: jobWithSubmitter, error: null })),
              })),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: fallbackUpdated, error: null })),
                })),
              })),
            })),
          })),
        })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u.endsWith('/submitters/77') && init?.method === 'PUT') {
        return new Response('{}', { status: 200 });
      }
      // GET /submissions/900 fails
      return new Response('Service unavailable', { status: 503 });
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/resend`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.esign_status).toBe('sent');
    expect(body.esign_opened_at).toBeNull();
    expect(body.esign_completed_at).toBeNull();
    expect(body.esign_declined_at).toBeNull();
    expect(body.esign_signed_document_url).toBeNull();
  });

  it('webhook returns 503 when header verification env is missing', async () => {
    delete nodeEnv().DOCUSEAL_WEBHOOK_HEADER_NAME;
    const res = captureRes();
    const req = {
      method: 'POST',
      url: '/api/webhooks/docuseal',
      headers: { 'x-docuseal-webhook-secret': 'correct-secret' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(503);
  });

  it('webhook returns 401 when the configured header does not match', async () => {
    const res = captureRes();
    const req = {
      method: 'POST',
      url: '/api/webhooks/docuseal',
      headers: { 'x-docuseal-webhook-secret': 'wrong-value' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        event_type: 'submission.completed',
        data: { submission: { id: 1 } },
      }))
    );
    expect(res.status).toBe(401);
    expect(res.body).toBe('Unauthorized');
  });

  it('webhook returns 200 ignored when payload has no submission id', async () => {
    const res = captureRes();
    const req = {
      method: 'POST',
      url: '/api/webhooks/docuseal',
      headers: { 'x-docuseal-webhook-secret': 'correct-secret' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({ event_type: 'other', data: {} }))
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe(true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('webhook returns 502 when DocuSeal verify GET fails', async () => {
    const res = captureRes();
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('nope', { status: 500 }));

    const req = {
      method: 'POST',
      url: '/api/webhooks/docuseal',
      headers: { 'x-docuseal-webhook-secret': 'correct-secret' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        event_type: 'form.completed',
        data: { submission: { id: 123 } },
      }))
    );
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/verify/i);
  });

  it('webhook ignores stale submission when stored esign_submission_id differs from verified id', async () => {
    const res = captureRes();
    const updateMock = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));

    createClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: baseJobRow({
                esign_submission_id: '111',
                esign_submitter_id: '1',
              }),
              error: null,
            })),
          })),
        })),
        update: updateMock,
      })),
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(docusealSubmissionResponse(222)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const req = {
      method: 'POST',
      url: '/api/webhooks/docuseal',
      headers: { 'x-docuseal-webhook-secret': 'correct-secret' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        event_type: 'submission.completed',
        data: { id: 222, external_id: JOB_UUID },
      }))
    );

    expect(res.status).toBe(200);
    const j = JSON.parse(res.body) as { reason?: string };
    expect(j.reason).toBe('stale_submission');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('webhook verify-on-receive updates job when submission matches', async () => {
    const res = captureRes();
    const updateMock = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));

    createClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: baseJobRow({
                esign_submission_id: '333',
                esign_submitter_id: '77',
              }),
              error: null,
            })),
          })),
        })),
        update: updateMock,
      })),
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(docusealSubmissionResponse(333)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const req = {
      method: 'POST',
      url: '/api/webhooks/docuseal',
      headers: { 'x-docuseal-webhook-secret': 'correct-secret' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        event_type: 'form.completed',
        data: { submission: { id: 333 }, external_id: JOB_UUID },
      }))
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalled();
  });
});
