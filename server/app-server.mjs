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

async function handlePdfRequest(req, res) {
  let page;

  try {
    const { html, filename } = await readJsonBody(req);

    if (typeof html !== 'string' || !html.trim()) {
      sendText(res, 400, 'Missing HTML payload.');
      return true;
    }

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('screen');
    await page.evaluate(async () => {
      if ('fonts' in document) {
        await document.fonts.ready;
      }
    });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
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
