import type { WelderJob } from '../types';

const PENDING_CAPTURE_KEY = 'ironwork-pending-email-confirmation-capture';
const PENDING_CAPTURE_TTL_MS = 2 * 60 * 60 * 1000;

export type PendingCaptureIntent = 'pdf' | 'esign';

export type PendingCapture = {
  version: 1;
  userId: string;
  createdAt: number;
  intent: PendingCaptureIntent;
  businessName: string;
  email: string;
  phone: string | null;
  ownerName: string | null;
  saveAsDefaults: boolean;
  job: WelderJob;
};

type PendingCaptureInput = Omit<PendingCapture, 'version' | 'createdAt'>;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPendingCapture(value: unknown): value is PendingCapture {
  if (!isRecord(value)) return false;
  const job = value.job;
  return (
    value.version === 1 &&
    typeof value.userId === 'string' &&
    typeof value.createdAt === 'number' &&
    (value.intent === 'pdf' || value.intent === 'esign') &&
    typeof value.businessName === 'string' &&
    typeof value.email === 'string' &&
    (typeof value.phone === 'string' || value.phone === null) &&
    (typeof value.ownerName === 'string' || value.ownerName === null) &&
    typeof value.saveAsDefaults === 'boolean' &&
    isRecord(job)
  );
}

export function savePendingCapture(input: PendingCaptureInput): void {
  const storage = getStorage();
  if (!storage) return;
  const pending: PendingCapture = {
    ...input,
    version: 1,
    createdAt: Date.now(),
  };
  storage.setItem(PENDING_CAPTURE_KEY, JSON.stringify(pending));
}

export function readPendingCapture(now = Date.now()): PendingCapture | null {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(PENDING_CAPTURE_KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(PENDING_CAPTURE_KEY);
    return null;
  }

  if (!isPendingCapture(parsed)) {
    storage.removeItem(PENDING_CAPTURE_KEY);
    return null;
  }

  if (now - parsed.createdAt > PENDING_CAPTURE_TTL_MS) {
    storage.removeItem(PENDING_CAPTURE_KEY);
    return null;
  }

  return parsed;
}

export function clearPendingCapture(userId?: string): void {
  const storage = getStorage();
  if (!storage) return;

  if (!userId) {
    storage.removeItem(PENDING_CAPTURE_KEY);
    return;
  }

  const pending = readPendingCapture();
  if (!pending || pending.userId === userId) {
    storage.removeItem(PENDING_CAPTURE_KEY);
  }
}
