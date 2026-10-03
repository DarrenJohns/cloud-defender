import "./style.css";
import { GameScene } from "./game/gameScene";
import { GameAudio } from "./game/audio";
import { waveLine } from "./game/announcer";
import { comboMultiplier, createGameState, MAX_SHIELDS, shotAccuracy, updateAftermath, updateGame } from "./game/gameLogic";
import { ShieldAward } from "./game/scene/shieldAward";
import type { GameEvent, GameInput, GameMode, WaveClear } from "./game/gameLogic";

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
const shieldIconUrl = `${import.meta.env.BASE_URL}favicon.png`;
let shownLives = -1;
let shieldBonusPending = false;
const comboElement = requiredElement<HTMLElement>("combo");
const comboMultiplierElement = requiredElement<HTMLElement>("combo-multiplier");
const waveBanner = requiredElement<HTMLElement>("wave-banner");
const waveBannerLevel = requiredElement<HTMLElement>("wave-banner-level");
const waveBannerAccuracy = requiredElement<HTMLElement>("wave-banner-accuracy");
const waveBannerHits = requiredElement<HTMLElement>("wave-banner-hits");
const waveBannerBonus = requiredElement<HTMLElement>("wave-banner-bonus");
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
const endAccuracy = requiredElement<HTMLElement>("end-accuracy");
const endBest = requiredElement<HTMLElement>("end-best");
const endBestScore = requiredElement<HTMLElement>("end-best-score");
const restartButton = requiredElement<HTMLButtonElement>("restart-button");
const splash = requiredElement<HTMLElement>("splash");
const splashPrompt = requiredElement<HTMLElement>("splash-prompt");
const gameScene = new GameScene(container);
// ?seed=1234 replays the same run: every random choice the simulation makes comes from this seed.
const seedParam = Number.parseInt(new URLSearchParams(window.location.search).get("seed") ?? "", 10);
const fixedSeed = Number.isFinite(seedParam) ? seedParam >>> 0 : undefined;
let state = createGameState(fixedSeed);
let shipReady = false;
let aliensReady = false;
let shieldsReady = false;
let cloudsReady = false;
let awardReady = false;
let paused = false;
// The title screen gates every new game; the simulation waits until it is dismissed.
let splashVisible = true;
let splashHideTimer: number | undefined;
// Visual clock that keeps running after game over so idle hover and smoke stay alive.
let sceneSeconds = 0;
// The simulation advances in fixed steps so it plays the same at any frame rate.
const FIXED_STEP_SECONDS = 1 / 240;
// Longest frame we try to catch up on; anything slower runs in slow motion instead of jumping.
const MAX_FRAME_SECONDS = 0.1;
let stepAccumulator = 0;
const WAVE_BANNER_SECONDS = 3;
const WAVE_BANNER_EXIT_SECONDS = 0.4;
// Real-time breather between waves; manual pause and shield rewards hold the countdown.
let waveBannerSeconds = 0;
let pendingFormationLevel: number | null = null;
const keys = new Set<string>();
const input: GameInput = { left: false, right: false, fire: false };
const CURSOR_IDLE_SECONDS = 2;
let cursorIdleSeconds = 0;

function showCursor(): void {
  cursorIdleSeconds = 0;
  document.body.classList.remove("cursor-idle");
}

window.addEventListener("pointermove", showCursor);
window.addEventListener("pointerdown", showCursor);
window.addEventListener("blur", showCursor);

const MUTED_KEY = "cloud-defender.muted";

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

const audio = new GameAudio(readMuted());
const shieldAward = new ShieldAward(() => {
  awardReady = true;
  onAssetsReady();
}, (message) => {
  assetErrorMessage.textContent = message;
  assetNotice.hidden = false;
});

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

