export const WORLD_WIDTH = 16;
export const PLAYER_Y = -5.7;
// Floor level the A hovers above; its shadow and bomb impacts sit here.
export const GROUND_Y = PLAYER_Y - 1;
// Height above PLAYER_Y of the A's apex, where player shots emerge.
export const PLAYER_MUZZLE_OFFSET = 0.6;
export const PLAYER_LIMIT = 7.25;
export const ALIEN_VARIANT_COUNT = 10;

export interface Enemy {
  id: number;
  row: number;
  column: number;
  modelIndex: number;
  x: number;
  y: number;
}

export type BombKind = "malware" | "worm" | "ransomware";

export interface Projectile {
  id: number;
  x: number;
  y: number;
  /** Enemy bombs only; missing means the basic malware cube. */
  kind?: BombKind;
  /** Column a worm bomb weaves around. */
  originX?: number;
  age?: number;
  /** Player shots a bomb can absorb before it breaks; ransomware is armoured. */
  hp?: number;
}

/** A player shot meeting an alien bomb in mid-air. */
export interface BombCancel {
  x: number;
  y: number;
  kind: BombKind;
  /** False when an armoured bomb only cracked. */
  destroyed: boolean;
  seed: number;
}

export interface WaveClear {
  level: number;
  hits: number;
  shots: number;
  accuracy: number;
  bonus: number;
}

export interface DamageHole {
  x: number;
  y: number;
  radius: number;
  seed: number;
}

export interface Shield {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  damageHoles: DamageHole[];
  destroyed: boolean;
}

export interface ShieldHit {
  shieldId: number;
  x: number;
  y: number;
  seed: number;
}

export interface GroundImpact {
  x: number;
  seed: number;
}

/** The bonus "zero-day" ship that occasionally crosses above the formation. */
export interface MysteryShip {
  id: number;
  x: number;
  direction: 1 | -1;
  points: number;
}

export interface MysteryHit {
  x: number;
  y: number;
  points: number;
  seed: number;
}

export type GameMode = "playing" | "gameover";

/**
 * Things that happened during a simulation step. The logic appends them to `GameState.events`;
 * the host drains the queue and routes each one to audio, HUD and visual effects.
 */
export type GameEvent =
  | { type: "playerFired"; id: number; x: number }
  | { type: "bombDropped"; id: number; kind: BombKind; x: number; y: number }
  | { type: "alienDestroyed"; id: number; row: number; x: number; y: number; points: number }
  | { type: "playerHit"; lives: number }
  | { type: "extraShield"; lives: number }
  | ({ type: "shieldHit" } & ShieldHit)
  | ({ type: "groundImpact" } & GroundImpact)
  | ({ type: "mysteryDestroyed" } & MysteryHit)
  | { type: "mysteryAppeared"; id: number }
  | { type: "firewallDestroyed"; shieldId: number }
  | ({ type: "bombCancelled" } & BombCancel)
  | { type: "comboUp"; multiplier: number }
  | ({ type: "waveCleared" } & WaveClear)
  /** A formation starts flying in: a new game or a new wave. */
  | { type: "formationIncoming"; level: number }
  | { type: "marchBeat"; beat: number }
  | { type: "gameOver"; score: number; seed: number };

export type GameEventType = GameEvent["type"];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

export interface GameState {
  mode: GameMode;
  level: number;
  shipX: number;
  enemies: Enemy[];
  shields: Shield[];
  playerShots: Projectile[];
  enemyShots: Projectile[];
  score: number;
  /** Aliens destroyed this game; tracked separately because points vary by row. */
  kills: number;
  lives: number;
  enemyDirection: 1 | -1;
  enemySpeed: number;
  playerFireCooldown: number;
  enemyFireCooldown: number;
  invulnerability: number;
  nextProjectileId: number;
  /** Seed the game was created with, so a run can be replayed. */
  seed: number;
  /** Xorshift state behind every random choice the simulation makes. */
  randomState: number;
  /** Seconds left while a fresh wave flies into formation; aliens are inert meanwhile. */
  formationIntro: number;
  /** Counts formation march steps; audio and visuals pulse on each new beat. */
  marchBeat: number;
  /** Distance travelled since the last march beat. */
  marchDistance: number;
  mystery: MysteryShip | null;
  /** Seconds until the next mystery ship may appear. */
  mysteryTimer: number;
  /** Next score milestone; milestones reached at full shields are not banked. */
  nextShieldScore: number;
  /** Consecutive hits without a miss; drives the score multiplier. */
  combo: number;
  bestCombo: number;
  shotsHit: number;
  shotsMissed: number;
  waveHits: number;
  waveMisses: number;
  /** Events raised since the host last drained the queue. */
  events: GameEvent[];
}

