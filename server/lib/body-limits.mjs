/** Default max JSON body for API routes (e-sign, invoice send, etc.). */
export const MAX_JSON_BODY_DEFAULT = 2 * 1024 * 1024;

/** Max JSON body for POST /api/pdf (HTML payload). */
export const MAX_JSON_BODY_PDF = 5 * 1024 * 1024;

/** Stripe webhook raw body (signature verification). */
export const MAX_WEBHOOK_RAW_BODY = 256 * 1024;

export const WEBHOOK_BODY_WARN_BYTES = 128 * 1024;
