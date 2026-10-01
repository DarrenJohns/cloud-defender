import "./style.css";
import { GameScene } from "./game/gameScene";
import { createGameState, updateGame } from "./game/gameLogic";
import type { GameInput, GameMode } from "./game/gameLogic";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing required page element: #${id}`);
  return element as T;
}

const container = requiredElement<HTMLDivElement>("game");
const assetNotice = requiredElement<HTMLElement>("asset-notice");
const assetErrorMessage = requiredElement<HTMLSpanElement>("asset-error-message");
const scoreElement = requiredElement<HTMLElement>("score");
const livesElement = requiredElement<HTMLElement>("lives");
const endPanel = requiredElement<HTMLElement>("end-panel");
const endTitle = requiredElement<HTMLElement>("end-title");
const restartButton = requiredElement<HTMLButtonElement>("restart-button");
const gameScene = new GameScene(container);
let state = createGameState();
let shipReady = false;
let shieldsReady = false;
let cloudsReady = false;
const keys = new Set<string>();
const input: GameInput = { left: false, right: false, fire: false };

function updateInput(): void {
  input.left = keys.has("ArrowLeft") || keys.has("KeyA");
  input.right = keys.has("ArrowRight") || keys.has("KeyD");
  input.fire = keys.has("Space");
}

function showMode(mode: GameMode): void {
  const ended = mode !== "playing";
  endPanel.hidden = !ended;
  if (mode === "won") endTitle.textContent = "Cloud secured";
  if (mode === "gameover") endTitle.textContent = "Azure needs you";
}

function updateHud(): void {
  scoreElement.textContent = String(state.score).padStart(5, "0");
  livesElement.textContent = String(state.lives);
  showMode(state.mode);
}

function onAssetsReady(): void {
  if (!shipReady || !shieldsReady || !cloudsReady) return;
  assetNotice.hidden = true;
  updateHud();
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  updateInput();
  if (event.code === "Enter" && state.mode !== "playing" && shipReady) restart();
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  updateInput();
});
window.addEventListener("blur", () => {
  keys.clear();
  updateInput();
});

function restart(): void {
  state = createGameState();
  keys.clear();
  updateInput();
  updateHud();
}

restartButton.addEventListener("click", restart);

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
const startTime = lastTime;
function animate(now: number): void {
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (shipReady && shieldsReady && cloudsReady && state.mode === "playing") {
    updateGame(state, input, deltaSeconds);
    updateHud();
  }
  gameScene.update(state, deltaSeconds, (now - startTime) / 1000);
  gameScene.render();
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
window.addEventListener("pagehide", () => gameScene.dispose(), { once: true });
