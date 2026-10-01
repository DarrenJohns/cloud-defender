export const WORLD_WIDTH = 16;
export const PLAYER_Y = -5.7;
export const PLAYER_LIMIT = 7.25;

export interface Enemy {
  id: number;
  row: number;
  column: number;
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

export type GameMode = "playing" | "won" | "gameover";

export interface GameState {
  mode: GameMode;
  shipX: number;
  enemies: Enemy[];
  shields: Shield[];
  shieldHits: ShieldHit[];
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
}

export interface GameInput {
  left: boolean;
  right: boolean;
  fire: boolean;
}

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
const SHIELD_COVERAGE_COLUMNS = 32;
const SHIELD_COVERAGE_ROWS = 16;
const SHIELD_DESTROYED_COVERAGE = 0.86;

function createEnemies(): Enemy[] {
  return Array.from({ length: ENEMY_ROWS * ENEMY_COLUMNS }, (_, index) => {
    const row = Math.floor(index / ENEMY_COLUMNS);
    const column = index % ENEMY_COLUMNS;

    return {
      id: index,
      row,
      column,
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
  return {
    mode: "playing",
    shipX: 0,
    enemies: createEnemies(),
    shields: createShields(),
    shieldHits: [],
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

function updateShieldDestruction(shield: Shield): void {
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
  shield.destroyed = damagedCells / totalCells >= SHIELD_DESTROYED_COVERAGE;
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

  const addHole = (holeX: number, holeY: number, radius: number): void => {
    if (shield.damageHoles.length >= MAX_DAMAGE_HOLES) return;
    shield.damageHoles.push({
      x: holeX,
      y: holeY,
      radius,
      seed: nextDamageRandom(state) * 1000,
    });
  };

  const centerX = x - shield.x;
  const centerY = y - shield.y;
  addHole(centerX, centerY, 0.52 + nextDamageRandom(state) * 0.12);
  updateShieldDestruction(shield);
  state.shieldHits.push({
    shieldId: shield.id,
    x,
    y,
    seed: nextDamageRandom(state) * 0xffffffff,
  });
  return true;
}

function resetEnemyFormation(state: GameState): void {
  state.enemies = createEnemies();
  state.enemyDirection = 1;
  state.playerShots = [];
  state.enemyShots = [];
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
    y: PLAYER_Y + 0.45,
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
  state.enemyFireCooldown = 1.25 + random() * 0.65;
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
  state.enemyFireCooldown -= delta;
  state.invulnerability = Math.max(0, state.invulnerability - delta);

  const previousPlayerY = new Map(state.playerShots.map((shot) => [shot.id, shot.y]));
  const previousEnemyY = new Map(state.enemyShots.map((shot) => [shot.id, shot.y]));

  if (input.fire && state.playerFireCooldown === 0) {
    spawnPlayerShot(state);
    const newShot = state.playerShots[state.playerShots.length - 1]!;
    previousPlayerY.set(newShot.id, newShot.y);
  }

  for (const shot of state.playerShots) shot.y += PLAYER_SHOT_SPEED * delta;
  for (const shot of state.enemyShots) shot.y -= ENEMY_SHOT_SPEED * delta;

  const absorbShotsAtShields = (
    shots: Projectile[],
    previousY: Map<number, number>,
    direction: 1 | -1,
  ): Projectile[] =>
    shots.filter((shot) => {
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

  state.playerShots = absorbShotsAtShields(state.playerShots, previousPlayerY, 1);
  state.enemyShots = absorbShotsAtShields(state.enemyShots, previousEnemyY, -1);

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
      const advance = state.enemyDirection * state.enemySpeed * delta;
      for (const enemy of state.enemies) enemy.x += advance;
    }
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
    state.enemySpeed += hitEnemyIds.size * 0.045;
  }
  state.playerShots = state.playerShots.filter(
    (shot) => !consumedPlayerShotIds.has(shot.id) && shot.y < 8,
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
  state.enemyShots = state.enemyShots.filter((shot) => shot.y > -8);

  if (state.mode !== "playing") return;

  if (state.enemies.some((enemy) => enemy.y <= ENEMY_BOTTOM)) {
    loseLife(state);
    if (state.mode === "playing") resetEnemyFormation(state);
    return;
  }

  if (state.enemies.length === 0) {
    state.mode = "won";
    return;
  }

  if (state.enemyFireCooldown <= 0) {
    spawnEnemyShot(state, random);
  }
}
