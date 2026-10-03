import { SHIELD_HEIGHT, SHIELD_Y } from "../gameLogic";

/** Move forward before the model can overlap a base, retaining the upper formation's depth. */
export function alienForegroundDepth(y: number, radius: number, firewallFront: number): number {
  const overlapTop = SHIELD_Y + SHIELD_HEIGHT / 2 + radius + 0.1;
  const progress = Math.max(0, Math.min(1, (overlapTop + 1 - y)));
  const blend = progress * progress * (3 - 2 * progress);
  return (firewallFront + radius + 0.12) * blend;
}
