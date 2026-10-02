import "./style.css";
import { GameScene } from "./game/gameScene";
import { GameAudio } from "./game/audio";
import { FAST_FORWARD_ENEMY_MULTIPLIER, createGameState, updateAftermath, updateGame } from "./game/gameLogic";
import type { GameInput, GameMode } from "./game/gameLogic";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing required page element: #${id}`);
  return element as T;
}

const container = requiredElement<HTMLDivElement>("game");
const assetNotice = requiredElement<HTMLElement>("asset-notice");
const assetErrorMessage = requiredElement<HTMLSpanElement>("asset-error-message");
const levelElement = requiredElement<HTMLElement>("level");
const scoreElement = requiredElement<HTMLElement>("score");
const livesElement = requiredElement<HTMLElement>("lives");
const pauseButton = requiredElement<HTMLButtonElement>("pause-button");
const hudRestartButton = requiredElement<HTMLButtonElement>("hud-restart-button");
const pauseButtonLabel = requiredElement<HTMLSpanElement>("pause-button-label");
const muteButton = requiredElement<HTMLButtonElement>("mute-button");
const muteButtonLabel = requiredElement<HTMLSpanElement>("mute-button-label");
const pausePanel = requiredElement<HTMLElement>("pause-panel");
const resumeButton = requiredElement<HTMLButtonElement>("resume-button");
const pauseRestartButton = requiredElement<HTMLButtonElement>("pause-restart-button");
const pauseScore = requiredElement<HTMLElement>("pause-score");
const pauseLevel = requiredElement<HTMLElement>("pause-level");
const pauseLives = requiredElement<HTMLElement>("pause-lives");
const endPanel = requiredElement<HTMLElement>("end-panel");
const endScore = requiredElement<HTMLElement>("end-score");
const endLevel = requiredElement<HTMLElement>("end-level");
const endKills = requiredElement<HTMLElement>("end-kills");
const endBest = requiredElement<HTMLElement>("end-best");
const endBestScore = requiredElement<HTMLElement>("end-best-score");
const restartButton = requiredElement<HTMLButtonElement>("restart-button");
const splash = requiredElement<HTMLElement>("splash");
const splashPrompt = requiredElement<HTMLElement>("splash-prompt");
const gameScene = new GameScene(container);
let state = createGameState();
let shipReady = false;
let aliensReady = false;
let shieldsReady = false;
let cloudsReady = false;
let paused = false;
// The title screen gates every new game; the simulation waits until it is dismissed.
let splashVisible = true;
let splashHideTimer: number | undefined;
// Visual clock that keeps running after game over so idle hover and smoke stay alive.
let sceneSeconds = 0;
const keys = new Set<string>();
const input: GameInput = { left: false, right: false, fire: false };

const MUTED_KEY = "cloud-defender.muted";

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

const audio = new GameAudio(readMuted());
// Highest projectile ids already heard, so each new shot plays its sound exactly once.
let heardPlayerShotId = -1;
let heardEnemyShotId = -1;
let heardMode: GameMode = "playing";

function setMuted(muted: boolean): void {
  audio.unlock();
  audio.setMuted(muted);
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); mute still applies for this visit.
  }
  setMuteButtonState(muted);
}

function setMuteButtonState(muted: boolean): void {
  muteButton.dataset.state = muted ? "muted" : "sound";
  muteButtonLabel.textContent = muted ? "Unmute" : "Mute";
  muteButton.dataset.tip = muted ? "Unmute · M" : "Mute · M";
  muteButton.setAttribute("aria-label", muted ? "Unmute (M)" : "Mute (M)");
}

function resetAudioTracking(): void {
  heardPlayerShotId = -1;
  heardEnemyShotId = -1;
  heardMode = state.mode;
  audio.resetMarch();
}

function newestShotId(shots: readonly { id: number }[], heard: number): number {
  return shots.reduce((newest, shot) => Math.max(newest, shot.id), heard);
}