export interface GameInput {
  left: boolean;
  right: boolean;
  fire: boolean;
  fastForward?: boolean;
}

export const FAST_FORWARD_ENEMY_MULTIPLIER = 4;
export const FORMATION_INTRO_SECONDS = 2.8;

const ENEMY_ROWS = 3;
const ENEMY_COLUMNS = 6;
const ENEMY_START_X = -4.75;
const ENEMY_START_Y = 4.15;
const ENEMY_SPACING_X = 1.9;
const ENEMY_SPACING_Y = 1.15;
const ENEMY_EDGE = 7;
const ENEMY_BOTTOM = -5.1;
const PLAYER_SPEED = 8;
const PLAYER_SHOT_SPEED = 16;
/** Classic rule: only this many player shots may be in flight at once. */
export const MAX_PLAYER_SHOTS = 1;
/** Horizontal distance the formation covers per march beat. */
export const MARCH_STEP_DISTANCE = 0.5;
const WAVE_DROP_STEP = 0.3;
const WAVE_DROP_CYCLE = 6;
export const MYSTERY_Y = 5.75;
/** The ship enters and leaves beyond the play field so it never pops in over the formation. */
export const MYSTERY_EDGE = 10.5;
const MYSTERY_SPEED = 3.4;
const MYSTERY_HALF_WIDTH = 0.85;
const MYSTERY_HALF_HEIGHT = 0.4;
export const MYSTERY_POINTS = [50, 100, 150, 300] as const;
const MYSTERY_MIN_DELAY = 16;
const MYSTERY_DELAY_RANGE = 10;
// Like the arcade, the bonus ship stops visiting once the wave is nearly cleared.
const MYSTERY_MIN_ENEMIES = 4;
export const MAX_SHIELDS = 3;
/** Restore a lost shield (life) at each multiple of this score, up to MAX_SHIELDS. */
export const EXTRA_SHIELD_SCORE = 1500;
const ENEMY_SHOT_SPEED = 5.5;
const BOMB_SPEEDS: Record<BombKind, number> = { malware: ENEMY_SHOT_SPEED, worm: 4.4, ransomware: 7 };
export const WORM_AMPLITUDE = 0.45;
export const WORM_FREQUENCY = 7;
const BOMB_CANCEL_RADIUS = 0.3;
const BOMB_CANCEL_REACH = 0.25;
export const BOMB_CANCEL_POINTS = 10;
const COMBO_STEP = 5;
export const MAX_COMBO_MULTIPLIER = 4;
export const SHIELD_WIDTH = 2.18;
export const SHIELD_HEIGHT = 1.02;
export const SHIELD_Y = -3.25;
const SHIELD_POSITIONS = [-5.7, -1.9, 1.9, 5.7];
const MAX_DAMAGE_HOLES = 64;
const ENEMY_HALF_WIDTH = 0.48;
const ENEMY_HALF_HEIGHT = 0.4;
const ENEMY_EROSION_STEP = 0.35;
const ENEMY_EROSION_RADIUS = 0.32;
const SHIELD_COVERAGE_COLUMNS = 32;
const SHIELD_COVERAGE_ROWS = 16;
const SHIELD_DESTROYED_COVERAGE = 0.86;

/** Points for destroying an alien: the top row is worth most, the bottom row least. */
export function rowPoints(row: number): number {
  return (ENEMY_ROWS - Math.max(0, Math.min(ENEMY_ROWS - 1, row))) * 10;
}

/** Each wave starts a little lower than the last, cycling back to the top every few waves. */
export function waveStartDrop(level: number): number {
  return ((Math.max(1, level) - 1) % WAVE_DROP_CYCLE) * WAVE_DROP_STEP;
}

