// FFmpeg: numbered frames (+ synthesised soundtrack) -> H.264 MP4.
//
//   node scripts/encode.mjs                      -> Backrooms_PoolRooms.mp4 (1080p60)
//   node scripts/encode.mjs --frames build/preview --step 2 --out build/preview.mp4
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, BUILD, ROOT } from './lib.mjs';
import { FPS, DURATION, TOTAL_FRAMES } from '../src/config.js';

const args = parseArgs({ frames: path.join(BUILD, 'frames'), step: 1, format: 'jpg', audio: path.join(BUILD, 'audio.wav'), out: path.join(ROOT, 'Backrooms_PoolRooms.mp4'), crf: 21, preset: 'slow' });   // crf 17 is visually the same but ~185 MB (film grain is expensive)
const step = +args.step;
const fps = FPS / step;
const frames = path.resolve(args.frames);
const expected = Math.ceil(TOTAL_FRAMES / step);
const have = fs.readdirSync(frames).filter((f) => f.startsWith('frame_') && f.endsWith(`.${args.format}`)).length;
if (have < expected) console.warn(`warning: ${have}/${expected} frames present`);

// frames are numbered by film frame index; with --step N only every Nth exists
let input;
if (step === 1) {
  input = ['-framerate', String(fps), '-start_number', '0', '-i', path.join(frames, `frame_%05d.${args.format}`)];
} else {
  const list = path.join(frames, 'list.txt');
  const lines = [];
  for (let i = 0; i < TOTAL_FRAMES; i += step) lines.push(`file 'frame_${String(i).padStart(5, '0')}.${args.format}'`, `duration ${1 / fps}`);
  fs.writeFileSync(list, lines.join('\n') + '\n');
  input = ['-f', 'concat', '-safe', '0', '-r', String(fps), '-i', list];
}
const hasAudio = fs.existsSync(args.audio);
const cmd = [
  '-y', '-hide_banner', '-loglevel', 'warning', '-stats',
  ...input,
  ...(hasAudio ? ['-i', args.audio] : []),
  '-t', String(DURATION),
  '-r', String(fps),
  '-c:v', 'libx264', '-preset', String(args.preset), '-crf', String(args.crf), '-profile:v', 'high', '-level', '4.2',
  '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
  '-g', String(Math.round(fps)), '-bf', '2',
  ...(hasAudio ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2'] : ['-an']),
  '-movflags', '+faststart',
  path.resolve(args.out),
];
console.log('ffmpeg ' + cmd.join(' '));
const r = spawnSync('ffmpeg', cmd, { stdio: 'inherit' });
process.exit(r.status ?? 1);
