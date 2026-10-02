import { ALIEN_VARIANT_COUNT, GROUND_Y, WORLD_WIDTH } from "../gameLogic";

export const HALF_WIDTH = WORLD_WIDTH / 2;
export const CAMERA_DISTANCE = 20;
// Smallest world height kept in view so the full play field fits on wide, short screens.
export const MIN_VIEW_HEIGHT = 15.6;
export const CAMERA_HEIGHT = 2;
// Maximum camera offset (world units) when the mouse is at the window edge.
export const PARALLAX_X = 4.5;
export const PARALLAX_Y = 2.2;
export const PARALLAX_EASE = 5;
// Far layers are oversized so the parallax offset never reveals their edges.
export const PARALLAX_OVERSCAN = 1.6;
export const BACKGROUND_DISTANCE = 30;
export const PLAYER_SHADOW_Y = GROUND_Y;
// Depth plane projectiles travel in; bomb splats land on the floor at this depth, in line with the A.
export const BOMB_DEPTH = 0.2;
export const PLAYER_GROUND_Y = PLAYER_SHADOW_Y;
export const DAMAGE_HOLE_CAPACITY = 64;
// Visible crater radius as a fraction of the logical damage-hole radius.
export const HOLE_CUT_FACTOR = 0.74;
export const SHIELD_CHUNK_COLORS = ["#e13d48", "#fa606a", "#9e202d"];
export const ALIEN_MODEL_PATHS = Array.from(
  { length: ALIEN_VARIANT_COUNT },
  (_, index) => `/assets/alien${index + 1}.glb`,
);