function createEnemies(level: number): Enemy[] {
  const startY = ENEMY_START_Y - waveStartDrop(level);
  return Array.from({ length: ENEMY_ROWS * ENEMY_COLUMNS }, (_, index) => {
    const row = Math.floor(index / ENEMY_COLUMNS);
    const column = index % ENEMY_COLUMNS;

    return {
      id: (level - 1) * ENEMY_ROWS * ENEMY_COLUMNS + index,
      row,
      column,
      modelIndex: ((level - 1) * ENEMY_ROWS + row) % ALIEN_VARIANT_COUNT,
      x: ENEMY_START_X + column * ENEMY_SPACING_X,
      y: startY - row * ENEMY_SPACING_Y,
    };
  });
}

function createShields(): Shield[] {
  return SHIELD_POSITIONS.map((x, id) => ({
    id,
    x,
    y: SHIELD_Y,
    width: SHIELD_WIDTH,
    height: SHIELD_HEIGHT,
    damageHoles: [],
    destroyed: false,
  }));
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function createGameState(seed = randomSeed()): GameState {
  const level = 1;
  return {
    mode: "playing",
    level,
    shipX: 0,
    enemies: createEnemies(level),
    shields: createShields(),
    playerShots: [],
    enemyShots: [],
    score: 0,
    kills: 0,
    lives: MAX_SHIELDS,
    enemyDirection: 1,
    enemySpeed: 1.15,
    playerFireCooldown: 0,
    enemyFireCooldown: 1.1,
    invulnerability: 0,
    nextProjectileId: 0,
    seed: seed >>> 0,
    randomState: seed >>> 0 || 1,
    formationIntro: FORMATION_INTRO_SECONDS,
    marchBeat: 0,
    marchDistance: 0,
    mystery: null,
    mysteryTimer: MYSTERY_MIN_DELAY,
    nextShieldScore: EXTRA_SHIELD_SCORE,
    combo: 0,
    bestCombo: 0,
    shotsHit: 0,
    shotsMissed: 0,
    waveHits: 0,
    waveMisses: 0,
    events: [{ type: "formationIncoming", level }],
  };
}

/** Deterministic random number in [0, 1) drawn from the game's own seeded stream. */
export function nextRandom(state: GameState): number {
  let value = state.randomState;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.randomState = value >>> 0 || 1;
  return state.randomState / 0x1_0000_0000;
}

function emit(state: GameState, event: GameEvent): void {
  state.events.push(event);
}

export function isShieldDamagedAt(shield: Shield, x: number, y: number): boolean {
  if (shield.destroyed) return true;
  const localX = x - shield.x;
  const localY = y - shield.y;
  return shield.damageHoles.some((hole) => {
    const offsetX = localX - hole.x;
    const offsetY = localY - hole.y;
    const angle = Math.atan2(offsetY, offsetX);
    const edge =
      hole.radius *
      (0.8 +
        0.14 * Math.sin(angle * 2 + hole.seed) +
        0.08 * Math.sin(angle * 4 - hole.seed * 1.31) +
        0.025 * Math.sin(angle * 7 + hole.seed * 2.1));
    return Math.hypot(offsetX, offsetY) < edge;
  });
}

function shieldDamagedFraction(shield: Shield): number {
  let damagedCells = 0;
  const totalCells = SHIELD_COVERAGE_COLUMNS * SHIELD_COVERAGE_ROWS;
  for (let row = 0; row < SHIELD_COVERAGE_ROWS; row += 1) {
    const y = shield.y - shield.height / 2 + ((row + 0.5) / SHIELD_COVERAGE_ROWS) * shield.height;
    for (let column = 0; column < SHIELD_COVERAGE_COLUMNS; column += 1) {
      const x =
        shield.x - shield.width / 2 + ((column + 0.5) / SHIELD_COVERAGE_COLUMNS) * shield.width;
      if (isShieldDamagedAt(shield, x, y)) damagedCells += 1;
    }
  }
  return damagedCells / totalCells;
}

function updateShieldDestruction(shield: Shield): void {
  shield.destroyed = shieldDamagedFraction(shield) >= SHIELD_DESTROYED_COVERAGE;
}

export function damageShieldAt(
  state: GameState,
  shield: Shield,
  x: number,
  y: number,
): boolean {
  if (shield.destroyed) return false;
  if (
    x < shield.x - shield.width / 2 ||
    x > shield.x + shield.width / 2 ||
    y < shield.y - shield.height / 2 ||
    y > shield.y + shield.height / 2 ||
    isShieldDamagedAt(shield, x, y)
  ) {
    return false;
  }

  addShieldHole(state, shield, x, y, 0.52 + nextRandom(state) * 0.12);
  return true;
}

function addShieldHole(
  state: GameState,
  shield: Shield,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (shield.damageHoles.length >= MAX_DAMAGE_HOLES) return false;
  shield.damageHoles.push({
    x: x - shield.x,
    y: y - shield.y,
    radius,
    seed: nextRandom(state) * 1000,
  });
  const wasDestroyed = shield.destroyed;
  updateShieldDestruction(shield);
  emit(state, {
    type: "shieldHit",
    shieldId: shield.id,
    x,
    y,
    seed: nextRandom(state) * 0xffffffff,
  });
  if (!wasDestroyed && shield.destroyed) emit(state, { type: "firewallDestroyed", shieldId: shield.id });
  return true;
}

export function erodeShieldsUnderEnemies(state: GameState): void {
  for (const enemy of state.enemies) {
    const enemyLeft = enemy.x - ENEMY_HALF_WIDTH;
    const enemyRight = enemy.x + ENEMY_HALF_WIDTH;
    const enemyBottom = enemy.y - ENEMY_HALF_HEIGHT;
    const enemyTop = enemy.y + ENEMY_HALF_HEIGHT;
    for (const shield of state.shields) {
      if (shield.destroyed) continue;
      const left = Math.max(enemyLeft, shield.x - shield.width / 2);
      const right = Math.min(enemyRight, shield.x + shield.width / 2);
      const bottom = Math.max(enemyBottom, shield.y - shield.height / 2);
      const top = Math.min(enemyTop, shield.y + shield.height / 2);
      if (left >= right || bottom >= top) continue;

      const columns = Math.max(1, Math.ceil((right - left) / ENEMY_EROSION_STEP));
      const rows = Math.max(1, Math.ceil((top - bottom) / ENEMY_EROSION_STEP));
      for (let row = 0; row < rows; row += 1) {
        const y = bottom + ((row + 0.5) / rows) * (top - bottom);
        for (let column = 0; column < columns; column += 1) {
          const x = left + ((column + 0.5) / columns) * (right - left);
          if (shield.destroyed || isShieldDamagedAt(shield, x, y)) continue;
          if (!addShieldHole(state, shield, x, y, ENEMY_EROSION_RADIUS)) break;
        }
      }
    }
  }
}

function nextMysteryDelay(random: () => number): number {
  return MYSTERY_MIN_DELAY + random() * MYSTERY_DELAY_RANGE;
}

function moveMystery(state: GameState, delta: number): void {
  const ship = state.mystery;
  if (!ship) return;
  ship.x += ship.direction * MYSTERY_SPEED * delta;
  if (Math.abs(ship.x) > MYSTERY_EDGE) state.mystery = null;
}

function updateMystery(state: GameState, delta: number, random: () => number): void {
  if (state.mystery) {
    moveMystery(state, delta);
    return;
  }
  if (state.enemies.length < MYSTERY_MIN_ENEMIES) return;
  state.mysteryTimer -= delta;
  if (state.mysteryTimer > 0) return;
  const direction: 1 | -1 = random() < 0.5 ? 1 : -1;
  state.mystery = {
    id: state.nextProjectileId++,
    x: -direction * MYSTERY_EDGE,
    direction,
    points: MYSTERY_POINTS[Math.floor(random() * MYSTERY_POINTS.length)] ?? MYSTERY_POINTS[0],
  };
  state.mysteryTimer = nextMysteryDelay(random);
  emit(state, { type: "mysteryAppeared", id: state.mystery.id });
}

function hitsMystery(ship: MysteryShip, shot: Projectile, startY: number): boolean {
  const lowY = Math.min(startY, shot.y);
  const highY = Math.max(startY, shot.y);
  return (
    Math.abs(shot.x - ship.x) < MYSTERY_HALF_WIDTH &&
    highY >= MYSTERY_Y - MYSTERY_HALF_HEIGHT &&
    lowY <= MYSTERY_Y + MYSTERY_HALF_HEIGHT
  );
}

function loseLife(state: GameState, damage = 1): void {
  state.lives = Math.max(0, state.lives - damage);
  state.combo = 0;
  emit(state, { type: "playerHit", lives: state.lives });
  if (state.lives === 0) {
    state.mode = "gameover";
    emit(state, { type: "gameOver", score: state.score, seed: nextRandom(state) * 0xffffffff });
  }
}

/** Score multiplier for the current hit streak: x2 at 5 hits, x3 at 10, capped at x4. */
export function comboMultiplier(combo: number): number {
  return Math.min(MAX_COMBO_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / COMBO_STEP));
}

