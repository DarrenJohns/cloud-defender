import { describe, expect, it } from "vitest";
import {
  createGameState as createNewGame,
  damageShieldAt,
  erodeShieldsUnderEnemies,
  FAST_FORWARD_ENEMY_MULTIPLIER,
  FORMATION_INTRO_SECONDS,
  GROUND_Y,
  isShieldDamagedAt,
  PLAYER_LIMIT,
  PLAYER_Y,
  updateAftermath,
  updateGame,
} from "./gameLogic";

const idle = { left: false, right: false, fire: false };

// Most scenarios exercise live combat, so skip the wave's fly-in by default.
function createGameState(seed?: number): ReturnType<typeof createNewGame> {
  const state = createNewGame(seed);
  state.formationIntro = 0;
  return state;
}

describe("game simulation", () => {
  it("holds the wave inert while it flies into formation", () => {
    const state = createNewGame(7);
    expect(state.formationIntro).toBe(FORMATION_INTRO_SECONDS);
    const formation = state.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y }));
    state.enemyFireCooldown = 0;

    updateGame(state, { ...idle, right: true, fire: true }, 0.05);

    expect(state.shipX).toBeGreaterThan(0);
    expect(state.playerShots).toHaveLength(0);
    expect(state.enemyShots).toHaveLength(0);
    expect(state.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y }))).toEqual(formation);

    for (let elapsed = 0; elapsed < FORMATION_INTRO_SECONDS + 0.1; elapsed += 0.05) {
      updateGame(state, idle, 0.05, () => 0.5);
    }
    expect(state.formationIntro).toBe(0);
    expect(state.enemies[0]!.x).not.toBe(formation[0]!.x);
  });

  it("flies each new wave in after the previous one is cleared", () => {
    const state = createGameState();
    state.enemies = [];
    updateGame(state, idle, 0.016);

    expect(state.level).toBe(2);
    expect(state.formationIntro).toBe(FORMATION_INTRO_SECONDS);
  });
  it("moves the ship and keeps it inside the playfield", () => {
    const state = createGameState();
    updateGame(state, { ...idle, right: true }, 0.05);

    expect(state.shipX).toBeCloseTo(0.4);

    state.shipX = PLAYER_LIMIT;
    updateGame(state, { ...idle, right: true }, 0.05);
    expect(state.shipX).toBe(PLAYER_LIMIT);
  });

  it("fires, scores a hit, and starts the next alien wave", () => {
    const state = createGameState();
    state.shipX = state.enemies[0]!.x;
    state.enemies = [{ ...state.enemies[0]!, x: state.shipX, y: PLAYER_Y + 1.1 }];
    state.enemyFireCooldown = 10;

    updateGame(state, { ...idle, fire: true }, 0.05);

    expect(state.score).toBe(10);
    expect(state.level).toBe(2);
    expect(state.enemies).toHaveLength(18);
    expect(state.enemies.slice(0, 6).every((enemy) => enemy.modelIndex === 3)).toBe(true);
    expect(state.enemies.slice(6, 12).every((enemy) => enemy.modelIndex === 4)).toBe(true);
    expect(state.enemies.slice(12).every((enemy) => enemy.modelIndex === 5)).toBe(true);
    expect(state.enemySpeed).toBeGreaterThan(1.15);
    expect(state.mode).toBe("playing");
  });

  it("cycles every alien model through the waves and preserves shield damage", () => {
    const state = createGameState(123);
    const shield = state.shields[0]!;
    expect(damageShieldAt(state, shield, shield.x, shield.y)).toBe(true);
    const damagedHoleCount = shield.damageHoles.length;
    const modelIndices = new Set<number>();

    for (let level = 1; level <= 4; level += 1) {
      for (const enemy of state.enemies) modelIndices.add(enemy.modelIndex);
      if (level < 4) {
        state.enemies = [];
        updateGame(state, idle, 0.016);
        state.formationIntro = 0;
      }
    }

    expect(state.level).toBe(4);
    expect(modelIndices.size).toBe(10);
    expect(shield.damageHoles).toHaveLength(damagedHoleCount);
    expect(state.enemySpeed).toBeGreaterThan(1.15);
  });

  it("increases enemy firing rate on later waves", () => {
    const firstWave = createGameState();
    const laterWave = createGameState();
    laterWave.level = 4;
    firstWave.enemyFireCooldown = 0;
    laterWave.enemyFireCooldown = 0;

    updateGame(firstWave, idle, 0.01, () => 0);
    updateGame(laterWave, idle, 0.01, () => 0);

    expect(laterWave.enemyFireCooldown).toBeLessThan(firstWave.enemyFireCooldown);
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

  it("lets aliens chew through the firewall they overlap", () => {
    const state = createGameState(123);
    const shield = state.shields[1]!;
    state.enemies = [{ ...state.enemies[0]!, x: shield.x, y: shield.y }];

    erodeShieldsUnderEnemies(state);

    expect(isShieldDamagedAt(shield, shield.x, shield.y)).toBe(true);
    expect(shield.damageHoles.length).toBeGreaterThan(0);
    expect(shield.damageHoles.length).toBeLessThanOrEqual(64);
    expect(state.shieldHits.length).toBe(shield.damageHoles.length);
    for (const other of state.shields.filter((candidate) => candidate !== shield)) {
      expect(other.damageHoles).toHaveLength(0);
    }

    const holeCount = shield.damageHoles.length;
    erodeShieldsUnderEnemies(state);
    expect(shield.damageHoles.length).toBe(holeCount);
  });

  it("fast-forwards alien movement while held", () => {
    const normal = createGameState(1);
    const fast = createGameState(1);
    normal.enemyFireCooldown = fast.enemyFireCooldown = 100;
    const startX = normal.enemies[0]!.x;

    updateGame(normal, idle, 0.05);
    updateGame(fast, { ...idle, fastForward: true }, 0.05);

    const normalStep = normal.enemies[0]!.x - startX;
    expect(fast.enemies[0]!.x - startX).toBeCloseTo(normalStep * FAST_FORWARD_ENEMY_MULTIPLIER);
  });

  it("splats alien bombs on the ground in line with the A", () => {
    const state = createGameState(5);
    state.enemyFireCooldown = 100;
    state.shipX = -6;
    state.enemyShots = [{ id: 90, x: 2, y: GROUND_Y + 0.05 }];

    updateGame(state, idle, 0.05);

    expect(state.enemyShots).toHaveLength(0);
    expect(state.groundImpacts).toHaveLength(1);
    expect(state.groundImpacts[0]!.x).toBeCloseTo(2);
    expect(state.lives).toBe(3);
  });

  it("lets shots in flight finish after the game is over", () => {
    const state = createGameState(5);
    state.mode = "gameover";
    const score = state.score;
    const enemy = state.enemies[0]!;
    state.playerShots = [{ id: 91, x: enemy.x, y: enemy.y - 0.6 }];
    state.enemyShots = [{ id: 92, x: 2, y: GROUND_Y + 0.4 }];
    const enemyCount = state.enemies.length;

    for (let step = 0; step < 80; step += 1) updateAftermath(state, 0.05);

    expect(state.playerShots).toHaveLength(0);
    expect(state.enemyShots).toHaveLength(0);
    expect(state.groundImpacts).toHaveLength(1);
    expect(state.enemies).toHaveLength(enemyCount);
    expect(state.score).toBe(score);
  });

  it("starts each new game with intact shields", () => {
    const state = createGameState(123);
    damageShieldAt(state, state.shields[0]!, -5.7, -3.25);

    const restarted = createGameState(456);

    expect(restarted.level).toBe(1);
    expect(restarted.shields.every((shield) => shield.damageHoles.length === 0)).toBe(true);
    expect(restarted.damageRandomState).not.toBe(state.damageRandomState);
  });
});
