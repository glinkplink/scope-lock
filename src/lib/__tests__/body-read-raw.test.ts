/**
 * @vitest-environment node
 */
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readRawBody } from '@scope-server/lib/body.mjs';
import { PayloadTooLargeError } from '@scope-server/lib/payload-error.mjs';

describe('readRawBody', () => {
  it('throws PayloadTooLargeError and drains the stream when maxBytes is exceeded', async () => {
    const stream = new PassThrough();
    const req = stream as unknown as IncomingMessage;
    let drained = 0;
    stream.on('data', (c: Buffer) => {
      drained += c.length;
    });
    const p = readRawBody(req, { maxBytes: 100 });
    stream.write(Buffer.alloc(50));
    stream.write(Buffer.alloc(60));
    stream.end();
    await expect(p).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(drained).toBe(110);
  });
});
