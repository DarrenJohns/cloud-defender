import { describe, expect, it } from "vitest";
import { makeStarField, STAR_COUNT, STAR_MARGIN_COUNT } from "./background";

describe("sparkling starfield", () => {
  it("fills the sky and parallax margins with small round stars and gentle twinkles", () => {
    const { points, material } = makeStarField();
    try {
      expect(STAR_COUNT).toBe(720);
      expect(STAR_MARGIN_COUNT).toBe(940);
      expect(points.geometry.getAttribute("position").count).toBe(STAR_COUNT + STAR_MARGIN_COUNT);
      const sizes = Array.from(points.geometry.getAttribute("aSize").array);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.018);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(0.06);
      const brightFraction = sizes.filter((size) => size >= 0.045).length / sizes.length;
      expect(brightFraction).toBeGreaterThan(0.25);
      expect(brightFraction).toBeLessThan(0.35);
      expect(material.fragmentShader).not.toContain("rays");
      expect(material.fragmentShader).not.toContain("vSparkle");
      const phases = Array.from(points.geometry.getAttribute("aPhase").array);
      expect(new Set(phases).size).toBe(phases.length);
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
    } finally {
      points.geometry.dispose();
      material.dispose();
    }
  });
});
