// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import sampleJob from '../../data/sample-job.json';
import type { WelderJob } from '../../types';
import { clearPendingCapture, readPendingCapture, savePendingCapture } from '../pending-capture';

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('pending capture storage', () => {
  it('stores and clears a pending email-confirmation capture', () => {
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));

    savePendingCapture({
      userId: 'user-1',
      intent: 'pdf',
      businessName: 'Acme Welding',
      email: 'tester@example.com',
      phone: '555-0100',
      ownerName: 'Billy Smith',
      saveAsDefaults: true,
      job: sampleJob as WelderJob,
    });

    expect(readPendingCapture()).toMatchObject({
      version: 1,
      userId: 'user-1',
      intent: 'pdf',
      businessName: 'Acme Welding',
      email: 'tester@example.com',
      phone: '555-0100',
      ownerName: 'Billy Smith',
      saveAsDefaults: true,
    });

    clearPendingCapture('user-1');

    expect(readPendingCapture()).toBeNull();
  });

  it('drops expired pending captures', () => {
    savePendingCapture({
      userId: 'user-1',
      intent: 'esign',
      businessName: 'Acme Welding',
      email: 'tester@example.com',
      phone: null,
      ownerName: null,
      saveAsDefaults: false,
      job: sampleJob as WelderJob,
    });

    const threeHoursFromNow = Date.now() + 3 * 60 * 60 * 1000;

    expect(readPendingCapture(threeHoursFromNow)).toBeNull();
  });
});
