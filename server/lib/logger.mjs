/**
 * Lightweight structured JSON logger for server-side logging.
 * Outputs JSON lines to stdout/stderr for searchability on platforms like Render.
 */

function formatMessage(level, msg, ctx) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };
  return JSON.stringify(entry);
}

export const log = {
  info(msg, ctx = {}) {
    console.log(formatMessage('info', msg, ctx));
  },

  warn(msg, ctx = {}) {
    console.log(formatMessage('warn', msg, ctx));
  },

  error(msg, ctx = {}) {
    console.error(formatMessage('error', msg, ctx));
  },

  errCtx(err) {
    return {
      error: err.message,
      stack: err.stack,
    };
  },
};