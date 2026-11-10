// Automated frame capture.
//
// Drives the film frame by frame in headless Chromium and writes numbered
// images to build/frames/. Every frame is a pure function of its index, so
// the range is simply split between workers and an interrupted run resumes
// where it stopped (existing frames are skipped unless --force is given).
//
//   node scripts/render.mjs                         full 1920x1080, 1200 frames
//   node scripts/render.mjs --scale 0.25 --step 2   quick motion preview
//   node scripts/render.mjs --from 1000 --to 1140   a section
import fs from 'node:fs';
import path from 'node:path';
import { serve, launchBrowser, openFilm, parseArgs, BUILD } from './lib.mjs';
import { WIDTH, HEIGHT, TOTAL_FRAMES } from '../src/config.js';

const args = parseArgs({ scale: 1, step: 1, from: 0, to: TOTAL_FRAMES, workers: 2, format: 'jpg', quality: 0.97, out: path.join(BUILD, 'frames'), force: false, extra: '' });
const scale = +args.scale, step = +args.step;
const width = Math.round((WIDTH * scale) / 2) * 2, height = Math.round((HEIGHT * scale) / 2) * 2;
const mime = args.format === 'png' ? 'image/png' : 'image/jpeg';
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });

const name = (i) => path.join(out, `frame_${String(i).padStart(5, '0')}.${args.format}`);
const todo = [];
for (let i = +args.from; i < +args.to; i += step) if (args.force || !fs.existsSync(name(i))) todo.push(i);
console.log(`${todo.length} frames to render at ${width}x${height} (${args.workers} workers) -> ${out}`);
if (!todo.length) process.exit(0);

const { server, port } = await serve();
const t0 = Date.now();
let done = 0, next = 0;

async function worker(id) {
  const browser = await launchBrowser();
  const page = await openFilm(browser, port, { width, height, extra: args.extra });
  while (next < todo.length) {
    const i = todo[next++];
    const url = await page.evaluate(([f, m, q]) => window.__renderFrame(f, m, q), [i, mime, +args.quality]);
    const tmp = `${name(i)}.part`;
    fs.writeFileSync(tmp, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    fs.renameSync(tmp, name(i));
    done++;
    if (done % 20 === 0 || done === todo.length) {
      const el = (Date.now() - t0) / 1000;
      const eta = (el / done) * (todo.length - done);
      console.log(`  ${done}/${todo.length}  ${(el / done).toFixed(2)} s/frame  elapsed ${(el / 60).toFixed(1)} min  eta ${(eta / 60).toFixed(1)} min`);
    }
  }
  await browser.close();
}

await Promise.all(Array.from({ length: Math.min(+args.workers, todo.length) }, (_, id) => worker(id)));
server.close();
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
