import { describe, expect, it } from "vitest";
import {
  BOMB_CANCEL_POINTS,
  chooseBombKind,
  comboMultiplier,
  createGameState as createNewGame,
  damageShieldAt,
  erodeShieldsUnderEnemies,
  EXTRA_SHIELD_SCORE,
  FAST_FORWARD_ENEMY_MULTIPLIER,
  FORMATION_INTRO_SECONDS,
  frontLineShooters,
  GROUND_Y,
  isShieldDamagedAt,
  MARCH_STEP_DISTANCE,
  MAX_COMBO_MULTIPLIER,
  MAX_PLAYER_SHOTS,
  MYSTERY_EDGE,
  MYSTERY_Y,
  PLAYER_LIMIT,
  PLAYER_Y,
  rowPoints,
  shotAccuracy,
  updateAftermath,
  updateGame,
  waveAccuracyBonus,
  waveStartDrop,
} from "./gameLogic";
import type { GameEventOf, GameEventType, GameState } from "./gameLogic";

const idle = { left: false, right: false, fire: false };

// Most scenarios exercise live combat, so skip the wave's fly-in by default.
function createGameState(seed?: number): ReturnType<typeof createNewGame> {
  const state = createNewGame(seed);
  state.formationIntro = 0;
  state.events.length = 0;
  return state;
}

