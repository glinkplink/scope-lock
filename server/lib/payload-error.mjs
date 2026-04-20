/** Thrown when request body exceeds configured maxBytes (maps to HTTP 413). */
export class PayloadTooLargeError extends Error {
  constructor(message = 'Payload too large') {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.code = 'PAYLOAD_TOO_LARGE';
  }
}

export function isPayloadTooLarge(err) {
  return (
    err != null &&
    typeof err === 'object' &&
    (err.code === 'PAYLOAD_TOO_LARGE' || err instanceof PayloadTooLargeError)
  );
}
