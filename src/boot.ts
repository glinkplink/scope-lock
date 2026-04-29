import './main';

const CACHE_RECOVERY_KEY = 'ironwork-cache-recovery-2026-04-24';
const APP_SHELL_CACHE_PREFIX = 'ironwork-app-shell-';

async function clearLegacyAppShellCaches() {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !('caches' in window)) return;

  try {
    if (window.localStorage.getItem(CACHE_RECOVERY_KEY) === 'done') return;
  } catch {
    // Ignore storage access failures; cache deletion can still proceed.
  }

  try {
    const cacheKeys = await window.caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key.startsWith(APP_SHELL_CACHE_PREFIX))
        .map((key) => window.caches.delete(key))
    );
  } catch (error) {
    console.error('Legacy cache cleanup failed:', error);
    return;
  }

  try {
    window.localStorage.setItem(CACHE_RECOVERY_KEY, 'done');
  } catch {
    // Best-effort marker only.
  }
}

void clearLegacyAppShellCaches();