/** Payloads of the queued events of one type, without the discriminator. */
function eventsOf<T extends GameEventType>(state: GameState, type: T): Omit<GameEventOf<T>, "type">[] {
  return state.events
    .filter((event): event is GameEventOf<T> => event.type === type)
    .map(({ type: _type, ...payload }) => payload);
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

    // 30 for the alien plus the perfect-accuracy wave bonus.
    expect(state.score).toBe(30 + 200);
    expect(eventsOf(state, "waveCleared")).toEqual([{ level: 1, hits: 1, shots: 1, accuracy: 1, bonus: 200 }]);
    expect(state.kills).toBe(1);
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

  it("allows only one player shot in flight at a time", () => {
    const state = createGameState();
    state.enemies = [{ ...state.enemies[0]!, x: -7, y: 4 }];
    state.enemyFireCooldown = 10;

    updateGame(state, { ...idle, fire: true }, 0.05);
    expect(state.playerShots).toHaveLength(MAX_PLAYER_SHOTS);
    for (let step = 0; step < 8; step += 1) updateGame(state, { ...idle, fire: true }, 0.05);
    expect(state.playerShots).toHaveLength(MAX_PLAYER_SHOTS);
  });

  it("only fires bombs from the lowest alien in each column", () => {
    const state = createGameState();
    const shooters = frontLineShooters(state.enemies);
    expect(shooters).toHaveLength(6);
    expect(shooters.every((enemy) => enemy.row === 2)).toBe(true);

    for (let pick = 0; pick < 6; pick += 1) {
      const trial = createGameState();
      trial.enemyFireCooldown = 0;
      updateGame(trial, idle, 0.001, () => pick / 6);
      const lowestY = Math.min(...trial.enemies.map((enemy) => enemy.y));
      expect(trial.enemyShots[0]!.y).toBeCloseTo(lowestY - 0.45);
    }

    // Once a column's bottom alien is gone, the one above takes over.
    state.enemies = state.enemies.filter((enemy) => !(enemy.column === 0 && enemy.row === 2));
    const column0 = frontLineShooters(state.enemies).find((enemy) => enemy.column === 0);
    expect(column0?.row).toBe(1);
  });

  it("scores more for higher rows", () => {
    expect(rowPoints(0)).toBe(30);
    expect(rowPoints(1)).toBe(20);
    expect(rowPoints(2)).toBe(10);
  });

  it("starts later waves lower and cycles back to the top", () => {
    expect(waveStartDrop(1)).toBe(0);
    expect(waveStartDrop(3)).toBeGreaterThan(waveStartDrop(2));
    expect(waveStartDrop(7)).toBe(0);

    const state = createGameState();
    const firstTop = Math.max(...state.enemies.map((enemy) => enemy.y));
    state.enemies = [];
    updateGame(state, idle, 0.016);
    const secondTop = Math.max(...state.enemies.map((enemy) => enemy.y));
    expect(secondTop).toBeLessThan(firstTop);
  });

  it("advances the march beat as the formation steps and drops", () => {
    const state = createGameState();
    state.enemyFireCooldown = 10;
    const distancePerUpdate = state.enemySpeed * 0.05;
    const updates = Math.ceil(MARCH_STEP_DISTANCE / distancePerUpdate);
    for (let step = 0; step < updates; step += 1) updateGame(state, idle, 0.05);
    expect(state.marchBeat).toBe(1);

    state.enemies = [{ ...state.enemies[0]!, x: 6.6, y: 2 }];
    updateGame(state, idle, 0.05);
    expect(state.marchBeat).toBe(2);
  });

  it("sends a mystery ship across the top once its timer runs out", () => {
    const state = createGameState();
    state.enemyFireCooldown = 100;
    state.mysteryTimer = 0.01;
    updateGame(state, idle, 0.05, () => 0.9);
    expect(state.mystery).toMatchObject({ x: MYSTERY_EDGE, direction: -1, points: 300 });

    for (let step = 0; step < 200 && state.mystery; step += 1) {
      state.enemyFireCooldown = 100;
      updateGame(state, idle, 0.05, () => 0.9);
    }
    expect(state.mystery).toBeNull();
    expect(state.mysteryTimer).toBeGreaterThan(0);
  });

  it("awards bonus points for shooting the mystery ship", () => {
    const state = createGameState();
    state.enemyFireCooldown = 100;
    updateGame(state, { ...idle, fire: true }, 0.01);
    const shot = state.playerShots[0]!;
    shot.y = MYSTERY_Y - 0.6;
    state.mystery = { id: 999, x: shot.x, direction: 1, points: 150 };
    const scoreBefore = state.score;
    const killsBefore = state.kills;

    updateGame(state, idle, 0.05);
    expect(state.mystery).toBeNull();
    expect(state.score).toBe(scoreBefore + 150);
    expect(state.kills).toBe(killsBefore);
    expect(state.playerShots).toHaveLength(0);
    expect(eventsOf(state, "mysteryDestroyed")).toEqual([expect.objectContaining({ points: 150, y: MYSTERY_Y })]);
  });

  it("holds the mystery ship back when only a few aliens remain", () => {
    const state = createGameState();
    state.enemies = state.enemies.slice(0, 3);
    state.enemyFireCooldown = 100;
    state.mysteryTimer = 0.01;
    updateGame(state, idle, 0.05);
    expect(state.mystery).toBeNull();
  });

  it("grants one extra shield the first time the score reaches the bonus threshold", () => {
    const state = createGameState();
    state.enemyFireCooldown = 100;
    state.score = EXTRA_SHIELD_SCORE - 1;
    updateGame(state, idle, 0.016);
    expect(state.lives).toBe(3);

    state.score = EXTRA_SHIELD_SCORE;
    updateGame(state, idle, 0.016);
    expect(state.lives).toBe(4);

    state.score = EXTRA_SHIELD_SCORE * 3;
    updateGame(state, idle, 0.016);
    expect(state.lives).toBe(4);
    expect(createNewGame().extraShieldAwarded).toBe(false);
  });

  it("clears the mystery ship when the wave is cleared", () => {
    const state = createGameState();
    state.mystery = { id: 999, x: 0, direction: 1, points: 50 };
    state.enemies = [];
    updateGame(state, idle, 0.016);
    expect(state.mystery).toBeNull();
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
    expect(eventsOf(state, "shieldHit")).toHaveLength(1);
    expect(eventsOf(state, "shieldHit")[0]).toMatchObject({ shieldId: shield.id, x: shield.x });

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
    expect(eventsOf(state, "shieldHit")).toHaveLength(1);
  });

  it("lets aliens chew through the firewall they overlap", () => {
    const state = createGameState(123);
    const shield = state.shields[1]!;
    state.enemies = [{ ...state.enemies[0]!, x: shield.x, y: shield.y }];

    erodeShieldsUnderEnemies(state);

    expect(isShieldDamagedAt(shield, shield.x, shield.y)).toBe(true);
    expect(shield.damageHoles.length).toBeGreaterThan(0);
    expect(shield.damageHoles.length).toBeLessThanOrEqual(64);
    expect(eventsOf(state, "shieldHit").length).toBe(shield.damageHoles.length);
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
    expect(eventsOf(state, "groundImpact")).toHaveLength(1);
    expect(eventsOf(state, "groundImpact")[0]!.x).toBeCloseTo(2);
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
    expect(eventsOf(state, "groundImpact")).toHaveLength(1);
    expect(state.enemies).toHaveLength(enemyCount);
    expect(state.score).toBe(score);
  });

  it("starts each new game with intact shields", () => {
    const state = createGameState(123);
    damageShieldAt(state, state.shields[0]!, -5.7, -3.25);

    const restarted = createGameState(456);

    expect(restarted.level).toBe(1);
    expect(restarted.shields.every((shield) => shield.damageHoles.length === 0)).toBe(true);
    expect(restarted.randomState).not.toBe(state.randomState);
  });

  function openSkies(seed = 3): ReturnType<typeof createGameState> {
    const state = createGameState(seed);
    // A single distant alien keeps the wave alive without getting in the way.
    state.enemies = [{ ...state.enemies[0]!, x: -6.5, y: 4 }];
    state.enemyFireCooldown = 10;
    state.mysteryTimer = 100;
    return state;
  }

  it("mixes in worm and ransomware bombs on later waves", () => {
    expect(chooseBombKind(1, 0)).toBe("malware");
    expect(chooseBombKind(2, 0.1)).toBe("worm");
    expect(chooseBombKind(2, 0.5)).toBe("malware");
    expect(chooseBombKind(3, 0.1)).toBe("ransomware");
    expect(chooseBombKind(3, 0.3)).toBe("worm");
  });

  it("weaves worm bombs around their column as they fall", () => {
    const state = openSkies();
    state.enemyShots = [{ id: 50, x: 0, y: 2, kind: "worm", originX: 0, age: 0, hp: 1 }];
    const xs: number[] = [];
    for (let step = 0; step < 20; step += 1) {
      updateGame(state, idle, 0.05);
      xs.push(state.enemyShots[0]!.x);
    }
    expect(Math.max(...xs)).toBeGreaterThan(0.2);
    expect(Math.min(...xs)).toBeLessThan(-0.2);
    expect(xs.every((x) => Math.abs(x) <= 0.46)).toBe(true);
    expect(state.enemyShots[0]!.y).toBeCloseTo(2 - 4.4);
  });

  it("lets a player shot knock a bomb out of the sky", () => {
    const state = openSkies();
    state.playerShots = [{ id: 60, x: 0, y: -1.6 }];
    state.enemyShots = [{ id: 61, x: 0.1, y: -1, kind: "malware", hp: 1 }];

    updateGame(state, idle, 0.05);

    expect(state.playerShots).toHaveLength(0);
    expect(state.enemyShots).toHaveLength(0);
    expect(state.score).toBe(BOMB_CANCEL_POINTS);
    expect(eventsOf(state, "bombCancelled")).toHaveLength(1);
    expect(eventsOf(state, "bombCancelled")[0]).toMatchObject({ kind: "malware", destroyed: true });
    expect(state.shotsMissed).toBe(0);
  });

  it("needs two shots to break an armoured ransomware bomb", () => {
    const state = openSkies();
    state.playerShots = [{ id: 70, x: 0, y: -1.6 }];
    state.enemyShots = [{ id: 71, x: 0, y: -1, kind: "ransomware", hp: 2 }];

    updateGame(state, idle, 0.05);
    expect(state.playerShots).toHaveLength(0);
    expect(state.enemyShots).toHaveLength(1);
    expect(eventsOf(state, "bombCancelled")[0]).toMatchObject({ kind: "ransomware", destroyed: false });
    expect(state.score).toBe(0);

    const bomb = state.enemyShots[0]!;
    state.playerShots = [{ id: 72, x: bomb.x, y: bomb.y - 0.6 }];
    updateGame(state, idle, 0.05);
    expect(state.enemyShots).toHaveLength(0);
    expect(eventsOf(state, "bombCancelled")[1]).toMatchObject({ destroyed: true });
    expect(state.score).toBe(BOMB_CANCEL_POINTS);
  });

  it("multiplies alien points by the hit streak and resets it on a miss", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(4)).toBe(1);
    expect(comboMultiplier(5)).toBe(2);
    expect(comboMultiplier(10)).toBe(3);
    expect(comboMultiplier(99)).toBe(MAX_COMBO_MULTIPLIER);

    const state = openSkies();
    const target = { ...state.enemies[0]!, id: 900, row: 0, x: 0, y: -1 };
    state.enemies.push(target);
    state.combo = 4;
    state.playerShots = [{ id: 80, x: 0, y: -1.3 }];

    updateGame(state, idle, 0.05);
    expect(state.combo).toBe(5);
    expect(state.bestCombo).toBe(5);
    expect(state.score).toBe(rowPoints(0) * 2);

    state.playerShots = [{ id: 81, x: 0, y: 7.9 }];
    updateGame(state, idle, 0.05);
    expect(state.combo).toBe(0);
    expect(state.bestCombo).toBe(5);
    expect(state.shotsMissed).toBe(1);
  });

  it("scales the wave-secured bonus with accuracy", () => {
    expect(waveAccuracyBonus(1)).toBe(200);
    expect(waveAccuracyBonus(0.5)).toBe(100);
    expect(waveAccuracyBonus(0)).toBe(0);
    expect(shotAccuracy(3, 1)).toBe(0.75);
    expect(shotAccuracy(0, 0)).toBe(0);

    const state = openSkies();
    state.enemies = [];
    state.waveHits = 3;
    state.waveMisses = 1;
    updateGame(state, idle, 0.016);

    expect(eventsOf(state, "waveCleared")).toEqual([{ level: 1, hits: 3, shots: 4, accuracy: 0.75, bonus: 150 }]);
    expect(state.score).toBe(150);
    expect(state.waveHits).toBe(0);
    expect(state.waveMisses).toBe(0);
  });

  it("replays the same run from the same seed and inputs", () => {
    const play = (seed: number) => {
      const state = createNewGame(seed);
      for (let step = 0; step < 240 * 20; step += 1) {
        const phase = Math.floor(step / 300) % 3;
        updateGame(state, { left: phase === 0, right: phase === 2, fire: step % 40 === 0 }, 1 / 240);
        state.events.length = 0;
      }
      return state;
    };
    const first = play(42);
    const second = play(42);
    const other = play(43);

    expect(second).toEqual(first);
    expect(first.enemyShots.length + first.nextProjectileId).toBeGreaterThan(0);
    expect(other.randomState).not.toBe(first.randomState);
  });

  it("announces the opening fly-in and reports combat as events", () => {
    expect(createNewGame(1).events).toEqual([{ type: "formationIncoming", level: 1 }]);

    const state = openSkies();
    state.enemies[0]!.x = 0;
    state.enemies[0]!.y = -2;
    updateGame(state, { ...idle, fire: true }, 0.05);
    for (let step = 0; step < 5; step += 1) updateGame(state, idle, 0.05);

    const types = state.events.map((event) => event.type);
    expect(types).toEqual(["playerFired", "alienDestroyed", "waveCleared", "formationIncoming"]);
    expect(eventsOf(state, "alienDestroyed")[0]).toMatchObject({ row: 0, points: rowPoints(0) });
  });

  it("raises events for streak steps, lost shields and game over", () => {
    const state = openSkies();
    state.combo = 4;
    state.enemies[0]!.x = 0;
    state.enemies[0]!.y = -2;
    state.enemies.push({ ...state.enemies[0]!, id: 99, x: 6.5, y: 4 });
    updateGame(state, { ...idle, fire: true }, 0.05);
    for (let step = 0; step < 5; step += 1) updateGame(state, idle, 0.05);
    expect(eventsOf(state, "comboUp")).toEqual([{ multiplier: 2 }]);

    state.events.length = 0;
    state.lives = 1;
    state.enemyShots = [{ id: 500, x: state.shipX, y: PLAYER_Y }];
    updateGame(state, idle, 0.016);
    expect(state.events.map((event) => event.type)).toEqual(["playerHit", "gameOver"]);
    expect(state.mode).toBe("gameover");
  });
});
