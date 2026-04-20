/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  resetRateLimitWindows,
  getRateLimitEntryCountForTests,
} from '@scope-server/lib/rate-limit.mjs';

describe('checkRateLimit eviction', () => {
  beforeEach(() => {
    resetRateLimitWindows();
  });

  it('prunes expired windows when the check counter hits the eviction interval', async () => {
    const shortMs = 1;
    for (let i = 0; i < 50; i++) {
      checkRateLimit(`expired-${i}`, 5, shortMs);
    }
    await new Promise((r) => setTimeout(r, 15));
    for (let i = 0; i < 49; i++) {
      checkRateLimit(`keep-${i}`, 10, 60_000);
    }
    expect(getRateLimitEntryCountForTests()).toBe(99);
    checkRateLimit('trigger-eviction', 10, 60_000);
    expect(getRateLimitEntryCountForTests()).toBe(50);
  });
});
