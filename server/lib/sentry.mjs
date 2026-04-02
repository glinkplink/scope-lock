import * as Sentry from '@sentry/node';

let _dsn = null;

export function initSentry() {
  _dsn = process.env.SENTRY_DSN ?? null;
  if (_dsn) {
    Sentry.init({
      dsn: _dsn,
      environment: process.env.NODE_ENV ?? 'development',
    });
  }
}

export function captureException(err, ctx = {}) {
  if (_dsn) {
    Sentry.withScope((scope) => {
      scope.setExtras(ctx);
      Sentry.captureException(err);
    });
  }
}

export { Sentry };
