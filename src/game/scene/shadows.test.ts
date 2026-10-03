import { CanvasTexture, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { PLAYER_GROUND_Y, PLAYER_SHADOW_Y } from "./constants";
import { ALIEN_SHADOW_DEPTH, ROW_SHADOW_LIFT, ROW_SHADOW_Z, SHIELD_SHADOW_DEPTH, SHIELD_SHADOW_MAX_OPACITY, makeAlienShadow, updateAlienShadow } from "./shadows";

describe("alien shadow consistency", () => {
  it("matches the firewall depth, floor line and maximum strength", () => {
    const texture = new CanvasTexture();
    const shadow = makeAlienShadow(texture);
    try {
      expect(ALIEN_SHADOW_DEPTH).toBe(SHIELD_SHADOW_DEPTH);
      updateAlienShadow(shadow, 3, PLAYER_GROUND_Y);
      expect(shadow.position.toArray()).toEqual([3, PLAYER_SHADOW_Y + ROW_SHADOW_LIFT, ROW_SHADOW_Z]);
      expect(shadow.rotation.x).toBe(-Math.PI / 2);
      expect((shadow.material as MeshBasicMaterial).opacity).toBe(SHIELD_SHADOW_MAX_OPACITY);
      updateAlienShadow(shadow, 3, PLAYER_GROUND_Y + 4);
      expect((shadow.material as MeshBasicMaterial).opacity).toBeLessThan(SHIELD_SHADOW_MAX_OPACITY);
      updateAlienShadow(shadow, 3, PLAYER_GROUND_Y + 9);
      expect(shadow.visible).toBe(false);
    } finally {
      shadow.geometry.dispose();
      (shadow.material as MeshBasicMaterial).dispose();
      texture.dispose();
    }
  });
});
