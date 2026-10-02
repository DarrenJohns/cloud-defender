# Azure Invaders

A browser-based 3D arcade game: classic flat-plane gameplay, an Azure ship, ten alien models across successive waves, drifting clouds, and firewall-inspired shields.

## Development setup

1. Install Node.js 20.19+ or 22.12+.
2. Run `npm ci` to install the locked dependencies.
3. Run `npm run dev` and open the local URL printed by Vite.

Game assets are included in `public/assets`; no separate model download is needed. The game displays an error if a model is missing or invalid.

Each wave uses a different trio of alien models, and waves get faster and descend as they progress. Classic rules apply: only one shot can be in flight at a time, only the lowest alien in each column can drop a bomb, and alien rows score 30/20/10 points. The mystery ship, extra shield at 1,500 points, special bombs, bomb-cancelling shots, hit streaks and wave-clear bonuses add variations to the classic gameplay.

## Controls

- **Enter**, **Space** or click: start from the title screen
- Left/right arrows or **A/D**: move
- **Space**: fire
- **P**: pause or resume (the game also pauses when its browser tab becomes hidden)
- **M**: mute or unmute sound (remembered between visits)
- **F** (hold): fast-forward the alien invaders at 4× speed
- **R**: restart at any time
- **T**: trigger the player death animation immediately; press again to try the next fall
- **Enter**: restart after game over

## Checks

- `npm run typecheck` type-checks the source, tests and configuration.
- `npm test` runs the deterministic game-logic tests (Vitest).
- `npm run build` type-checks the TypeScript and creates the production build.
- `npm run e2e` builds the game, serves it with `npm run preview` and runs the Playwright browser tests in `e2e/`. Run `npx playwright install chromium` once first.

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push and pull request, and uploads the Playwright report when a browser test fails.

## Replays and seeds

The simulation uses a seeded random generator and a fixed 240 Hz step. Add `?seed=<number>` to the URL (for example `http://localhost:5173/?seed=42`) to make a run reproducible; without it, a new seed is chosen.

## Architecture

- `src/game/gameLogic.ts` is the renderer-free simulation. It appends explicit `GameEvent` records for one-shot actions such as shots, hits, wave clears and game over.
- `src/main.ts` runs the fixed-step loop and routes events to audio, the HUD and the 3D scene.
- `src/game/gameScene.ts` owns the Three.js scene; its helpers live in `src/game/scene/` (background, bombs, formation, mystery ship, shadows, shield material, textures and shared constants).
- Models use embedded WebP textures (up to 1024 px); the title art is `public/assets/splashscreen.webp`.
