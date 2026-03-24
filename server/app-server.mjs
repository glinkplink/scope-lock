import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const isDev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  '/usr/bin/google-chrome-stable';

let browserPromise;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  return browserPromise;
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
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
        <span style="flex:1; text-align:right; white-space:nowrap; opacity:0;">placeholder</span>
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
    await page.setContent(html, { waitUntil: 'networkidle0' });
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
    });

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename || 'work-order.pdf'}"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
    return true;
  } catch (error) {
    console.error('PDF generation failed:', error);
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
    if (!req.url || !req.method) {
      sendText(res, 400, 'Invalid request.');
      return;
    }

    if (req.method === 'GET' && req.url === '/api/pdf/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/pdf') {
      await handlePdfRequest(req, res);
      return;
    }

    if (isDev && vite) {
      vite.middlewares(req, res, (err) => {
        if (err) {
          vite.ssrFixStacktrace(err);
          console.error(err);
          sendText(res, 500, err.message);
        }
      });
      return;
    }

    const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(distDir, normalizedPath);

    if (!existsSync(filePath) || filePath.endsWith(path.sep)) {
      filePath = path.join(distDir, 'index.html');
    }

    try {
      const mimeType = getMimeType(filePath);
      res.writeHead(200, { 'Content-Type': mimeType });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error('Static file serving failed:', error);
      try {
        const indexHtml = await readFile(path.join(distDir, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexHtml);
      } catch {
        sendText(res, 500, 'Failed to serve application.');
      }
    }
  });

  server.listen(port, host, () => {
    console.log(`App server listening on http://${host}:${port}`);
    console.log(`PDF rendering uses Chrome at ${executablePath}`);
  });

  async function shutdown(signal) {
    console.log(`Received ${signal}, shutting down app server...`);
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
}

void createAppServer();
