// Quick timing of the renderer: node scripts/bench.mjs --t 6 --n 4 --scale 1 --extra "&noao"
import { serve, launchBrowser, openFilm, parseArgs } from './lib.mjs';
import { WIDTH, HEIGHT, FPS } from '../src/config.js';
const args = parseArgs({ t: '6', n: 4, scale: 1, extra: '', workers: 1 });
const width = Math.round(WIDTH * +args.scale), height = Math.round(HEIGHT * +args.scale);
const { server, port } = await serve();
const run = async (id) => {
  const browser = await launchBrowser();
  const page = await openFilm(browser, port, { width, height, extra: args.extra });
  const out = [];
  for (const ts of String(args.t).split(',')) {
    const f0 = Math.round(parseFloat(ts) * FPS);
    await page.evaluate((i) => window.__renderFrame(i, 'image/jpeg', 0.95).length, f0);
    const t1 = Date.now();
    for (let i = 1; i <= +args.n; i++) await page.evaluate((i) => window.__renderFrame(i, 'image/jpeg', 0.95).length, f0 + i);
    out.push(`t=${ts}: ${((Date.now() - t1) / +args.n).toFixed(0)} ms/frame`);
  }
  await browser.close();
  return `worker ${id}: ${out.join(' | ')}`;
};
const t0 = Date.now();
const res = await Promise.all(Array.from({ length: +args.workers }, (_, i) => run(i)));
console.log(res.join('\n'));
console.log(`total ${(Date.now() - t0) / 1000}s`);
server.close();
