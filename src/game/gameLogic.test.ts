import { describe, expect, it } from "vitest";
import {
  createGameState,
  damageShieldAt,
  isShieldDamagedAt,
  PLAYER_LIMIT,
  PLAYER_Y,
  updateGame,
} from "./gameLogic";

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

  it("creates irregular seeded shield damage independently for each base", () => {
    const state = createGameState(123);
    const matchingSeed = createGameState(123);
    const differentSeed = createGameState(456);

    expect(damageShieldAt(state, state.shields[0]!, -5.7, -3.25)).toBe(true);
    expect(damageShieldAt(matchingSeed, matchingSeed.shields[0]!, -5.7, -3.25)).toBe(true);
    expect(damageShieldAt(differentSeed, differentSeed.shields[0]!, -5.7, -3.25)).toBe(true);

    expect(state.shields[0]!.damageHoles).toEqual(matchingSeed.shields[0]!.damageHoles);
    expect(state.shields[0]!.damageHoles).not.toEqual(differentSeed.shields[0]!.damageHoles);
    expect(state.shields[1]!.damageHoles).toHaveLength(0);
  });

  it("removes player shots on intact shield impact and keeps clearing behind existing damage", () => {
    const state = createGameState(123);
    const shield = state.shields[0]!;
    state.playerShots = [
      {
        id: 50,
        x: shield.x,
        y: shield.y - shield.height / 2 - 0.2,
      },
    ];
    state.enemyFireCooldown = 100;

    updateGame(state, idle, 0.05);
    expect(state.playerShots).toHaveLength(0);
    expect(shield.damageHoles.length).toBeGreaterThan(0);
    expect(state.shieldHits).toHaveLength(1);
    expect(state.shieldHits[0]).toMatchObject({ shieldId: shield.id, x: shield.x });

    state.playerShots = [
      {
        id: 51,
        x: shield.x,
        y: shield.y - shield.height / 2 - 0.2,
      },
    ];
    const holeCount = shield.damageHoles.length;
    updateGame(state, idle, 0.05);

    expect(state.playerShots).toHaveLength(0);
    expect(shield.damageHoles.length).toBeGreaterThan(holeCount);
  });

  it("eventually destroys a shield after sustained hits and lets shots pass through", () => {
    const state = createGameState(123);
    const shield = state.shields[0]!;
    let hitCount = 0;

    for (
      let y = shield.y - shield.height / 2;
      y <= shield.y + shield.height / 2 && !shield.destroyed;
      y += 0.035
    ) {
      for (
        let x = shield.x - shield.width / 2;
        x <= shield.x + shield.width / 2 && !shield.destroyed;
        x += 0.035
      ) {
        if (damageShieldAt(state, shield, x, y)) hitCount += 1;
      }
    }

    expect(hitCount).toBeGreaterThan(1);
    expect(shield.destroyed).toBe(true);
    expect(isShieldDamagedAt(shield, shield.x, shield.y)).toBe(true);

    state.playerShots = [{ id: 70, x: shield.x, y: shield.y - shield.height / 2 - 0.1 }];
    state.enemyFireCooldown = 100;
    updateGame(state, idle, 0.05);

    expect(state.playerShots).toHaveLength(1);
    expect(shield.destroyed).toBe(true);
    expect(shield.damageHoles.length).toBeLessThan(64);
  });

  it("lets enemy shots damage shields from above", () => {
    const state = createGameState(123);
    const shield = state.shields[2]!;
    state.enemyShots = [
      {
        id: 60,
        x: shield.x,
        y: shield.y + shield.height / 2 + 0.1,
      },
    ];
    state.enemyFireCooldown = 100;

    updateGame(state, idle, 0.05);

    expect(state.enemyShots).toHaveLength(0);
    expect(shield.damageHoles.length).toBeGreaterThan(0);
    expect(state.shieldHits).toHaveLength(1);
  });

  it("starts each new game with intact shields", () => {
    const state = createGameState(123);
    damageShieldAt(state, state.shields[0]!, -5.7, -3.25);

    const restarted = createGameState(456);

    expect(restarted.shields.every((shield) => shield.damageHoles.length === 0)).toBe(true);
    expect(restarted.damageRandomState).not.toBe(state.damageRandomState);
  });
});
