/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Vitest `vi.fn` mock.calls is typed as `[]`; unwrap first argument safely for strict TS. */
function firstMockCallArg(mockFn: { mock: { calls: unknown[][] } }): unknown {
  const row = mockFn.mock.calls[0];
  return row?.[0];
}

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import type { EsignRouteHelpers } from '@scope-server/esign-routes.mjs';
import {
  tryHandleEsignRoute,
  resetEsignServiceSupabaseSingleton,
} from '@scope-server/esign-routes.mjs';

type ProcEnv = Record<string, string | undefined>;
function nodeEnv(): ProcEnv {
  return (globalThis as unknown as { process: { env: ProcEnv } }).process.env;
}

const JOB_UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_JOB_UUID = '550e8400-e29b-41d4-a716-446655440099';
const USER_UUID = '660e8400-e29b-41d4-a716-446655440001';
const CO_UUID = '770e8400-e29b-41d4-a716-446655440002';

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

/** Loose DocuSeal submission fixture for fetch mocks (extra fields allowed). */
function docusealSubmissionResponse(submissionId: number | string): {
  id: string | number;
  status: string;
  completed_at?: string;
  submitters: Array<{
    id: number;
    role: string;
    status: string;
    external_id?: string;
    embed_src: string;
    opened_at?: string;
    completed_at?: string;
    documents?: unknown[];
  }>;
} {
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

function mockWebhookSupabase(findJob: (column: string, value: string) => unknown) {
  const updateEqMock = vi.fn(async () => ({ error: null }));
  const updateMock = vi.fn(() => ({
    eq: updateEqMock,
  }));

  createClientMock.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => ({
          maybeSingle: vi.fn(async () => ({
            data: findJob(column, value) ?? null,
            error: null,
          })),
        })),
      })),
      update: updateMock,
    })),
  });

  return { updateEqMock, updateMock };
}

function baseCORow(overrides: Record<string, unknown> = {}) {
  return {
    id: CO_UUID,
    user_id: USER_UUID,
    job_id: JOB_UUID,
    co_number: 3,
    status: 'draft',
    esign_submission_id: null,
    esign_submitter_id: null,
    esign_embed_src: null,
    esign_status: 'not_sent',
    ...overrides,
  };
}