function replayClass(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

/**
 * Routes simulation events to audio, the HUD and the 3D scene. Events from the aftermath (shots
 * still landing after game over) play quieter impact sounds.
 */
function handleGameEvents(events: readonly GameEvent[], aftermath: boolean): void {
  if (events.length === 0) return;
  let aliensDestroyed = 0;
  let firewallHit = false;
  let groundHit = false;
  for (const event of events) {
    switch (event.type) {
      case "playerFired":
        audio.playerFire();
        break;
      case "bombDropped":
        audio.alienFire();
        break;
      case "alienDestroyed":
        aliensDestroyed += 1;
        break;
      case "playerHit":
        audio.playerHit();
        if (!aftermath && event.lives > 0) audio.announce(event.lives === 1 ? "last-shield" : "shield-lost");
        break;
      case "extraShield":
        shieldBonusPending = true;
        break;
      case "shieldHit":
        firewallHit = true;
        break;
      case "groundImpact":
        groundHit = true;
        break;
      case "mysteryAppeared":
        audio.announce("zero-day");
        break;
      case "firewallDestroyed":
        audio.firewallDestroyed(aftermath);
        if (!aftermath) audio.announce("firewall-lost");
        break;
      case "mysteryDestroyed":
        audio.mysteryDestroyed();
        break;
      case "bombCancelled":
        audio.bombCancelled(event.destroyed);
        break;
      case "comboUp":
        audio.comboUp(event.multiplier);
        replayClass(comboElement, "is-up");
        break;
      case "waveCleared":
        audio.waveSecured();
        audio.announce("wave-secured");
        showWaveBanner(event);
        break;
      case "formationIncoming":
        audio.resetMarch();
        if (!waveBanner.hidden) {
          pendingFormationLevel = event.level;
        } else {
          audio.formationFlyIn();
          audio.announce(waveLine(event.level));
        }
        break;
      case "marchBeat":
        audio.marchNote();
        break;
      case "gameOver":
        audio.gameOver();
        audio.announce("game-over");
        break;
    }
  }
  // Simultaneous kills and impacts share one sound rather than stacking.
  if (aliensDestroyed > 0) audio.alienDestroyed(aliensDestroyed);
  if (firewallHit) audio.firewallHit(aftermath);
  if (groundHit) audio.groundHit(aftermath);
  gameScene.handleEvents(events);
  if (shieldBonusPending && !aftermath) beginShieldAward();
}

function beginShieldAward(): void {
  renderShieldIcons(state.lives);
  shieldBonusPending = false;
  const icons = livesElement.querySelectorAll<HTMLImageElement>("img:not(.is-lost)");
  const target = icons[icons.length - 1];
  if (!target) throw new Error("Missing HUD shield for acquisition sequence.");
  target.classList.add("is-arriving");
  shieldAward.start(target);
  keys.clear();
  updateInput();
  audio.stopVoice();
  audio.extraShield();
  audio.announce("extra-shield");
  updateHud();
}

function clearShieldAward(): void {
  shieldAward.clear();
  livesElement.querySelectorAll(".is-arriving").forEach((icon) => icon.classList.remove("is-arriving"));
}
function formatAccuracy(accuracy: number): string {
  return `${Math.round(accuracy * 100)}%`;
}

function showWaveBanner(clear: WaveClear): void {
  waveBannerLevel.textContent = String(clear.level).padStart(2, "0");
  waveBannerAccuracy.textContent = clear.shots > 0 ? formatAccuracy(clear.accuracy) : "--";
  waveBannerHits.textContent = `${clear.hits}/${clear.shots}`;
  waveBannerBonus.textContent = `+${clear.bonus}`;
  waveBanner.classList.remove("is-leaving");
  waveBanner.hidden = false;
  waveBannerSeconds = WAVE_BANNER_SECONDS;
  document.body.classList.add("wave-intermission");
  keys.clear();
  updateInput();
}

function updateWaveBanner(deltaSeconds: number): void {
  if (waveBanner.hidden) return;
  waveBannerSeconds -= deltaSeconds;
  if (waveBannerSeconds <= 0) {
    const level = pendingFormationLevel;
    hideWaveBanner();
    if (level !== null) {
      audio.formationFlyIn();
      audio.announce(waveLine(level));
    }
  } else if (waveBannerSeconds <= WAVE_BANNER_EXIT_SECONDS) {
    waveBanner.classList.add("is-leaving");
  }
}

function hideWaveBanner(): void {
  waveBannerSeconds = 0;
  waveBanner.hidden = true;
  waveBanner.classList.remove("is-leaving");
  document.body.classList.remove("wave-intermission");
  pendingFormationLevel = null;
}

function updateInput(): void {
  input.left = keys.has("ArrowLeft") || keys.has("KeyA");
  input.right = keys.has("ArrowRight") || keys.has("KeyD");
  input.fire = keys.has("Space");
  input.fastForward = keys.has("KeyF");
}

function showMode(mode: GameMode): void {
  const ended = mode !== "playing";
  if (ended && !waveBanner.hidden) hideWaveBanner();
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
  endKills.textContent = String(state.kills);
  endAccuracy.textContent = formatAccuracy(shotAccuracy(state.shotsHit, state.shotsMissed));
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
  audio.announceWhenAllowed("splash-screen");
}

function dismissSplash(): void {
  if (!splashVisible || !assetsReady()) return;
  splashVisible = false;
  keys.clear();
  updateInput();
  audio.unlock();
  stepAccumulator = 0;
  splash.classList.add("is-leaving");
  // The aliens start their fly-in while the title fades away.
  splashHideTimer = window.setTimeout(() => {
    splash.hidden = true;
  }, 450);
  updateHud();
}

function assetsReady(): boolean {
  return shipReady && aliensReady && shieldsReady && cloudsReady && awardReady;
}

function renderShieldIcons(lives: number): void {
  if (lives === shownLives) {
    return;
  }
  const icons = Array.from(livesElement.querySelectorAll<HTMLImageElement>("img:not(.is-lost)"));
  for (let i = icons.length; i < lives; i += 1) {
    const icon = document.createElement("img");
    icon.src = shieldIconUrl;
    icon.alt = "";
    icon.draggable = false;
    if (shieldBonusPending) {
      icon.classList.add("is-arriving");
    }
    livesElement.append(icon);
  }
  for (let i = icons.length - 1; i >= lives; i -= 1) {
    const icon = icons[i];
    if (shownLives < 0) {
      icon.remove();
      continue;
    }
    icon.classList.add("is-lost");
    gameScene.burstHudShield(icon.getBoundingClientRect());
    window.setTimeout(() => icon.remove(), 1100);
  }
  shieldBonusPending = false;
  shownLives = lives;
  livesElement.dataset.lives = String(lives);
  livesElement.setAttribute("aria-label", `${lives} shield${lives === 1 ? "" : "s"}`);
}

function updateHud(): void {
  levelElement.textContent = String(state.level).padStart(2, "0");
  scoreElement.textContent = String(state.score).padStart(5, "0");
  renderShieldIcons(state.lives);
  const multiplier = comboMultiplier(state.combo);
  comboElement.classList.toggle("is-active", multiplier > 1 && state.mode === "playing");
  comboMultiplierElement.textContent = `×${Math.max(2, multiplier)}`;
  showMode(state.mode);
  // Exposed for styling hooks and end-to-end tests.
  document.body.dataset.game = splashVisible ? "splash" : paused ? "paused" : shieldAward.active ? "shield-award" : !waveBanner.hidden ? "wave-intermission" : state.mode;
  if (splashVisible || paused || !waveBanner.hidden || state.mode !== "playing") showCursor();
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
  if (event.repeat && ["Enter", "KeyP", "KeyR", "KeyT", "KeyS"].includes(event.code)) return;
  if (event.code === "KeyS" && assetsReady() && state.mode === "playing" && !paused && !shieldAward.active) {
    state.lives = Math.min(MAX_SHIELDS, state.lives + 1);
    shieldBonusPending = true;
    beginShieldAward();
    return;
  }
  if (event.code === "KeyP" && assetsReady() && state.mode === "playing") {
    setPaused(!paused);
    return;
  }
  if (event.code === "KeyT" && assetsReady()) {
    clearShieldAward();
    if (state.mode === "gameover") restart(false);
    paused = false;
    keys.clear();
    updateInput();
    pausePanel.hidden = true;
    state.events.length = 0;
    state.mode = "gameover";
    audio.gameOver();
    updateHud();
    return;
  }
  if (event.code === "KeyR" && assetsReady()) {
    restart();
    return;
  }
  if (paused || shieldAward.active) return;
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
// Switching tabs or minimising pauses the game rather than letting it run unattended.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});

function restart(withSplash = true): void {
  if (!assetsReady()) return;
  shieldBonusPending = false;
  gameScene.resetForRestart();
  clearShieldAward();
  audio.stopVoice();
  state = createGameState(fixedSeed);
  paused = false;
  stepAccumulator = 0;
  audio.setPaused(false);
  audio.resetMarch();
  keys.clear();
  updateInput();
  pausePanel.hidden = true;
  hideWaveBanner();
  comboElement.classList.remove("is-up");
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
  updateHud();
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
  const frameSeconds = Math.min(Math.max(0, now - lastTime) / 1000, MAX_FRAME_SECONDS);
  lastTime = now;
  if (assetsReady() && !paused && !splashVisible && waveBanner.hidden && state.mode === "playing") {
    cursorIdleSeconds += frameSeconds;
    document.body.classList.toggle("cursor-idle", cursorIdleSeconds >= CURSOR_IDLE_SECONDS);
  } else {
    showCursor();
  }

  const betweenWaves = !waveBanner.hidden;
  if (betweenWaves && !paused && !splashVisible && !shieldAward.active) {
    updateWaveBanner(frameSeconds);
  }
  const simulating = assetsReady() && !paused && !splashVisible && !shieldAward.active && !betweenWaves;
  if (simulating) {
    stepAccumulator += frameSeconds;
    const liveEvents: GameEvent[] = [];
    const aftermathEvents: GameEvent[] = [];
    while (stepAccumulator >= FIXED_STEP_SECONDS) {
      stepAccumulator -= FIXED_STEP_SECONDS;
      if (state.mode === "playing") {
        updateGame(state, input, FIXED_STEP_SECONDS);
        liveEvents.push(...state.events.splice(0));
        if (liveEvents.some((event) => event.type === "extraShield" || event.type === "waveCleared")) break;
      } else {
        updateAftermath(state, FIXED_STEP_SECONDS);
        aftermathEvents.push(...state.events.splice(0));
      }
    }
    handleGameEvents(liveEvents, false);
    handleGameEvents(aftermathEvents, true);
    updateHud();
  } else {
    stepAccumulator = 0;
  }
  audio.mysteryHum(state.mystery !== null && state.mode === "playing" && simulating);
  if (shieldAward.update(paused ? 0 : frameSeconds)) {
    clearShieldAward();
    livesElement.querySelectorAll("img:not(.is-lost)").forEach((icon) => replayClass(icon as HTMLElement, "is-new"));
    updateHud();
  }
  const frozen = paused || shieldAward.active || !waveBanner.hidden;
  if (!frozen) sceneSeconds += frameSeconds;
  gameScene.update(state, frozen ? 0 : frameSeconds, sceneSeconds);
  gameScene.render();
  requestAnimationFrame(animate);
}
// Welcome on the title screen; if the browser blocks audio until a gesture, it plays on the first one.
audio.announceWhenAllowed("splash-screen");
requestAnimationFrame(animate);
window.addEventListener("pagehide", () => {
  gameScene.dispose();
  shieldAward.dispose();
}, { once: true });
