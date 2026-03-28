declare module '@scope-server/docuseal-esign-state.mjs' {
  export function pickCustomerSubmitter(submission: unknown): unknown;
  export function deriveEsignStatus(submission: unknown, submitter: unknown): string;
  export function pickSignedDocumentUrl(
    submission: unknown,
    submitter: unknown
  ): string | null;
  export function buildEsignRowFromSubmission(
    submission: unknown
  ): Record<string, unknown> | null;
}

declare module '@scope-server/esign-routes.mjs' {
  import type { IncomingMessage, ServerResponse } from 'node:http';
  export interface EsignRouteHelpers {
    readJsonBody: (req: IncomingMessage) => Promise<unknown>;
    sendJson: (res: ServerResponse, statusCode: number, payload: unknown) => void;
    sendText: (res: ServerResponse, statusCode: number, message: string) => void;
  }
  export function tryHandleEsignRoute(
    req: IncomingMessage,
    res: ServerResponse,
    helpers: EsignRouteHelpers
  ): Promise<boolean>;
}