/** Jobs lookups return null so webhook falls through to change_orders resolution. */
function mockWebhookSupabaseChangeOrderOnly(findCo: (column: string, value: string) => unknown) {
  const updateEqMock = vi.fn(async () => ({ error: null }));
  const updateMock = vi.fn(() => ({
    eq: updateEqMock,
  }));

  createClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'jobs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          update: updateMock,
        };
      }
      if (table === 'change_orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string, value: string) => ({
              maybeSingle: vi.fn(async () => ({
                data: findCo(column, value) ?? null,
                error: null,
              })),
            })),
          })),
          update: updateMock,
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        update: updateMock,
      };
    }),
  });

  return { updateEqMock, updateMock };
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
    createClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    });
    resetEsignServiceSupabaseSingleton();
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

  it('send returns 400 when a second document has non-string html', async () => {
    const res = captureRes();
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
      })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        documents: [{ html: '<p>ok</p>' }, { html: null }],
      }))
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('send returns 400 when more than one document is sent', async () => {
    const res = captureRes();
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
      })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        documents: [{ html: '<p>a</p>' }, { html: '<p>b</p>' }],
      }))
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('send returns 413 when document HTML exceeds the size limit', async () => {
    const res = captureRes();
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
      })),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        documents: [{ html: huge }],
      }))
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('send returns 503 when Supabase service env is missing', async () => {
    const res = captureRes();
    const proc = nodeEnv();
    const prevKey = proc.SUPABASE_SERVICE_ROLE_KEY;
    delete proc.SUPABASE_SERVICE_ROLE_KEY;
    resetEsignServiceSupabaseSingleton();

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({ documents: [{ html: '<p>x</p>' }] }))
    );
    expect(res.status).toBe(503);
    const body = JSON.parse(res.body) as { error?: string };
    expect(body.error).toBe('E-sign is temporarily unavailable.');
    proc.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    resetEsignServiceSupabaseSingleton();
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

  it('resend returns 500 when both submission refresh and fallback DB patch fail', async () => {
    const res = captureRes();
    const jobWithSubmitter = baseJobRow({
      esign_submitter_id: '77',
      esign_submission_id: '900',
      esign_status: 'opened',
      esign_opened_at: '2026-03-27T10:00:00Z',
    });

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
                  single: vi.fn(async () => ({
                    data: null,
                    error: { message: 'DB write failed' },
                  })),
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
      return new Response('Service unavailable', { status: 503 });
    });

    const req = {
      method: 'POST',
      url: `/api/esign/work-orders/${JOB_UUID}/resend`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());
    expect(res.status).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/resend succeeded/i);
    expect(body.jobId).toBe(JOB_UUID);
    expect(body.esign_status).toBeUndefined();
    expect(body.esign_opened_at).toBeUndefined();
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
    mockWebhookSupabase((column, value) =>
      column === 'id' && value === JOB_UUID
        ? baseJobRow({
            esign_submission_id: '123',
            esign_submitter_id: '77',
          })
        : null
    );
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
        data: { id: 77, external_id: JOB_UUID, submission: { id: 123 } },
      }))
    );
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/verify/i);
  });

  it('webhook updates opened state from form.viewed without payload submission id', async () => {
    const res = captureRes();
    const { updateEqMock } = mockWebhookSupabase((column, value) => {
      if (column === 'id' && value === JOB_UUID) {
        return baseJobRow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(900);
    submission.submitters[0].status = 'opened';
    submission.submitters[0].opened_at = '2026-03-28T12:00:00Z';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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
        event_type: 'form.viewed',
        data: { id: 77, external_id: JOB_UUID },
      }))
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(updateEqMock).toHaveBeenCalledWith('id', JOB_UUID);
    expect(firstMockCallArg(updateEqMock)).toBe('id');
  });

  it('webhook updates opened state from form.started without payload submission id', async () => {
    const res = captureRes();
    const { updateMock } = mockWebhookSupabase((column, value) => {
      if (column === 'id' && value === JOB_UUID) {
        return baseJobRow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(900);
    submission.submitters[0].status = 'opened';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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
        event_type: 'form.started',
        data: { id: 77, external_id: JOB_UUID },
      }))
    );

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    const patch = firstMockCallArg(updateMock) as { esign_status?: string };
    expect(patch.esign_status).toBe('opened');
  });

  it('webhook updates completed state from form.completed payload submission id', async () => {
    const res = captureRes();
    const { updateMock, updateEqMock } = mockWebhookSupabase((column, value) => {
      if (column === 'id' && value === JOB_UUID) {
        return baseJobRow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      if (column === 'esign_submission_id' && value === '900') {
        return baseJobRow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(900);
    submission.status = 'completed';
    submission.completed_at = '2026-03-28T13:00:00Z';
    submission.submitters[0].status = 'completed';
    submission.submitters[0].completed_at = '2026-03-28T13:00:00Z';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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
        data: { id: 77, external_id: JOB_UUID, submission: { id: 900, status: 'completed' } },
      }))
    );

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    const patch = firstMockCallArg(updateMock) as { esign_status?: string };
    expect(patch.esign_status).toBe('completed');
    expect(updateEqMock).toHaveBeenCalledWith('id', JOB_UUID);
  });

  it('webhook resolves form.completed by submitter id when external_id is missing', async () => {
    const res = captureRes();
    const { updateMock, updateEqMock } = mockWebhookSupabase((column, value) => {
      if (column === 'esign_submitter_id' && value === '77') {
        return baseJobRow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      if (column === 'esign_submission_id' && value === '900') {
        return baseJobRow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(900);
    submission.status = 'completed';
    submission.submitters[0].external_id = undefined;
    submission.submitters[0].status = 'completed';
    submission.submitters[0].completed_at = '2026-03-28T13:10:00Z';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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
        data: { id: 77, submission: { id: 900, status: 'completed' } },
      }))
    );

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    const patch = firstMockCallArg(updateMock) as { esign_status?: string };
    expect(patch.esign_status).toBe('completed');
    expect(updateEqMock).toHaveBeenCalledWith('id', JOB_UUID);
  });

  it('webhook ignores stale submission when external-id fallback resolves to a different stored submission', async () => {
    const res = captureRes();
    const { updateMock } = mockWebhookSupabase((column, value) => {
      if (column === 'esign_submission_id' && value === '222') return null;
      if (column === 'id' && value === JOB_UUID) {
        return baseJobRow({
          esign_submission_id: '111',
          esign_submitter_id: '1',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(222);
    submission.submitters[0].external_id = undefined;
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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

  it('webhook prefers verified submission id over conflicting payload external_id', async () => {
    const res = captureRes();
    const { updateMock } = mockWebhookSupabase((column, value) => {
      if (column === 'id' && value === OTHER_JOB_UUID) {
        return baseJobRow({
          id: OTHER_JOB_UUID,
          esign_submission_id: '111',
          esign_submitter_id: '88',
        });
      }
      if (column === 'esign_submission_id' && value === '333') {
        return baseJobRow({
          esign_submission_id: '333',
          esign_submitter_id: '77',
        });
      }
      if (column === 'id' && value === JOB_UUID) {
        return baseJobRow({
          esign_submission_id: '333',
          esign_submitter_id: '77',
        });
      }
      return null;
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
        data: { submission: { id: 333 }, external_id: OTHER_JOB_UUID },
      }))
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith(expect.any(Object));
    const updateTarget = updateMock.mock.results[0]?.value;
    expect(updateTarget.eq).toHaveBeenCalledWith('id', JOB_UUID);
  });

  it('webhook falls back to verified submitter external_id when submission lookup misses', async () => {
    const res = captureRes();
    const { updateEqMock } = mockWebhookSupabase((column, value) => {
      if (column === 'esign_submission_id' && value === '444') return null;
      if (column === 'id' && value === JOB_UUID) {
        return baseJobRow({
          esign_submission_id: null,
          esign_submitter_id: '77',
        });
      }
      return null;
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(docusealSubmissionResponse(444)), {
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
        event_type: 'submission.opened',
        data: { id: 444 },
      }))
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(updateEqMock).toHaveBeenCalledWith('id', JOB_UUID);
  });

  it('webhook updates change order opened state from form.viewed via external_id', async () => {
    const res = captureRes();
    const { updateEqMock } = mockWebhookSupabaseChangeOrderOnly((column, value) => {
      if (column === 'id' && value === CO_UUID) {
        return baseCORow({
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(900);
    submission.submitters[0].status = 'opened';
    submission.submitters[0].opened_at = '2026-03-28T12:00:00Z';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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
        event_type: 'form.viewed',
        data: { id: 77, external_id: CO_UUID },
      }))
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(updateEqMock).toHaveBeenCalledWith('id', CO_UUID);
  });

  it('change-order send stores pending approval status and submitter external_id = co id', async () => {
    const res = captureRes();
    const updatedRow = {
      ...baseCORow({
        status: 'pending_approval',
        esign_submission_id: '900',
        esign_submitter_id: '77',
        esign_status: 'sent',
      }),
    };
    const updateMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: updatedRow, error: null })),
          })),
        })),
      })),
    }));

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === 'change_orders') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: baseCORow({ status: 'draft' }),
                    error: null,
                  })),
                })),
              })),
            })),
            update: updateMock,
          };
        }
        if (table === 'jobs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { customer_email: 'client@example.com' },
                  error: null,
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u.includes('/submissions/html') && init?.method === 'POST') {
        return new Response(JSON.stringify(docusealSubmissionResponse(900)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('fail', { status: 500 });
    });

    const req = {
      method: 'POST',
      url: `/api/esign/change-orders/${CO_UUID}/send`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(
      req as never,
      res as never,
      defaultHelpers(async () => ({
        documents: [{ html: '<p>x</p>' }],
        message: { subject: 'Please sign', body: 'Message' },
      }))
    );

    expect(res.status).toBe(200);
    expect(firstMockCallArg(updateMock)).toMatchObject({
      status: 'pending_approval',
      esign_status: 'sent',
    });
    const submissionCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/submissions/html'));
    expect(submissionCall).toBeTruthy();
    const submissionBody = JSON.parse(String(submissionCall?.[1]?.body)) as {
      submitters: Array<{ external_id: string }>;
    };
    expect(submissionBody.submitters[0].external_id).toBe(CO_UUID);
  });

  it('change-order resend reconciles approved state when DocuSeal PUT returns 404 but submission still exists', async () => {
    const res = captureRes();
    const coWithSubmitter = baseCORow({
      status: 'pending_approval',
      esign_submitter_id: '77',
      esign_submission_id: '900',
      esign_status: 'sent',
    });
    const refreshed = {
      ...coWithSubmitter,
      status: 'approved',
      esign_status: 'completed',
      esign_completed_at: '2026-03-28T05:05:00Z',
      esign_signed_document_url: 'https://docuseal.example/signed.pdf',
    };
    const updateMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: refreshed, error: null })),
          })),
        })),
      })),
    }));

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_UUID } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === 'change_orders') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: coWithSubmitter, error: null })),
                })),
              })),
            })),
            update: updateMock,
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const u = requestUrl(input);
      if (u.endsWith('/submitters/77') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
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
      url: `/api/esign/change-orders/${CO_UUID}/resend`,
      headers: { authorization: 'Bearer good-token' },
    };
    await tryHandleEsignRoute(req as never, res as never, defaultHelpers());

    expect(res.status).toBe(200);
    expect(firstMockCallArg(updateMock)).toMatchObject({
      status: 'approved',
      esign_status: 'completed',
    });
  });

  it('webhook updates declined change-order submissions to rejected business status', async () => {
    const res = captureRes();
    const { updateEqMock, updateMock } = mockWebhookSupabaseChangeOrderOnly((column, value) => {
      if (column === 'id' && value === CO_UUID) {
        return baseCORow({
          status: 'pending_approval',
          esign_submission_id: '900',
          esign_submitter_id: '77',
          esign_status: 'sent',
        });
      }
      return null;
    });

    const submission = docusealSubmissionResponse(900);
    submission.status = 'declined';
    submission.submitters[0].status = 'declined';
    (submission.submitters[0] as { declined_at?: string; decline_reason?: string }).declined_at =
      '2026-03-28T12:00:00Z';
    (submission.submitters[0] as { declined_at?: string; decline_reason?: string }).decline_reason =
      'Need changes';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(submission), {
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
        event_type: 'form.viewed',
        data: { id: 77, external_id: CO_UUID },
      }))
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(firstMockCallArg(updateMock)).toMatchObject({
      status: 'rejected',
      esign_status: 'declined',
      esign_decline_reason: 'Need changes',
    });
    expect(updateEqMock).toHaveBeenCalledWith('id', CO_UUID);
  });
});
