// Global constants shared by the browser renderer and the Node tooling.
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 60;
export const DURATION = 20;
export const TOTAL_FRAMES = FPS * DURATION;

export const WATER_Y = 0;            // water surface height of the whole pool complex
export const TILE_TEX_METERS = 1.0;  // one tile texture repeat = 1 m (8 x 8 tiles of 12.5 cm)
export const CORRIDOR_Y = 26;        // floor height of the "ordinary" corridor, straight above the pools
export const EYE = 1.62;             // standing eye height
export const SPLASH = { x: 0, z: 8.5 };   // where the camera hits the water
export const CUT_TO_BLACK = 19.0;    // hard cut — the last second is black