function playStateSounds(before: { enemies: number; level: number; lives: number }, aftermath: boolean): void {
  const playerShotId = newestShotId(state.playerShots, heardPlayerShotId);
  if (playerShotId > heardPlayerShotId) audio.playerFire();
  heardPlayerShotId = playerShotId;
  const enemyShotId = newestShotId(state.enemyShots, heardEnemyShotId);
  if (enemyShotId > heardEnemyShotId) audio.alienFire();
  heardEnemyShotId = enemyShotId;

  if (state.level !== before.level) {
    audio.alienDestroyed(Math.max(1, before.enemies));
    audio.waveCleared();
    audio.formationFlyIn();
  } else if (state.enemies.length < before.enemies) {
    audio.alienDestroyed(before.enemies - state.enemies.length);
  }
  if (state.lives < before.lives) audio.playerHit();
  if (state.shieldHits.length > 0) audio.firewallHit(aftermath);
  if (state.groundImpacts.length > 0) audio.groundHit(aftermath);
}

function updateInput(): void {
  input.left = keys.has("ArrowLeft") || keys.has("KeyA");
  input.right = keys.has("ArrowRight") || keys.has("KeyD");
  input.fire = keys.has("Space");
  input.fastForward = keys.has("KeyF");
}

function showMode(mode: GameMode): void {
  const ended = mode !== "playing";
  const wasHidden = endPanel.hidden;
  endPanel.hidden = !ended || !gameScene.isPlayerDeathComplete;
  if (wasHidden && !endPanel.hidden) fillEndPanel();
  pauseButton.disabled = ended || paused || splashVisible || !assetsReady();
}

const BEST_SCORE_KEY = "cloud-defender.best-score";

function readBestScore(): number {
  try {
    return Number(window.localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function fillEndPanel(): void {
  const previousBest = readBestScore();
  const isNewBest = state.score > previousBest;
  if (isNewBest) {
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(state.score));
    } catch {
      // Storage can be unavailable (private mode); the panel still shows this run.
    }
  }
  endScore.textContent = String(state.score).padStart(5, "0");
  endLevel.textContent = String(state.level).padStart(2, "0");
  endKills.textContent = String(Math.round(state.score / 10));
  endBest.classList.toggle("is-new", isNewBest);
  endBest.firstChild!.textContent = isNewBest ? "New best" : "Best";
  endBestScore.textContent = String(Math.max(previousBest, state.score)).padStart(5, "0");
}

function updateSplashPrompt(): void {
  const ready = assetsReady();
  splash.classList.toggle("is-ready", ready);
  splashPrompt.textContent = ready ? "Press Enter, Space or click to start" : "Loading…";
}

function showSplash(): void {
  window.clearTimeout(splashHideTimer);
  splashVisible = true;
  splash.hidden = false;
  splash.classList.remove("is-leaving");
  updateSplashPrompt();
}

function dismissSplash(): void {
  if (!splashVisible || !assetsReady()) return;
  splashVisible = false;
  keys.clear();
  updateInput();
  audio.unlock();
  resetAudioTracking();
  audio.formationFlyIn();
  splash.classList.add("is-leaving");
  // The aliens start their fly-in while the title fades away.
  splashHideTimer = window.setTimeout(() => {
    splash.hidden = true;
  }, 450);
  updateHud();
}

function assetsReady(): boolean {
  return shipReady && aliensReady && shieldsReady && cloudsReady;
}

function updateHud(): void {
  levelElement.textContent = String(state.level).padStart(2, "0");
  scoreElement.textContent = String(state.score).padStart(5, "0");
  livesElement.textContent = String(state.lives);
  showMode(state.mode);
}

function onAssetsReady(): void {
  if (!assetsReady()) return;
  assetNotice.hidden = true;
  pauseButton.disabled = false;
  hudRestartButton.disabled = false;
  updateSplashPrompt();
  updateHud();
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "KeyM") {
    if (!event.repeat) setMuted(!audio.isMuted);
    return;
  }
  audio.unlock();
  if (splashVisible) {
    if (!event.repeat && ["Enter", "Space"].includes(event.code)) dismissSplash();
    return;
  }
  if (event.repeat && ["Enter", "KeyP", "KeyR", "KeyT"].includes(event.code)) return;
  if (event.code === "KeyP" && assetsReady() && state.mode === "playing") {
    setPaused(!paused);
    return;
  }
  if (event.code === "KeyT" && assetsReady()) {
    if (state.mode === "gameover") restart(false);
    paused = false;
    keys.clear();
    updateInput();
    pausePanel.hidden = true;
    state.mode = "gameover";
    updateHud();
    return;
  }
  if (event.code === "KeyR" && assetsReady()) {
    restart();
    return;
  }
  if (paused) return;
  keys.add(event.code);
  updateInput();
  if (event.code === "Enter" && state.mode !== "playing" && assetsReady()) restart();
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  updateInput();
});
window.addEventListener("blur", () => {
  keys.clear();
  updateInput();
});

