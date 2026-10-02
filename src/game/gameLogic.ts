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

export interface Projectile {
  id: number;
  x: number;
  y: number;
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

export type GameMode = "playing" | "gameover";

export interface GameState {
  mode: GameMode;
  level: number;
  shipX: number;
  enemies: Enemy[];
  shields: Shield[];
  shieldHits: ShieldHit[];
  groundImpacts: GroundImpact[];
  playerShots: Projectile[];
  enemyShots: Projectile[];
  score: number;
  lives: number;
  enemyDirection: 1 | -1;
  enemySpeed: number;
  playerFireCooldown: number;
  enemyFireCooldown: number;
  invulnerability: number;
  nextProjectileId: number;
  damageRandomState: number;
  /** Seconds left while a fresh wave flies into formation; aliens are inert meanwhile. */
  formationIntro: number;
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
const PLAYER_SHOT_SPEED = 13;
const ENEMY_SHOT_SPEED = 5.5;
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

function createEnemies(level: number): Enemy[] {
  return Array.from({ length: ENEMY_ROWS * ENEMY_COLUMNS }, (_, index) => {
    const row = Math.floor(index / ENEMY_COLUMNS);
    const column = index % ENEMY_COLUMNS;

    return {
      id: (level - 1) * ENEMY_ROWS * ENEMY_COLUMNS + index,
      row,
      column,
      modelIndex: ((level - 1) * ENEMY_ROWS + row) % ALIEN_VARIANT_COUNT,
      x: ENEMY_START_X + column * ENEMY_SPACING_X,
      y: ENEMY_START_Y - row * ENEMY_SPACING_Y,
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

export function createGameState(seed = Math.floor(Math.random() * 0xffffffff)): GameState {
  const level = 1;
  return {
    mode: "playing",
    level,
    shipX: 0,
    enemies: createEnemies(level),
    shields: createShields(),
    shieldHits: [],
    groundImpacts: [],
    playerShots: [],
    enemyShots: [],
    score: 0,
    lives: 3,
    enemyDirection: 1,
    enemySpeed: 1.15,
    playerFireCooldown: 0,
    enemyFireCooldown: 1.1,
    invulnerability: 0,
    nextProjectileId: 0,
    damageRandomState: seed >>> 0 || 1,
    formationIntro: FORMATION_INTRO_SECONDS,
  };
}

function nextDamageRandom(state: GameState): number {
  let value = state.damageRandomState;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.damageRandomState = value >>> 0 || 1;
  return state.damageRandomState / 0x1_0000_0000;
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

  addShieldHole(state, shield, x, y, 0.52 + nextDamageRandom(state) * 0.12);
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
    seed: nextDamageRandom(state) * 1000,
  });
  updateShieldDestruction(shield);
  state.shieldHits.push({
    shieldId: shield.id,
    x,
    y,
    seed: nextDamageRandom(state) * 0xffffffff,
  });
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

function resetEnemyFormation(state: GameState): void {
  state.enemies = createEnemies(state.level);
  state.enemyDirection = 1;
  state.playerShots = [];
  state.enemyShots = [];
  state.formationIntro = FORMATION_INTRO_SECONDS;
}

function loseLife(state: GameState): void {
  state.lives = Math.max(0, state.lives - 1);
  if (state.lives === 0) {
    state.mode = "gameover";
  }
}

function spawnPlayerShot(state: GameState): void {
  state.playerShots.push({
    id: state.nextProjectileId++,
    x: state.shipX,
    y: PLAYER_Y + PLAYER_MUZZLE_OFFSET,
  });
  state.playerFireCooldown = 0.28;
}

function spawnEnemyShot(state: GameState, random: () => number): void {
  const shooter = state.enemies[Math.floor(random() * state.enemies.length)];
  if (!shooter) return;

  state.enemyShots.push({
    id: state.nextProjectileId++,
    x: shooter.x,
    y: shooter.y - 0.45,
  });
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
    state.groundImpacts.push({ x: shot.x, seed: nextDamageRandom(state) * 0xffffffff });
    return false;
  });
}

/**
 * After the game ends, shots already in flight keep travelling until they leave the play area,
 * hit a firewall, or splat on the ground. Nothing scores and nothing can be hit.
 */
export function updateAftermath(state: GameState, deltaSeconds: number): void {
  if (state.mode === "playing" || deltaSeconds <= 0) return;
  if (state.playerShots.length === 0 && state.enemyShots.length === 0) return;

  const delta = Math.min(deltaSeconds, 0.05);
  const previousPlayerY = new Map(state.playerShots.map((shot) => [shot.id, shot.y]));
  const previousEnemyY = new Map(state.enemyShots.map((shot) => [shot.id, shot.y]));
  for (const shot of state.playerShots) shot.y += PLAYER_SHOT_SPEED * delta;
  for (const shot of state.enemyShots) shot.y -= ENEMY_SHOT_SPEED * delta;

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
  random: () => number = Math.random,
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

  if (input.fire && state.playerFireCooldown === 0) {
    spawnPlayerShot(state);
    const newShot = state.playerShots[state.playerShots.length - 1]!;
    previousPlayerY.set(newShot.id, newShot.y);
  }

  for (const shot of state.playerShots) shot.y += PLAYER_SHOT_SPEED * delta;
  for (const shot of state.enemyShots) shot.y -= ENEMY_SHOT_SPEED * delta;

  state.playerShots = absorbShotsAtShields(state, state.playerShots, previousPlayerY, 1);
  state.enemyShots = absorbShotsAtShields(state, state.enemyShots, previousEnemyY, -1);

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
    } else {
      const enemyTimeScale = input.fastForward ? FAST_FORWARD_ENEMY_MULTIPLIER : 1;
      const advance = state.enemyDirection * state.enemySpeed * delta * enemyTimeScale;
      for (const enemy of state.enemies) enemy.x += advance;
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
      state.score += 10;
    }
  }
  if (hitEnemyIds.size > 0) {
    state.enemies = state.enemies.filter((enemy) => !hitEnemyIds.has(enemy.id));
    state.enemySpeed = Math.min(4.5, state.enemySpeed + hitEnemyIds.size * 0.045);
  }
  state.playerShots = state.playerShots.filter(
    (shot) => !consumedPlayerShotIds.has(shot.id) && shot.y < PLAYER_SHOT_EXIT_Y,
  );

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
    loseLife(state);
    if (state.mode === "playing") resetEnemyFormation(state);
    return;
  }

  if (state.enemies.length === 0) {
    state.level += 1;
    state.enemies = createEnemies(state.level);
    state.enemyDirection = 1;
    state.enemySpeed = Math.min(4.5, 1.15 * 1.14 ** (state.level - 1));
    state.enemyFireCooldown = Math.max(0.7, 1.1 - (state.level - 1) * 0.07);
    state.playerShots = [];
    state.enemyShots = [];
    state.formationIntro = FORMATION_INTRO_SECONDS;
  }

  if (state.enemyFireCooldown <= 0) {
    spawnEnemyShot(state, random);
  }
}
