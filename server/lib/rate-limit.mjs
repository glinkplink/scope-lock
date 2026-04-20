const windows = new Map(); // key → { count, resetAt }

let checkCallCount = 0;
const EVICT_EVERY_N = 100;
const EVICT_SIZE_THRESHOLD = 1000;

function evictExpiredWindows() {
  const now = Date.now();
  for (const [key, entry] of windows.entries()) {
    if (now >= entry.resetAt) {
      windows.delete(key);
    }
  }
}

export function checkRateLimit(key, maxRequests, windowMs) {
  checkCallCount++;
  if (checkCallCount % EVICT_EVERY_N === 0 || windows.size > EVICT_SIZE_THRESHOLD) {
    evictExpiredWindows();
  }

  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || now >= entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  if (entry.count >= maxRequests) return false; // blocked
  entry.count++;
  return true; // allowed
}

/** Test helper: clear rate-limit state between Vitest runs. */
export function resetRateLimitWindows() {
  windows.clear();
  checkCallCount = 0;
}

/** Test helper: current number of rate-limit windows (after eviction runs). */
export function getRateLimitEntryCountForTests() {
  return windows.size;
}

export function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}