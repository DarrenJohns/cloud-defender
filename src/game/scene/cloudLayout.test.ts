import { describe, expect, it } from "vitest";
import { CLOUD_COUNT, cloudLayout, createCloudWidths } from "./cloudLayout";

describe("balanced background clouds", () => {
  it("keeps five visible, separated slots throughout a long session", () => {
    for (let seconds = 0; seconds <= 7200; seconds += 7) {
      const clouds = cloudLayout(seconds);
      expect(clouds).toHaveLength(CLOUD_COUNT);
      expect(clouds.length).toBeGreaterThanOrEqual(3);
      expect(clouds.length).toBeLessThanOrEqual(6);
      clouds.forEach((cloud, index) => {
        expect(cloud.x - cloud.width / 2).toBeGreaterThan(-0.9);
        expect(cloud.x + cloud.width / 2).toBeLessThan(0.9);
        expect(cloud.y).toBeGreaterThan(0.15);
        expect(cloud.y).toBeLessThan(0.7);
        if (index === 0) return;
        const previous = clouds[index - 1]!;
        expect(cloud.x - previous.x).toBeCloseTo(0.35, 10);
        expect(cloud.x - cloud.width / 2 - previous.x - previous.width / 2).toBeGreaterThan(0.065);
      });

    }
  });

  it("randomizes sizes once, with a natural small-to-large mix that still fits each slot", () => {
    expect(createCloudWidths(1)).not.toEqual(createCloudWidths(2));
    expect(createCloudWidths(1)).toEqual(createCloudWidths(1));
    for (let seed = 0; seed < 200; seed++) {
      const widths = createCloudWidths(seed);
      expect(widths).toHaveLength(CLOUD_COUNT);
      expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(1.8);
      for (const seconds of [0, 63, 190, 1200, 7200]) {
        const clouds = cloudLayout(seconds, widths);
        clouds.forEach((cloud, index) => {
          expect(cloud.width).toBe(widths[index]);
          expect(cloud.x - cloud.width / 2).toBeGreaterThan(-0.9);
          expect(cloud.x + cloud.width / 2).toBeLessThan(0.9);
          if (index > 0) {
            const previous = clouds[index - 1]!;
            expect(cloud.x - cloud.width / 2 - previous.x - previous.width / 2).toBeGreaterThan(0.065);
          }
        });
      }
    }
  });

  it("drifts smoothly without offscreen respawns", () => {
    for (let seconds = 0; seconds < 300; seconds++) {
      const before = cloudLayout(seconds);
      cloudLayout(seconds + 1 / 60).forEach((cloud, index) => {
        expect(Math.abs(cloud.x - before[index]!.x)).toBeLessThan(0.0002);
        expect(Math.abs(cloud.y - before[index]!.y)).toBeLessThan(0.0001);
      });

    }
  });

  it("has visible drift within a few seconds without changing cloud sizes", () => {
    const start = cloudLayout(0);
    const later = cloudLayout(5);
    later.forEach((cloud, index) => {
      expect(cloud.x - start[index]!.x).toBeGreaterThan(0.035);
      expect(cloud.width).toBe(start[index]!.width);
    });
  });
});
