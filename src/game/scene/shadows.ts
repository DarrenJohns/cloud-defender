import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { GameState } from "../gameLogic";
import { SHIELD_WIDTH, isShieldDamagedAt } from "../gameLogic";
import { PLAYER_GROUND_Y, PLAYER_SHADOW_Y } from "./constants";

export const SHIP_SHADOW_WIDTH = 2.6;
export const SHIP_SHADOW_DEPTH = 0.38;
export const ALIEN_SHADOW_WIDTH = 1.3;
// Extrudes the alien GLBs along Z at load time so they read as chunkier 3D objects.
export const ALIEN_DEPTH_MULTIPLIER = 4;
export const ALIEN_SHADOW_DEPTH = 0.5;
// Alien shadows start appearing once an alien is this far above the floor.
export const ALIEN_SHADOW_FADE_HEIGHT = 8;
export const SHIELD_SHADOW_MAX_OPACITY = 0.15;
export const ALIEN_SHADOW_MAX_OPACITY = SHIELD_SHADOW_MAX_OPACITY;
// Raised slightly above the A's shadow line so the firewalls read as standing just behind the A.
// Aliens and firewalls share a depth row behind the A, so their shadows share one line.
export const ROW_SHADOW_LIFT = 0.28;
export const ROW_SHADOW_Z = -0.25;
export const SHIELD_SHADOW_COLUMNS = 40;
export const SHIELD_SHADOW_ROWS = 10;
export const SHIELD_SHADOW_PADDING = 0.3;
export const SHIELD_SHADOW_DEPTH = 0.5;

export type ShieldShadow = { mesh: Mesh; canvas: HTMLCanvasElement; texture: CanvasTexture; holeCount: number; destroyed: boolean };

export function makeShieldShadow(): ShieldShadow {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new PlaneGeometry(SHIELD_WIDTH + SHIELD_SHADOW_PADDING * 2, SHIELD_SHADOW_DEPTH),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = -1;
  return { mesh, canvas, texture, holeCount: -1, destroyed: false };
}

// Draws the shadow as the firewall's silhouette seen from above: each column darkens by how much
// of the wall above it is still intact, so blasted-out sections leave matching gaps on the floor.
export function drawShieldShadow(shadow: ShieldShadow, shield: GameState["shields"][number]): void {
  const context = shadow.canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render the firewall shadow.");
  const { width, height } = shadow.canvas;
  context.clearRect(0, 0, width, height);
  if (shield.destroyed) {
    shadow.texture.needsUpdate = true;
    return;
  }
  const padding = (SHIELD_SHADOW_PADDING / (SHIELD_WIDTH + SHIELD_SHADOW_PADDING * 2)) * width;
  const columnWidth = (width - padding * 2) / SHIELD_SHADOW_COLUMNS;
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error("A 2D canvas context is required to render the firewall shadow.");
  for (let column = 0; column < SHIELD_SHADOW_COLUMNS; column += 1) {
    const x = shield.x - shield.width / 2 + ((column + 0.5) / SHIELD_SHADOW_COLUMNS) * shield.width;
    let intact = 0;
    for (let row = 0; row < SHIELD_SHADOW_ROWS; row += 1) {
      const y = shield.y - shield.height / 2 + ((row + 0.5) / SHIELD_SHADOW_ROWS) * shield.height;
      if (!isShieldDamagedAt(shield, x, y)) intact += 1;
    }
    // Taper the ends so the intact wall casts a soft ellipse like the A's shadow.
    const along = (column + 0.5) / SHIELD_SHADOW_COLUMNS;
    const taper = Math.sqrt(Math.max(0, 1 - Math.pow(2 * along - 1, 2)));
    const alpha = (intact / SHIELD_SHADOW_ROWS) * (0.35 + 0.65 * taper) * SHIELD_SHADOW_MAX_OPACITY;
    if (alpha <= 0) continue;
    const gradient = maskContext.createLinearGradient(0, height * 0.18, 0, height * 0.82);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(0.5, `rgba(0, 0, 0, ${alpha.toFixed(3)})`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    maskContext.fillStyle = gradient;
    maskContext.fillRect(Math.floor(padding + column * columnWidth), height * 0.18, Math.ceil(columnWidth) + 1, height * 0.64);
  }
  // One blur over the whole silhouette avoids striping between columns.
  context.filter = "blur(7px)";
  context.drawImage(mask, 0, 0);
  context.filter = "none";
  shadow.texture.needsUpdate = true;
}

export function makeShipShadow(): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render the ship shadow.");
  const gradient = context.createRadialGradient(128, 64, 3, 128, 64, 64);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.56)");
  gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.25)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const shadow = new Mesh(
    new PlaneGeometry(SHIP_SHADOW_WIDTH, SHIP_SHADOW_DEPTH),
    new MeshBasicMaterial({
      map: new CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0, PLAYER_SHADOW_Y, -0.15);
  return shadow;
}

export function makeAlienShadow(texture: CanvasTexture): Mesh {
  const shadow = new Mesh(
    new PlaneGeometry(ALIEN_SHADOW_WIDTH, ALIEN_SHADOW_DEPTH),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    }),
  );
  shadow.renderOrder = -1;
  return shadow;
}

export function updateAlienShadow(shadow: Mesh, x: number, alienY: number): void {
  const height = Math.max(0, alienY - PLAYER_GROUND_Y);
  const closeness = Math.max(0, Math.min(1, 1 - height / ALIEN_SHADOW_FADE_HEIGHT));
  const eased = closeness * closeness;
  (shadow.material as MeshBasicMaterial).opacity = eased * ALIEN_SHADOW_MAX_OPACITY;
  const scale = 0.7 + closeness * 0.45;
  shadow.scale.set(scale, scale, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(x, PLAYER_SHADOW_Y + ROW_SHADOW_LIFT, ROW_SHADOW_Z);
  shadow.visible = closeness > 0;
}
