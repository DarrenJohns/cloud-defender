# Azure Invaders

A browser-based 3D arcade game: classic flat-plane gameplay, an Azure ship, ten alien models across successive waves, drifting clouds, and firewall-inspired shields.

## Run locally

1. Install Node.js 20.19+ or 22.12+.
2. Place the player, firewall, cloud, and ten alien models at `public/assets/azure.glb`, `public/assets/firewall.glb`, `public/assets/cloud.glb`, and `public/assets/alien1.glb` through `public/assets/alien10.glb`.
3. Run `npm install`, then `npm run dev`.

The page displays a clear model-load message if any GLB is missing or invalid. The app does not silently replace supplied models. Each wave uses a distinct trio of alien models, one per row, cycling through all ten over successive levels; their normalized 3D models hover and bank independently. Waves automatically advance with faster movement and enemy fire, and each new wave starts a little lower (cycling back to the top every six waves), while shield damage persists until a new game. Classic rules apply: you can have only one shot in flight at a time, only the lowest alien in each column can bomb you, and the top/middle/bottom rows score 30/20/10 points. The four-note march bass plays one note per formation step, and the aliens hop slightly on each beat. Every 16–26 seconds a rogue zero-day saucer warbles across the top of the screen; shoot it for a mystery bonus of 50, 100, 150 or 300 points. Reaching 1,500 points earns one extra shield (life), once per game. From wave 2 the aliens also drop weaving green worm bombs, and from wave 3 armoured amber-ringed ransomware bombs that fall faster and take two hits. Your shots can knock any bomb out of the sky for 10 points. Consecutive hits build a streak that multiplies alien points (×2 at 5 hits, ×3 at 10, ×4 at 15); a shot that misses, hits a firewall, or losing a shield resets it. Clearing a wave shows a "Wave secured" banner with your accuracy and awards a bonus of up to 200 points, and the game-over panel reports overall accuracy. Background clouds use drifting clones of the 3D cloud model. Firewall hits make irregular cut-outs in the supplied shield mesh, with red fragments and a dust puff flying out; each new game varies the resulting damage pattern.

## Controls

- **Enter**, **Space** or click: start the game from the Cloud Defender title screen, shown before every new game
- Left/right arrows or **A/D**: move
- **Space**: fire
- **P**: pause or resume (the game also pauses automatically when you switch tabs or minimise the window)
- **M**: mute or unmute sound (remembered between visits)
- **F** (hold): fast-forward the alien invaders at 4× speed
- **R**: restart at any time
- **T**: trigger the player death animation immediately; press again to try the next fall
- **Enter**: restart after losing

## Checks

- `npm run typecheck` type-checks the source, tests and configuration.
- `npm test` runs the deterministic game-logic tests (Vitest).
- `npm run build` type-checks the TypeScript and creates the production build.
- `npm run e2e` builds the game, serves it with `npm run preview` and runs the Playwright browser tests in `e2e/`. Run `npx playwright install chromium` once first.

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push and pull request, and uploads the Playwright report when a browser test fails.

## Replays and seeds

Every game is driven by a seeded random generator and a fixed 240 Hz simulation step, so a given seed always produces the same random choices (enemy fire, mystery-ship timing and scores, shield damage patterns); with identical inputs the whole run is identical, which is what the unit tests rely on. Add `?seed=<number>` to the URL (for example `http://localhost:5173/?seed=42`) to play a specific seed; without it each game picks a new random seed.

## Architecture

- `src/game/gameLogic.ts` is the pure, renderer-free simulation. Each update appends explicit `GameEvent` records (shots, hits, bombs, wave clears, march beats, game over and so on) to `state.events`.
- `src/main.ts` runs the fixed-step loop, then routes each frame's events to the audio engine, the HUD and the 3D scene, so nothing has to diff state between frames.
- `src/game/gameScene.ts` owns the Three.js scene; its helpers live in `src/game/scene/` (background, bombs, formation, mystery ship, shadows, shield material, textures and shared constants).
- `public/assets` models use WebP textures (max 1024 px), and the title art is `splashscreen.webp`.