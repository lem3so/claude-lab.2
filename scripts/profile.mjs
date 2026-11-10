// Per-stage timing of one frame: node scripts/profile.mjs --t 6,10
import { serve, launchBrowser, openFilm, parseArgs } from './lib.mjs';
import { WIDTH, HEIGHT, FPS } from '../src/config.js';
const args = parseArgs({ t: '6', scale: 1, extra: '' });
const { server, port } = await serve();
const browser = await launchBrowser();
const page = await openFilm(browser, port, { width: Math.round(WIDTH * +args.scale), height: Math.round(HEIGHT * +args.scale), extra: args.extra });
for (const ts of String(args.t).split(',')) {
  const f = Math.round(parseFloat(ts) * FPS);
  await page.evaluate((i) => window.__profile(i), f);
  console.log(`t=${ts}:  ${await page.evaluate((i) => window.__profile(i), f + 1)}`);
}
await browser.close();
server.close();
