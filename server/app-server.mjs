import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer-core';
import { tryHandleEsignRoute } from './esign-routes.mjs';
import { tryHandleStripeRoute } from './stripe-routes.mjs';
import { tryHandleInvoiceRoute } from './invoice-routes.mjs';
import { checkRateLimit, getClientIp } from './lib/rate-limit.mjs';
import { log } from './lib/logger.mjs';
import { initSentry, captureException, Sentry } from './lib/sentry.mjs';
import { readRawBody as readRawBodyLib, readJsonBody as readJsonBodyLib } from './lib/body.mjs';
import {
  MAX_JSON_BODY_DEFAULT,
  MAX_WEBHOOK_RAW_BODY,
  WEBHOOK_BODY_WARN_BYTES,
} from './lib/body-limits.mjs';
import { sanitizePdfContentDispositionFilename } from './lib/pdf-security.mjs';
import { runPostPdfApi } from './lib/post-pdf-api.mjs';
import { preparePdfPageForRendering } from './lib/pdf-puppeteer.mjs';
import { isPayloadTooLarge } from './lib/payload-error.mjs';
import { logEnvPreflight } from './lib/env-preflight.mjs';
import {
  buildFooterTemplate,
  buildHeaderTemplate,
  resolvePdfHeaderSlots,
} from './lib/pdf-templates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true });
const distDir = path.join(rootDir, 'dist');
const isDev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const localHost =
  host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host;
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  '/usr/bin/google-chrome-stable';

const COMMON_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

let browserPromise;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }

  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

function sendText(res, statusCode, message, headers = {}) {
  res.writeHead(statusCode, {
    ...COMMON_HEADERS,
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(message);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBodyDefault(req) {
  return readJsonBodyLib(req, { maxBytes: MAX_JSON_BODY_DEFAULT });
}

async function readRawBodyStripeWebhook(req) {
  const raw = await readRawBodyLib(req, { maxBytes: MAX_WEBHOOK_RAW_BODY });
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > WEBHOOK_BODY_WARN_BYTES) {
    log.warn('stripe webhook body exceeds warn threshold', {
      bytes,
      threshold: WEBHOOK_BODY_WARN_BYTES,
    });
  }
  return raw;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function shouldServeSpaFallback(normalizedPath) {
  if (normalizedPath === '/' || normalizedPath === '/index.html') return true;
  if (normalizedPath === '/assets' || normalizedPath.startsWith('/assets/')) return false;
  return path.posix.extname(normalizedPath) === '';
}

function getCacheControlHeader(normalizedPath, mimeType) {
  if (mimeType.startsWith('text/html') || normalizedPath === '/sw.js') {
    return 'no-cache, no-store, must-revalidate';
  }

  if (normalizedPath.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }

  return 'public, max-age=3600';
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Record<string, unknown>} body
 */
async function handlePdfRequest(res, body) {
  let page;

  try {
    const { html, filename, providerName, providerPhone } = body;
    const { headerLeft, headerRight } = resolvePdfHeaderSlots(body);

    if (typeof html !== 'string' || !html.trim()) {
      sendText(res, 400, 'Missing HTML payload.');
      return true;
    }

    const browser = await getBrowser();
    page = await browser.newPage();
    await preparePdfPageForRendering(page);
    /* Letter width at 96dpi — layout matches desktop PDF regardless of client screen */
    await page.setViewport({ width: 816, height: 1056 });
    await page.setDefaultNavigationTimeout(20_000);
    await page.setDefaultTimeout(20_000);
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    await page.emulateMediaType('screen');
    await page.evaluate(async () => {
      if (!('fonts' in document) || !document.fonts) return;
      await document.fonts.ready;
      try {
        await document.fonts.load("400 20pt 'Dancing Script'");
      } catch {
        /* ignore load failures; fallback glyph still renders */
      }
      await document.fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 200));

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: buildHeaderTemplate(headerLeft, headerRight),
      footerTemplate: buildFooterTemplate(providerName, providerPhone),
      margin: {
        top: '70px',
        right: '60px',
        bottom: '70px',
        left: '60px',
      },
      timeout: 30_000,
    });

    const safeName = sanitizePdfContentDispositionFilename(
      typeof filename === 'string' ? filename : 'work-order.pdf'
    );

    // Puppeteer v24 returns a Uint8Array from page.pdf(). Coerce to Buffer so Node
    // serializes it deterministically and omit Content-Length so Node picks the
    // right framing (avoids header/body length mismatches on some stream paths).
    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}"`,
    });
    res.end(pdfBuffer);
    return true;
  } catch (error) {
    log.error('PDF generation failed', log.errCtx(error));
    if (!res.headersSent) {
      sendText(res, 500, 'Could not generate PDF.');
    }
    return true;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        log.error('pdf page.close threw', log.errCtx(e));
      }
    }
  }
}

