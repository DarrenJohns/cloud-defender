import { describe, expect, it } from "vitest";
import { SHIELD_HEIGHT, SHIELD_Y } from "../gameLogic";
import { alienForegroundDepth } from "./foregroundDepth";

describe("aliens in front of firewall bases", () => {
  it("keeps the full model ahead of the front face before it can overlap", () => {
    for (const radius of [0.4, 0.7, 1]) {
      for (const front of [0.2, 0.6, 1.2]) {
        const overlapTop = SHIELD_Y + SHIELD_HEIGHT / 2 + radius;
        for (let y = overlapTop; y >= SHIELD_Y - 1; y -= 0.1) {
          // Account for the largest backwards hover offset.
          expect(alienForegroundDepth(y, radius, front) - radius - 0.055).toBeGreaterThan(front);
        }
      }
    }
  });

  it("retains upper formation depth and approaches the foreground smoothly", () => {
    const radius = 0.7;
    const front = 0.5;
    const start = SHIELD_Y + SHIELD_HEIGHT / 2 + radius + 1.1;
    expect(alienForegroundDepth(start + 1, radius, front)).toBe(0);
    expect(alienForegroundDepth(start, radius, front)).toBeCloseTo(0);
    let previous = 0;
    for (let step = 0; step <= 100; step++) {
      const depth = alienForegroundDepth(start - step / 100, radius, front);
      expect(depth).toBeGreaterThanOrEqual(previous);
      expect(depth - previous).toBeLessThan(0.03);
      previous = depth;
    }
  });
});
