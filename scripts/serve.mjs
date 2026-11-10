// Real-time preview in your own browser (needs a GPU to be smooth):
//   npm run dev   ->   http://localhost:5173
import { serve } from './lib.mjs';
const { port } = await serve(+(process.env.PORT || 5173));
console.log(`Backrooms / Pool Rooms preview:  http://localhost:${port}`);
console.log('  ?w=960&h=540      render size');
console.log('  click for sound (run `npm run audio` first), space = pause');