function restart(withSplash = true): void {
  if (!assetsReady()) return;
  gameScene.resetForRestart();
  state = createGameState();
  paused = false;
  audio.setPaused(false);
  resetAudioTracking();
  keys.clear();
  updateInput();
  pausePanel.hidden = true;
  setPauseButtonState(false);
  if (withSplash) showSplash();
  updateHud();
}

restartButton.addEventListener("click", () => restart());
hudRestartButton.addEventListener("click", () => restart());
splash.addEventListener("click", dismissSplash);
pauseButton.addEventListener("click", () => setPaused(!paused));
resumeButton.addEventListener("click", () => setPaused(false));
pauseRestartButton.addEventListener("click", () => restart());
muteButton.addEventListener("click", () => setMuted(!audio.isMuted));
window.addEventListener("pointerdown", () => audio.unlock());
setMuteButtonState(audio.isMuted);

function setPaused(value: boolean): void {
  if (state.mode !== "playing" || splashVisible || !assetsReady()) return;
  paused = value;
  audio.setPaused(paused);
  keys.clear();
  updateInput();
  pausePanel.hidden = !paused;
  if (paused) {
    pauseScore.textContent = String(state.score).padStart(5, "0");
    pauseLevel.textContent = String(state.level).padStart(2, "0");
    pauseLives.textContent = String(state.lives);
  }
  setPauseButtonState(paused);
  pauseButton.disabled = false;
}

function setPauseButtonState(isPaused: boolean): void {
  pauseButton.dataset.state = isPaused ? "paused" : "playing";
  pauseButtonLabel.textContent = isPaused ? "Resume" : "Pause";
  pauseButton.dataset.tip = isPaused ? "Resume · P" : "Pause · P";
  pauseButton.setAttribute("aria-label", isPaused ? "Resume (P)" : "Pause (P)");
}

gameScene.loadShip(
  () => {
    shipReady = true;
    onAssetsReady();
  },
  (message) => {
    assetErrorMessage.textContent = message;
    assetNotice.hidden = false;
  },
);
gameScene.loadAliens(
  () => {
    aliensReady = true;
    onAssetsReady();
  },
  (message) => {
    assetErrorMessage.textContent = message;
    assetNotice.hidden = false;
  },
);
gameScene.loadShields(
  () => {
    shieldsReady = true;
    onAssetsReady();
  },
  (message) => {
    assetErrorMessage.textContent = message;
    assetNotice.hidden = false;
  },
);
gameScene.loadClouds(
  () => {
    cloudsReady = true;
    onAssetsReady();
  },
  (message) => {
    assetErrorMessage.textContent = message;
    assetNotice.hidden = false;
  },
);

let lastTime = performance.now();
function animate(now: number): void {
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const before = { enemies: state.enemies.length, level: state.level, lives: state.lives };
  if (assetsReady() && state.mode === "playing" && !paused && !splashVisible) {
    updateGame(state, input, deltaSeconds);
    playStateSounds(before, false);
    if (state.mode === "playing" && state.formationIntro === 0 && state.enemies.length > 0) {
      const speed = state.enemySpeed * (input.fastForward ? FAST_FORWARD_ENEMY_MULTIPLIER : 1);
      audio.updateMarch(deltaSeconds, state.enemies.length, speed);
    } else {
      audio.resetMarch();
    }
    updateHud();
  } else if (assetsReady() && state.mode !== "playing" && !paused) {
    updateAftermath(state, deltaSeconds);
    playStateSounds(before, true);
  }
  if (state.mode === "gameover" && heardMode === "playing") audio.gameOver();
  heardMode = state.mode;
  if (!paused) sceneSeconds += deltaSeconds;
  gameScene.update(state, paused ? 0 : deltaSeconds, sceneSeconds);
  if (state.mode === "gameover") updateHud();
  gameScene.render();
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
window.addEventListener("pagehide", () => gameScene.dispose(), { once: true });
