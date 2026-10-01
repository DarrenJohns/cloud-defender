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

export type GameMode = "playing" | "won" | "gameover";

export interface GameState {
  mode: GameMode;
  shipX: number;
  enemies: Enemy[];
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

export function createGameState(): GameState {
  return {
    mode: "playing",
    shipX: 0,
    enemies: createEnemies(),
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
  };
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

  if (input.fire && state.playerFireCooldown === 0) {
    spawnPlayerShot(state);
  }

  for (const shot of state.playerShots) shot.y += PLAYER_SHOT_SPEED * delta;
  for (const shot of state.enemyShots) shot.y -= ENEMY_SHOT_SPEED * delta;

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
