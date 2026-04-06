import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
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

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { ...COMMON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
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
    default:
      return 'application/octet-stream';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Puppeteer margin header: label top-left (WO PDF uses workOrderNumber; invoice PDF uses marginHeaderLeft).
 */
function buildHeaderTemplate(workOrderNumber, marginHeaderLeft) {
  const left =
    marginHeaderLeft != null && String(marginHeaderLeft).trim() !== ''
      ? escapeHtml(marginHeaderLeft)
      : workOrderNumber != null && String(workOrderNumber).trim() !== ''
        ? escapeHtml(workOrderNumber)
        : '\u00a0';

  return `
    <div style="width:100%; padding:0 40px; box-sizing:border-box; font-family: Arial, sans-serif; color:#aaaaaa; font-size:9px;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #cccccc; padding:0 0 4px; width:100%;">
        <span style="flex:1; text-align:left; white-space:nowrap;"><span style="font-size:calc(9px + 1pt);font-weight:700;">${left}</span></span>
        <span style="flex:1; text-align:center; white-space:nowrap; text-transform:uppercase;">Confidential</span>
        <span style="flex:1; text-align:right; white-space:nowrap;"><span style="font-size:calc(9px + 1pt);font-weight:700;">${workOrderNumber != null && String(workOrderNumber).trim() !== '' ? escapeHtml(workOrderNumber) : '\u00a0'}</span></span>
      </div>
      <div style="height:10px;"></div>
    </div>
  `;
}

/** providerName = business name (not individual welder name). */
function buildFooterTemplate(providerName, providerPhone) {
  const safeBusinessName = escapeHtml((providerName || '').trim());
  const safeProviderPhone = escapeHtml(providerPhone || '');
  let providerText;
  if (safeBusinessName && safeProviderPhone) {
    providerText = `Service Provider - ${safeBusinessName} | ${safeProviderPhone}`;
  } else if (safeBusinessName) {
    providerText = `Service Provider - ${safeBusinessName}`;
  } else if (safeProviderPhone) {
    providerText = `Service Provider | ${safeProviderPhone}`;
  } else {
    providerText = 'Service Provider';
  }

  return `
    <div style="width:100%; padding:0 40px; box-sizing:border-box; font-family: Arial, sans-serif; color:#aaaaaa; font-size:9px;">
      <div style="height:10px;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #cccccc; padding:4px 0 0; width:100%;">
        <span style="white-space:nowrap;">${providerText}</span>
        <span style="white-space:nowrap;">Page <span class="pageNumber"></span></span>
      </div>
    </div>
  `;
}

async function handlePdfRequest(req, res) {
  let page;

  try {
    const { html, filename, workOrderNumber, marginHeaderLeft, providerName, providerPhone } =
      await readJsonBody(req);

    if (typeof html !== 'string' || !html.trim()) {
      sendText(res, 400, 'Missing HTML payload.');
      return true;
    }

    const browser = await getBrowser();
    page = await browser.newPage();
    /* Letter width at 96dpi — layout matches desktop PDF regardless of client screen */
    await page.setViewport({ width: 816, height: 1056 });
    await page.setDefaultNavigationTimeout(20_000);
    await page.setDefaultTimeout(20_000);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20_000 });
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
      headerTemplate: buildHeaderTemplate(workOrderNumber, marginHeaderLeft),
      footerTemplate: buildFooterTemplate(providerName, providerPhone),
      margin: {
        top: '70px',
        right: '60px',
        bottom: '70px',
        left: '60px',
      },
      timeout: 30_000,
    });

    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename || 'work-order.pdf'}"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
    return true;
  } catch (error) {
    log.error('PDF generation failed', log.errCtx(error));
    const message = error instanceof Error ? error.message : 'Failed to generate PDF.';
    sendText(res, 500, message);
    return true;
  } finally {
    if (page) {
      await page.close();
    }
  }
}

async function createAppServer() {
  initSentry();
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

    const handledEsign = await tryHandleEsignRoute(req, res, {
      readJsonBody,
      sendJson,
      sendText,
    });
    if (handledEsign) {
      return;
    }

    // Rate limit: 5 req/min per IP for Stripe Connect start
    if (req.method === 'POST' && req.url === '/api/stripe/connect/start') {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`stripe-connect:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    // Rate limit: 5 req/min per IP for esign send/resend
    if (req.method === 'POST' && /^\/api\/esign\/(work-orders|change-orders)\/[\w-]+\/(send|resend)$/.test(req.url)) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`esign:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    // Rate limit: 5 req/min per IP for invoice send
    if (req.method === 'POST' && /^\/api\/invoices\/[\w-]+\/send$/.test(req.url)) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`invoice:${clientIp}`, 5, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
    }

    const handledInvoice = await tryHandleInvoiceRoute(req, res, {
      readJsonBody,
      sendJson,
      sendText,
    });
    if (handledInvoice) return;

    const handledStripe = await tryHandleStripeRoute(req, res, {
      readJsonBody,
      readRawBody,
      sendJson,
      sendText,
    });
    if (handledStripe) {
      return;
    }

    if (req.method === 'POST' && req.url === '/api/pdf') {
      // Rate limit: 10 req/min per IP
      const clientIp = getClientIp(req);
      if (!checkRateLimit(`pdf:${clientIp}`, 10, 60 * 1000)) {
        sendJson(res, 429, { error: 'Too many requests.' });
        return;
      }
      await handlePdfRequest(req, res);
      return;
    }

    if (isDev && vite) {
      vite.middlewares(req, res, (err) => {
        if (err) {
          vite.ssrFixStacktrace(err);
          log.error('Vite SSR error', log.errCtx(err));
          sendText(res, 500, err.message);
        }
      });
      return;
    }

    const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    // Strip leading slash so path.join works correctly
    const safePath = normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath;
    let filePath = path.join(distDir, safePath);

    // Containment check to prevent path traversal
    const resolvedDistDir = path.resolve(distDir);
    if (!filePath.startsWith(resolvedDistDir + path.sep) && filePath !== resolvedDistDir) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (!existsSync(filePath) || filePath.endsWith(path.sep)) {
      filePath = path.join(distDir, 'index.html');
    }

    try {
      const mimeType = getMimeType(filePath);
      const isHtml = mimeType.startsWith('text/html');
      res.writeHead(200, {
        ...COMMON_HEADERS,
        ...(isHtml ? { 'X-Frame-Options': 'DENY' } : {}),
        'Content-Type': mimeType,
      });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      log.error('Static file serving failed', log.errCtx(error));
      try {
        const indexHtml = await readFile(path.join(distDir, 'index.html'));
        res.writeHead(200, {
          ...COMMON_HEADERS,
          'X-Frame-Options': 'DENY',
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(indexHtml);
      } catch {
        sendText(res, 500, 'Failed to serve application.');
      }
    }
    } catch (err) {
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
