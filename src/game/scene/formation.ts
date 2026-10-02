import { Group, Mesh } from "three";
import { seededRandom } from "./textures";

export interface FlightPose {
  x: number;
  y: number;
  z: number;
  bank: number;
  pitch: number;
  yaw: number;
}

// Each alien swoops in from off-screen (top, left or right) along a curved,
// depth-varying path, staggered so the formation assembles organically.
export function formationFlightPose(id: number, targetX: number, targetY: number, progress: number): FlightPose {
  const random = seededRandom(id * 7919 + 104729);
  const side = Math.floor(random() * 3);
  let startX: number;
  let startY: number;
  if (side === 0) {
    startX = (random() - 0.5) * 22;
    startY = 10 + random() * 3;
  } else {
    const direction = side === 1 ? -1 : 1;
    startX = direction * (14 + random() * 4);
    startY = 1 + random() * 8;
  }
  const startZ = 2 + random() * 4;
  const controlX = (startX + targetX) / 2 + (random() - 0.5) * 9;
  const controlY = Math.max(startY, targetY) + 0.5 + random() * 3.5;
  const controlZ = startZ * 0.5 + (random() - 0.3) * 3;
  const delay = random() * 0.42;
  const local = Math.max(0, Math.min(1, (progress - delay) / (0.97 - delay)));
  const t = 1 - (1 - local) ** 3;
  const u = 1 - t;
  const bezier = (a: number, b: number, c: number) => u * u * a + 2 * u * t * b + t * t * c;
  const tangentX = 2 * u * (controlX - startX) + 2 * t * (targetX - controlX);
  const tangentY = 2 * u * (controlY - startY) + 2 * t * (targetY - controlY);
  const settle = u * u;
  return {
    x: bezier(startX, controlX, targetX),
    y: bezier(startY, controlY, targetY),
    z: bezier(startZ, controlZ, 0),
    bank: Math.max(-0.9, Math.min(0.9, -tangentX * 0.05)) * settle,
    pitch: Math.max(-0.6, Math.min(0.6, tangentY * 0.04)) * settle,
    yaw: Math.max(-0.7, Math.min(0.7, tangentX * 0.04)) * settle,
  };
}

export function makeEnemy(model: Group): Group {
  const enemy = new Group();
  const alien = model.clone(true);
  alien.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  enemy.add(alien);
  return enemy;
}
