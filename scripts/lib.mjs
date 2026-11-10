// Shared tooling: static file server + headless Chromium with software WebGL.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD = path.join(ROOT, 'build');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
};

export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// Playwright is resolved from the project if installed, otherwise from a
// global install (NODE_PATH); CHROMIUM_PATH can point at any Chrome binary.
export async function launchBrowser() {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
  return pw.chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
      '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      ...(process.env.USE_GPU ? ['--use-angle=default', '--enable-gpu'] : []),
    ],
  });
}

export async function openFilm(browser, port, { width, height, extra = '' } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/index.html?capture=1&w=${width}&h=${height}${extra}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 600000 });
  return page;
}

export function parseArgs(defaults = {}) {
  const out = { ...defaults };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    out[k] = v;
  }
  return out;
}