/** End-of-wave bonus: up to 200 points for perfect accuracy, in steps of 10. */
export function waveAccuracyBonus(accuracy: number): number {
  return Math.round(Math.max(0, Math.min(1, accuracy)) * 20) * 10;
}

/** Accuracy over all resolved shots (cancelled bombs count as neither). */
export function shotAccuracy(hits: number, misses: number): number {
  return hits + misses > 0 ? hits / (hits + misses) : 0;
}

function recordHit(state: GameState): void {
  const multiplierBefore = comboMultiplier(state.combo);
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.shotsHit += 1;
  state.waveHits += 1;
  const multiplier = comboMultiplier(state.combo);
  if (multiplier > multiplierBefore) emit(state, { type: "comboUp", multiplier });
}

function recordMisses(state: GameState, count: number): void {
  if (count <= 0) return;
  state.combo = 0;
  state.shotsMissed += count;
  state.waveMisses += count;
}

/** Later waves mix in weaving worms and armoured, faster ransomware. */
export function chooseBombKind(level: number, roll: number): BombKind {
  if (level >= 3 && roll < 0.15) return "ransomware";
  if (level >= 2 && roll < 0.4) return "worm";
  return "malware";
}

function moveBomb(bomb: Projectile, delta: number): void {
  const kind = bomb.kind ?? "malware";
  bomb.age = (bomb.age ?? 0) + delta;
  bomb.y -= BOMB_SPEEDS[kind] * delta;
  if (kind === "worm") {
    bomb.x = (bomb.originX ?? bomb.x) + Math.sin(bomb.age * WORM_FREQUENCY) * WORM_AMPLITUDE;
  }
}

