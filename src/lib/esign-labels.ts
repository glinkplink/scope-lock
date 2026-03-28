import type { EsignJobStatus } from '../types/db';

export function formatEsignStatusLabel(status: EsignJobStatus): string {
  switch (status) {
    case 'not_sent':
      return 'Not sent';
    case 'sent':
      return 'Sent';
    case 'opened':
      return 'Opened';
    case 'completed':
      return 'Signed';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    default:
      return status;
  }
}

/** Short label for work order list badge. */
export function formatEsignListBadge(status: EsignJobStatus): string {
  switch (status) {
    case 'sent':
      return 'Sign sent';
    case 'opened':
      return 'Sign opened';
    case 'completed':
      return 'Signed';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    default:
      return '';
  }
}
