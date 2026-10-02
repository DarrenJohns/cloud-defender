import { describe, expect, it } from "vitest";
import { marchInterval } from "./audio";

describe("marchInterval", () => {
  it("speeds up as aliens are destroyed", () => {
    expect(marchInterval(6, 1.15)).toBeLessThan(marchInterval(18, 1.15));
  });

  it("speeds up as the formation moves faster", () => {
    expect(marchInterval(18, 3)).toBeLessThan(marchInterval(18, 1.15));
  });

  it("stays within a playable tempo range", () => {
    expect(marchInterval(18, 0.2)).toBeLessThanOrEqual(0.75);
    expect(marchInterval(1, 50)).toBeGreaterThanOrEqual(0.11);
  });
});