/** Player shots that meet a bomb head-on knock it out of the sky (ransomware takes two). */
function cancelBombs(
  state: GameState,
  previousPlayerY: Map<number, number>,
  previousEnemyY: Map<number, number>,
): void {
  if (state.playerShots.length === 0 || state.enemyShots.length === 0) return;
  const spentShots = new Set<number>();
  const destroyedBombs = new Set<number>();
  for (const shot of state.playerShots) {
    const shotStart = previousPlayerY.get(shot.id) ?? shot.y;
    for (const bomb of state.enemyShots) {
      if (destroyedBombs.has(bomb.id)) continue;
      const bombStart = previousEnemyY.get(bomb.id) ?? bomb.y;
      if (Math.abs(bomb.x - shot.x) > BOMB_CANCEL_RADIUS) continue;
      // They meet if the shot started below the bomb and has now reached it.
      if (shotStart > bombStart + BOMB_CANCEL_REACH || shot.y < bomb.y - BOMB_CANCEL_REACH) continue;
      spentShots.add(shot.id);
      bomb.hp = (bomb.hp ?? 1) - 1;
      const destroyed = bomb.hp <= 0;
      if (destroyed) {
        destroyedBombs.add(bomb.id);
        state.score += BOMB_CANCEL_POINTS;
      }
      emit(state, {
        type: "bombCancelled",
        x: bomb.x,
        y: (bomb.y + shot.y) / 2,
        kind: bomb.kind ?? "malware",
        destroyed,
        seed: nextRandom(state) * 0xffffffff,
      });
      break;
    }
  }
  if (spentShots.size === 0) return;
  state.playerShots = state.playerShots.filter((shot) => !spentShots.has(shot.id));
  state.enemyShots = state.enemyShots.filter((bomb) => !destroyedBombs.has(bomb.id));
}

