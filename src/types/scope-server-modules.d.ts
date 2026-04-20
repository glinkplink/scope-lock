declare module '@scope-server/lib/service-supabase.mjs' {
  export function resetServiceSupabaseSingleton(): void;
  export function getServiceSupabase(options?: {
    errorCode?: string;
    errorMessage?: string;
  }): unknown;
}

declare module '@scope-server/lib/pdf-security.mjs' {
  export function sanitizePdfContentDispositionFilename(filename: string): string;
  export function isAllowedPdfResourceUrl(url: string): boolean;
}

declare module '@scope-server/lib/body.mjs' {
  import type { IncomingMessage } from 'node:http';
  export function readRawBody(
    req: IncomingMessage,
    options?: { maxBytes?: number }
  ): Promise<string>;
  export function readJsonBody(
    req: IncomingMessage,
    options?: { maxBytes?: number }
  ): Promise<unknown>;
}

declare module '@scope-server/lib/payload-error.mjs' {
  export class PayloadTooLargeError extends Error {
    code: 'PAYLOAD_TOO_LARGE';
  }
  export function isPayloadTooLarge(err: unknown): boolean;
}

declare module '@scope-server/lib/post-pdf-api.mjs' {
  import type { IncomingMessage, ServerResponse } from 'node:http';
  export function runPostPdfApi(
    req: IncomingMessage,
    res: ServerResponse,
    handlePdfRequest: (res: ServerResponse, body: unknown) => Promise<unknown>
  ): Promise<void>;
}

declare module '@scope-server/lib/rate-limit.mjs' {
  import type { IncomingMessage } from 'node:http';
  export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean;
  export function resetRateLimitWindows(): void;
  export function getRateLimitEntryCountForTests(): number;
  export function getClientIp(req: IncomingMessage): string;
}

declare module '@scope-server/stripe-routes.mjs' {
  export function resetStripeServiceSupabaseSingleton(): void;
  export function tryHandleStripeRoute(
    req: unknown,
    res: unknown,
    helpers: {
      readJsonBody: (req: unknown) => Promise<unknown>;
      readRawBody: (req: unknown) => Promise<string>;
      sendJson: (res: unknown, code: number, payload: unknown) => void;
      sendText: (res: unknown, code: number, message: string) => void;
    }
  ): Promise<boolean>;
}
