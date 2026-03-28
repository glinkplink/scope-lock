import type { EsignJobStatus } from '../types/db';

export const ESIGN_POLL_INTERVAL_MS = 8000;

export function isEsignTerminalStatus(status: EsignJobStatus): boolean {
  return status === 'completed' || status === 'declined' || status === 'expired';
}

export function isEsignInFlightStatus(status: EsignJobStatus): boolean {
  return status === 'sent' || status === 'opened';
}

export function shouldPollEsignStatus(status: EsignJobStatus): boolean {
  return isEsignInFlightStatus(status) && !isEsignTerminalStatus(status);
}

export function formatEsignTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
