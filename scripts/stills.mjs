// Render single frames for look development:
//   node scripts/stills.mjs --times 0.5,2.6,4.5,6 --scale 0.5
import fs from 'node:fs';
import path from 'node:path';
import { serve, launchBrowser, openFilm, parseArgs, BUILD } from './lib.mjs';
import { WIDTH, HEIGHT, FPS } from '../src/config.js';

const args = parseArgs({ times: '1,2.7,3.3,3.8,4.5,6,8,10,11.4,13.5,15.5,17.3,18.4', scale: 0.5, out: path.join(BUILD, 'stills'), extra: '' });
const scale = +args.scale;
const width = Math.round(WIDTH * scale), height = Math.round(HEIGHT * scale);
fs.mkdirSync(args.out, { recursive: true });

const { server, port } = await serve();
const browser = await launchBrowser();
const t0 = Date.now();
const page = await openFilm(browser, port, { width, height, extra: args.extra });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const ts of String(args.times).split(',')) {
  const t = parseFloat(ts);
  const frame = Math.round(t * FPS);
  const t1 = Date.now();
  const url = await page.evaluate(([i]) => window.__renderFrame(i, 'image/jpeg', 0.92), [frame]);
  const file = path.join(args.out, `t${t.toFixed(2).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${file}  ${Date.now() - t1} ms`);
}
await browser.close();
server.close();