async function createAppServer() {
  initSentry();
  logEnvPreflight();
  let vite;

  if (isDev) {
    const { createServer } = await import('vite');
    vite = await createServer({
      root: rootDir,
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
    if (!req.url || !req.method) {
      sendText(res, 400, 'Invalid request.');
      return;
    }

    if (req.method === 'GET' && req.url === '/api/pdf/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    const pathOnly = String(req.url || '').split('?')[0] || '/';

    // Rate limit: 5 req/min per IP for esign send/resend (before handler)
    if (
      req.method === 'POST' &&
      /^\/api\/esign\/(work-orders|change-orders)\/[\w-]+\/(send|resend)$/.test(pathOnly)
    ) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`esign:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    const handledEsign = await tryHandleEsignRoute(req, res, {
      readJsonBody: readJsonBodyDefault,
      sendJson,
      sendText,
    });
    if (handledEsign) {
      return;
    }

    // Rate limit: 5 req/min per IP for Stripe Connect start
    if (req.method === 'POST' && pathOnly === '/api/stripe/connect/start') {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`stripe-connect:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    // Rate limit: 5 req/min per IP for invoice send
    if (req.method === 'POST' && /^\/api\/invoices\/[\w-]+\/send$/.test(pathOnly)) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`invoice:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    // Rate limit: payment-link creation only (not webhook)
    if (req.method === 'POST' && /^\/api\/stripe\/invoices\/[0-9a-fA-F-]{36}\/payment-link$/.test(pathOnly)) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`stripe-payment-link:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    const handledInvoice = await tryHandleInvoiceRoute(req, res, {
      readJsonBody: readJsonBodyDefault,
      sendJson,
      sendText,
    });
    if (handledInvoice) return;

    const handledStripe = await tryHandleStripeRoute(req, res, {
      readJsonBody: readJsonBodyDefault,
      readRawBody: readRawBodyStripeWebhook,
      sendJson,
      sendText,
    });
    if (handledStripe) {
      return;
    }

    if (req.method === 'POST' && pathOnly === '/api/pdf') {
      await runPostPdfApi(req, res, handlePdfRequest);
      return;
    }

    if (isDev && vite) {
      vite.middlewares(req, res, (err) => {
        if (err) {
          vite.ssrFixStacktrace(err);
          log.error('Vite SSR error', log.errCtx(err));
          sendText(res, 500, 'Internal server error.');
        }
      });
      return;
    }

    const resolvedDistDir = path.resolve(distDir);
    let servePath;
    let normalizedPath = '/';
    try {
      const u = new URL(req.url === '/' ? '/' : req.url || '/', 'http://local');
      let decoded = u.pathname;
      try {
        decoded = decodeURIComponent(u.pathname);
      } catch {
        sendText(res, 400, 'Bad request.');
        return;
      }
      if (/[\u0000-\u001F\u007F]/.test(decoded)) {
        sendText(res, 400, 'Bad request.');
        return;
      }
      const normalized = path.posix.normalize(decoded === '' ? '/' : decoded);
      normalizedPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
      const relative = normalized.replace(/^\/+/, '') || 'index.html';
      const resolvedFile = path.resolve(distDir, relative);
      if (resolvedFile !== resolvedDistDir && !resolvedFile.startsWith(resolvedDistDir + path.sep)) {
        sendText(res, 403, 'Forbidden');
        return;
      }
      servePath = resolvedFile;
    } catch {
      sendText(res, 400, 'Bad request.');
      return;
    }

    const canUseSpaFallback = shouldServeSpaFallback(normalizedPath);
    const sendMissingStatic = () => {
      log.warn('Static file not found', { path: normalizedPath });
      sendText(res, 404, 'Not found.', { 'Cache-Control': 'no-store' });
    };

    if (!existsSync(servePath) || servePath.endsWith(path.sep)) {
      if (!canUseSpaFallback) {
        sendMissingStatic();
        return;
      }
      servePath = path.join(distDir, 'index.html');
    } else {
      try {
        const st = statSync(servePath);
        if (st.isDirectory()) {
          // e.g. GET /assets → dist/assets is a folder; streaming it causes EISDIR and can crash the process
          if (!canUseSpaFallback) {
            sendMissingStatic();
            return;
          }
          servePath = path.join(distDir, 'index.html');
        }
      } catch {
        if (!canUseSpaFallback) {
          sendMissingStatic();
          return;
        }
        servePath = path.join(distDir, 'index.html');
      }
    }

    try {
      const mimeType = getMimeType(servePath);
      const isHtml = mimeType.startsWith('text/html');
      res.writeHead(200, {
        ...COMMON_HEADERS,
        ...(isHtml ? { 'X-Frame-Options': 'DENY' } : {}),
        'Cache-Control': getCacheControlHeader(normalizedPath, mimeType),
        'Content-Type': mimeType,
      });
      const stream = createReadStream(servePath);
      stream.on('error', (err) => {
        log.error('Static file read stream error', log.errCtx(err));
        if (!res.headersSent) {
          sendText(res, 500, 'Failed to serve asset.');
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
    } catch (error) {
      log.error('Static file serving failed', log.errCtx(error));
      if (!canUseSpaFallback) {
        sendText(res, 500, 'Failed to serve asset.', { 'Cache-Control': 'no-store' });
        return;
      }
      try {
        const indexHtml = await readFile(path.join(distDir, 'index.html'));
        res.writeHead(200, {
          ...COMMON_HEADERS,
          'X-Frame-Options': 'DENY',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(indexHtml);
      } catch {
        sendText(res, 500, 'Failed to serve application.');
      }
    }
    } catch (err) {
      if (isPayloadTooLarge(err)) {
        if (!res.headersSent) {
          sendJson(res, 413, { error: 'Request body too large.' });
        }
        return;
      }
      captureException(err, { url: req.url, method: req.method });
      log.error('Unhandled request error', log.errCtx(err));
      if (!res.headersSent) sendText(res, 500, 'Internal server error.');
    }
  });

  server.listen(port, host, () => {
    console.log(`Local: http://${localHost}:${port}`);
    log.info('app server listening', { host, port });
    log.info('PDF rendering uses Chrome', { executablePath });
  });

  async function shutdown(signal) {
    log.info('shutting down app server', { signal });
    server.close();

    if (vite) {
      await vite.close();
    }

    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }

    process.exit(0);
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('uncaughtException', (err) => {
    captureException(err);
    log.error('Uncaught exception', log.errCtx(err));
    void Sentry.close(2000).finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err);
    log.error('Unhandled rejection', log.errCtx(err));
  });
}

void createAppServer();
