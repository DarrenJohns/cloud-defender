import { describe, expect, it } from "vitest";
import { createGameState, PLAYER_LIMIT, PLAYER_Y, updateGame } from "./gameLogic";

const idle = { left: false, right: false, fire: false };

describe("game simulation", () => {
  it("moves the ship and keeps it inside the playfield", () => {
    const state = createGameState();
    updateGame(state, { ...idle, right: true }, 0.05);

    expect(state.shipX).toBeCloseTo(0.4);

    state.shipX = PLAYER_LIMIT;
    updateGame(state, { ...idle, right: true }, 0.05);
    expect(state.shipX).toBe(PLAYER_LIMIT);
  });

  it("fires, removes a hit enemy, and awards score", () => {
    const state = createGameState();
    state.shipX = state.enemies[0]!.x;
    state.enemies = [{ ...state.enemies[0]!, x: state.shipX, y: PLAYER_Y + 1.1 }];
    state.enemyFireCooldown = 10;

    updateGame(state, { ...idle, fire: true }, 0.05);
    updateGame(state, { ...idle, fire: true }, 0.05);

    expect(state.score).toBe(10);
    expect(state.enemies).toHaveLength(0);
    expect(state.mode).toBe("won");
  });

  it("loses one shield when an enemy shot hits the ship", () => {
    const state = createGameState();
    state.enemyShots = [{ id: 99, x: state.shipX, y: PLAYER_Y }];
    state.enemyFireCooldown = 10;

    updateGame(state, idle, 0.016);

    expect(state.lives).toBe(2);
    expect(state.invulnerability).toBeGreaterThan(0);
  });

  it("reverses and drops the formation at the playfield edge", () => {
    const state = createGameState();
    state.enemies = [{ ...state.enemies[0]!, x: 6.6, y: 2 }];
    state.enemyFireCooldown = 10;

    updateGame(state, idle, 0.05);

    expect(state.enemyDirection).toBe(-1);
    expect(state.enemies[0]!.y).toBeCloseTo(1.72);
  });
});