function spawnPlayerShot(state: GameState): void {
  const shot = {
    id: state.nextProjectileId++,
    x: state.shipX,
    y: PLAYER_Y + PLAYER_MUZZLE_OFFSET,
  };
  state.playerShots.push(shot);
  state.playerFireCooldown = 0.28;
  emit(state, { type: "playerFired", id: shot.id, x: shot.x });
}

/** The lowest alien in each column; only these have a clear line of fire. */
export function frontLineShooters(enemies: readonly Enemy[]): Enemy[] {
  const lowestByColumn = new Map<number, Enemy>();
  for (const enemy of enemies) {
    const current = lowestByColumn.get(enemy.column);
    if (!current || enemy.y < current.y) lowestByColumn.set(enemy.column, enemy);
  }
  return [...lowestByColumn.values()];
}

function spawnEnemyShot(state: GameState, random: () => number): void {
  const shooters = frontLineShooters(state.enemies);
  const shooter = shooters[Math.floor(random() * shooters.length)];
  if (!shooter) return;

  const kind = chooseBombKind(state.level, random());
  const bomb: Projectile = {
    id: state.nextProjectileId++,
    x: shooter.x,
    y: shooter.y - 0.45,
    kind,
    originX: shooter.x,
    age: 0,
    hp: kind === "ransomware" ? 2 : 1,
  };
  state.enemyShots.push(bomb);
  emit(state, { type: "bombDropped", id: bomb.id, kind, x: bomb.x, y: bomb.y });
  const fireRate = Math.min(2.2, 1 + (state.level - 1) * 0.12);
  state.enemyFireCooldown = (1.25 + random() * 0.65) / fireRate;
}

const PLAYER_SHOT_EXIT_Y = 8;

function absorbShotsAtShields(
  state: GameState,
  shots: Projectile[],
  previousY: Map<number, number>,
  direction: 1 | -1,
): Projectile[] {
  return shots.filter((shot) => {
    const startY = previousY.get(shot.id) ?? shot.y;
    const lowY = Math.min(startY, shot.y);
    const highY = Math.max(startY, shot.y);
    for (const shield of state.shields) {
      const shieldLowY = shield.y - shield.height / 2;
      const shieldHighY = shield.y + shield.height / 2;
      const crossesShield =
        shot.x >= shield.x - shield.width / 2 &&
        shot.x <= shield.x + shield.width / 2 &&
        highY >= shieldLowY &&
        lowY <= shieldHighY;
      if (!crossesShield) continue;

      const impactStart = Math.max(lowY, shieldLowY);
      const impactEnd = Math.min(highY, shieldHighY);
      const steps = Math.max(1, Math.ceil((impactEnd - impactStart) / 0.025));
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        const impactY =
          direction === 1
            ? impactStart + (impactEnd - impactStart) * progress
            : impactEnd - (impactEnd - impactStart) * progress;
        if (isShieldDamagedAt(shield, shot.x, impactY)) continue;
        if (damageShieldAt(state, shield, shot.x, impactY)) return false;
      }
    }
    return true;
  });
}

function landEnemyShots(state: GameState, shots: Projectile[]): Projectile[] {
  return shots.filter((shot) => {
    if (shot.y > GROUND_Y) return true;
    emit(state, { type: "groundImpact", x: shot.x, seed: nextRandom(state) * 0xffffffff });
    return false;
  });
}

/**
 * After the game ends, shots already in flight keep travelling until they leave the play area,
 * hit a firewall, or splat on the ground. Nothing scores and nothing can be hit.
 */
export function updateAftermath(state: GameState, deltaSeconds: number): void {
  if (state.mode === "playing" || deltaSeconds <= 0) return;
  const delta = Math.min(deltaSeconds, 0.05);
  // An escaping mystery ship finishes its pass rather than freezing in the sky.
  moveMystery(state, delta);
  if (state.playerShots.length === 0 && state.enemyShots.length === 0) return;

  const previousPlayerY = new Map(state.playerShots.map((shot) => [shot.id, shot.y]));
  const previousEnemyY = new Map(state.enemyShots.map((shot) => [shot.id, shot.y]));
  for (const shot of state.playerShots) shot.y += PLAYER_SHOT_SPEED * delta;
  for (const shot of state.enemyShots) moveBomb(shot, delta);

  state.playerShots = absorbShotsAtShields(state, state.playerShots, previousPlayerY, 1).filter(
    (shot) => shot.y < PLAYER_SHOT_EXIT_Y,
  );
  state.enemyShots = landEnemyShots(
    state,
    absorbShotsAtShields(state, state.enemyShots, previousEnemyY, -1),
  );
}

