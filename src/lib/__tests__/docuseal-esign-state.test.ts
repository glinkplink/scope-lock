/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  buildEsignRowFromSubmission,
  deriveEsignStatus,
} from '@scope-server/docuseal-esign-state.mjs';

describe('docuseal-esign-state', () => {
  it('maps completed submission to completed', () => {
    expect(
      deriveEsignStatus({ status: 'completed' }, { status: 'pending' })
    ).toBe('completed');
  });

  it('maps opened_at to opened', () => {
    expect(
      deriveEsignStatus({ status: 'pending' }, { opened_at: '2025-01-01', status: 'sent' })
    ).toBe('opened');
  });

  it('defaults to sent when not opened or completed', () => {
    expect(deriveEsignStatus({ status: 'pending' }, { status: 'sent' })).toBe('sent');
  });

  it('buildEsignRowFromSubmission prefers Customer role submitter', () => {
    const row = buildEsignRowFromSubmission({
      id: 99,
      status: 'pending',
      submitters: [
        { id: 1, role: 'Admin', status: 'sent' },
        { id: 2, role: 'Customer', status: 'sent', embed_src: 'https://sign.example/x' },
      ],
    });
    expect(row?.esign_submitter_id).toBe('2');
    expect(row?.esign_embed_src).toBe('https://sign.example/x');
    expect(row?.esign_status).toBe('sent');
  });

  it('returns null when there are no submitters', () => {
    expect(buildEsignRowFromSubmission({ id: 1, status: 'pending', submitters: [] })).toBeNull();
  });
});
