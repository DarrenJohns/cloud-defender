import { BoxGeometry } from "three";
import { expect, it } from "vitest";
import { splitIntoShards } from "./hudShieldBurst";

it("produces closed volumetric chunks rather than disconnected triangle shells", () => {
  const source = new BoxGeometry(1, 1, 0.3, 6, 6, 2).toNonIndexed();
  const shards = splitIntoShards(source, 9);
  try {
    expect(shards.length).toBeGreaterThanOrEqual(6);
    for (const shard of shards) {
      shard.geometry.computeBoundingBox();
      const bounds = shard.geometry.boundingBox!;
      expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0);
      const positions = shard.geometry.getAttribute("position");
      const edges = new Map<string, number>();
      const vertex = (index: number) => [positions.getX(index), positions.getY(index), positions.getZ(index)].join(",");
      for (let index = 0; index < positions.count; index += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const key = [vertex(index + corner), vertex(index + (corner + 1) % 3)].sort().join("|");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every((count) => count === 2)).toBe(true);
    }
  } finally {
    source.dispose();
    shards.forEach((shard) => shard.geometry.dispose());
  }
});