export function updateGame(
  state: GameState,
  input: GameInput,
  deltaSeconds: number,
  random: () => number = () => nextRandom(state),
): void {
  if (state.mode !== "playing" || deltaSeconds <= 0) return;

  const delta = Math.min(deltaSeconds, 0.05);
  const movement = Number(input.right) - Number(input.left);
  state.shipX = Math.max(
    -PLAYER_LIMIT,
    Math.min(PLAYER_LIMIT, state.shipX + movement * PLAYER_SPEED * delta),
  );
  state.playerFireCooldown = Math.max(0, state.playerFireCooldown - delta);
  state.invulnerability = Math.max(0, state.invulnerability - delta);

  if (state.formationIntro > 0) {
    // The wave is still flying in: the player can line up, but nobody fires and the formation holds.
    state.formationIntro = Math.max(0, state.formationIntro - delta);
    return;
  }
  state.enemyFireCooldown -= delta;

  const previousPlayerY = new Map(state.playerShots.map((shot) => [shot.id, shot.y]));
  const previousEnemyY = new Map(state.enemyShots.map((shot) => [shot.id, shot.y]));

  if (
    input.fire &&
    state.playerFireCooldown === 0 &&
    state.playerShots.length < MAX_PLAYER_SHOTS
  ) {
    spawnPlayerShot(state);
    const newShot = state.playerShots[state.playerShots.length - 1]!;
    previousPlayerY.set(newShot.id, newShot.y);
  }

  for (const shot of state.playerShots) shot.y += PLAYER_SHOT_SPEED * delta;
  for (const shot of state.enemyShots) moveBomb(shot, delta);

  const shotsBeforeShields = state.playerShots.length;
  state.playerShots = absorbShotsAtShields(state, state.playerShots, previousPlayerY, 1);
  recordMisses(state, shotsBeforeShields - state.playerShots.length);
  state.enemyShots = absorbShotsAtShields(state, state.enemyShots, previousEnemyY, -1);
  cancelBombs(state, previousPlayerY, previousEnemyY);

  if (state.enemies.length > 0) {
    const nextEdge = state.enemies.reduce(
      (edge, enemy) =>
        state.enemyDirection === 1
          ? Math.max(edge, enemy.x + 0.48)
          : Math.min(edge, enemy.x - 0.48),
      state.enemyDirection === 1 ? -Infinity : Infinity,
    );
    const reachedEdge =
      state.enemyDirection === 1 ? nextEdge >= ENEMY_EDGE : nextEdge <= -ENEMY_EDGE;

    if (reachedEdge) {
      state.enemyDirection = state.enemyDirection === 1 ? -1 : 1;
      for (const enemy of state.enemies) enemy.y -= 0.28;
      // The drop is a step of its own, so the march lands on it.
      state.marchBeat += 1;
      state.marchDistance = 0;
      emit(state, { type: "marchBeat", beat: state.marchBeat });
    } else {
      const enemyTimeScale = input.fastForward ? FAST_FORWARD_ENEMY_MULTIPLIER : 1;
      const advance = state.enemyDirection * state.enemySpeed * delta * enemyTimeScale;
      for (const enemy of state.enemies) enemy.x += advance;
      state.marchDistance += Math.abs(advance);
      while (state.marchDistance >= MARCH_STEP_DISTANCE) {
        state.marchDistance -= MARCH_STEP_DISTANCE;
        state.marchBeat += 1;
        emit(state, { type: "marchBeat", beat: state.marchBeat });
      }
    }
    erodeShieldsUnderEnemies(state);
  }

  const hitEnemyIds = new Set<number>();
  const consumedPlayerShotIds = new Set<number>();
  for (const shot of state.playerShots) {
    const hitEnemy = state.enemies.find(
      (enemy) =>
        !hitEnemyIds.has(enemy.id) &&
        Math.abs(enemy.x - shot.x) < 0.55 &&
        Math.abs(enemy.y - shot.y) < 0.55,
    );
    if (hitEnemy) {
      hitEnemyIds.add(hitEnemy.id);
      consumedPlayerShotIds.add(shot.id);
      recordHit(state);
      const points = rowPoints(hitEnemy.row) * comboMultiplier(state.combo);
      state.score += points;
      state.kills += 1;
      emit(state, {
        type: "alienDestroyed",
        id: hitEnemy.id,
        row: hitEnemy.row,
        x: hitEnemy.x,
        y: hitEnemy.y,
        points,
      });
    }
  }
  if (hitEnemyIds.size > 0) {
    state.enemies = state.enemies.filter((enemy) => !hitEnemyIds.has(enemy.id));
    state.enemySpeed = Math.min(4.5, state.enemySpeed + hitEnemyIds.size * 0.045);
  }
  state.playerShots = state.playerShots.filter((shot) => !consumedPlayerShotIds.has(shot.id));

  updateMystery(state, delta, random);
  const mystery = state.mystery;
  if (mystery) {
    const shot = state.playerShots.find((candidate) =>
      hitsMystery(mystery, candidate, previousPlayerY.get(candidate.id) ?? candidate.y),
    );
    if (shot) {
      state.playerShots = state.playerShots.filter((candidate) => candidate !== shot);
      recordHit(state);
      state.score += mystery.points;
      emit(state, {
        type: "mysteryDestroyed",
        x: mystery.x,
        y: MYSTERY_Y,
        points: mystery.points,
        seed: nextRandom(state) * 0xffffffff,
      });
      state.mystery = null;
    }
  }

  // Checked after the mystery ship so a shot can still score on its way past the formation.
  const shotsInFlight = state.playerShots.length;
  state.playerShots = state.playerShots.filter((shot) => shot.y < PLAYER_SHOT_EXIT_Y);
  recordMisses(state, shotsInFlight - state.playerShots.length);

  if (state.invulnerability === 0) {
    const hitShotIndex = state.enemyShots.findIndex(
      (shot) => Math.abs(shot.x - state.shipX) < 0.48 && Math.abs(shot.y - PLAYER_Y) < 0.5,
    );
    if (hitShotIndex !== -1) {
      state.enemyShots.splice(hitShotIndex, 1);
      loseLife(state);
      state.invulnerability = 1.25;
    }
  }
  state.enemyShots = landEnemyShots(state, state.enemyShots);

  if (state.mode !== "playing") return;

  if (state.enemies.some((enemy) => enemy.y <= ENEMY_BOTTOM)) {
    loseLife(state, state.lives);
    return;
  }

  if (state.enemies.length === 0) {
    const accuracy = shotAccuracy(state.waveHits, state.waveMisses);
    const bonus = waveAccuracyBonus(accuracy);
    state.score += bonus;
    emit(state, {
      type: "waveCleared",
      level: state.level,
      hits: state.waveHits,
      shots: state.waveHits + state.waveMisses,
      accuracy,
      bonus,
    });
    state.waveHits = 0;
    state.waveMisses = 0;
    state.level += 1;
    state.enemies = createEnemies(state.level);
    state.enemyDirection = 1;
    state.enemySpeed = Math.min(4.5, 1.15 * 1.14 ** (state.level - 1));
    state.enemyFireCooldown = Math.max(0.7, 1.1 - (state.level - 1) * 0.07);
    state.playerShots = [];
    state.enemyShots = [];
    state.formationIntro = FORMATION_INTRO_SECONDS;
    state.marchDistance = 0;
    state.mystery = null;
    emit(state, { type: "formationIncoming", level: state.level });
  }

  while (state.score >= state.nextShieldScore) {
    state.nextShieldScore += EXTRA_SHIELD_SCORE;
    if (state.lives < MAX_SHIELDS) {
      state.lives += 1;
      emit(state, { type: "extraShield", lives: state.lives });
    }
  }

  if (state.enemyFireCooldown <= 0) {
    spawnEnemyShot(state, random);
  }
}
