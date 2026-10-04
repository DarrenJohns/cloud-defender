# Cloud Defender

A browser-based 3D arcade game: classic flat-plane gameplay, an Azure ship, ten alien models across successive waves, drifting clouds, and firewall-inspired shields.

## Development setup

1. Install Node.js 20.19+ or 22.12+.
2. Run `npm ci` to install the locked dependencies.
3. Run `npm run dev` and open the local URL printed by Vite.

Game assets are included in `public/assets`; no separate model download is needed. The game displays an error if a model is missing or invalid.

## Publish on GitHub Pages

The `dev` branch deploys automatically to [https://darrenjohns.github.io/cloud-defender/](https://darrenjohns.github.io/cloud-defender/) through `.github/workflows/pages.yml`. The Pages build uses the repository subpath as its Vite base so models and images load correctly.

Each wave uses a different trio of alien models, and waves get faster and descend as they progress. Classic rules apply: only one shot can be in flight at a time, only the lowest alien in each column can drop a bomb, and alien rows score 30/20/10 points. The mystery ship, shield replacements, special bombs, bomb-cancelling shots, hit streaks and wave-clear bonuses add variations to the classic gameplay. Every 1,500 points restores one lost shield, up to three total. Milestones reached with all three shields intact are consumed, not banked.

## Controls

The mouse cursor hides after two seconds of inactivity during gameplay. Moving or clicking restores it; title, pause and game-over screens always show it.

- **Enter**, **Space** or click: start from the title screen
- Left/right arrows or **A/D**: move
- **Space**: fire
- **P**: pause or resume (the game also pauses when its browser tab becomes hidden)
- **M**: mute or unmute sound (remembered between visits)
- **F** (hold): fast-forward the alien invaders at 4× speed
- **R**: restart at any time
- **T**: trigger the player death animation immediately; press again to try the next fall
- **S**: test the shield-acquisition sequence once per press; restore one missing shield, or preview at full shields without exceeding three (score and score milestones are unchanged). Holding the key or pressing during an active sequence does not queue another animation. Press again after it lands to repeat the test.
- **Enter**: restart after game over

Shield awards briefly freeze combat for a large spinning 3D shield reveal, sweeping metallic shine, expanding energy rings and sparks. The announcer says "New shield acquired!" without duplicate on-screen text. The shield shrinks along a curved flight into its HUD slot. Gameplay resumes automatically after it lands; restarting cancels the sequence.

HUD shields are 40px tall (32px on compact screens). Losing a shield shatters it into closed, lit 3D chunks with tumbling rotation, depth motion and smoke, aligned to the icon's displayed size.

## Checks

- `npm run typecheck` type-checks the source, tests and configuration.
- `npm test` runs the deterministic game-logic tests (Vitest).
- `npm run build` type-checks the TypeScript and creates the production build.
- `npm run e2e` builds the game, serves it with `npm run preview` and runs the Playwright browser tests in `e2e/`. Run `npx playwright install chromium` once first.

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push and pull request, and uploads the Playwright report when a browser test fails.

## Replays and seeds

An alien reaching the A's line ends the game immediately, regardless of remaining shields or temporary invulnerability. Enemy bomb hits still remove one shield.

The background keeps five clouds in evenly spaced viewport-relative slots with staggered heights. Each scene gets a shuffled, randomized mix of small, medium and large clouds, with sizes held stable during play. Shared visible drift and gentle vertical motion prevent bunching or offscreen gaps, and placement/scale adapt to window size while retaining the 3D cloud rotation, breathing and camera parallax.

The sky contains 720 stars plus 940 parallax-margin stars, rendered as small round points rather than cross-shaped sparkles. About 30% are brighter stars with soft, staggered brightness glints. Stars still thin toward the horizon and remain behind the clouds.

Descending aliens smoothly move into a foreground depth layer before overlapping the firewall bases. Enemy bombs and firewall hit effects also sit in front of the bases' animated front faces, retaining normal depth testing and unchanged simulation collision timing.

Alien shadows share the firewalls' floor baseline, depth and light maximum opacity, fading gradually with alien height rather than forming heavy dark spots. Alien floor shadows lie horizontally rather than facing the camera.

Aliens cast their actual model silhouettes onto the firewalls. The key light sits nearly overhead with minimal sideways offset, giving the shadows a mostly downward direction instead of the earlier strongly frontal projection.

Clearing a wave freezes combat and the battlefield animation for three seconds while the wave-clear stats remain sharp over a blurred background. The next formation and its announcement begin after this breather. Manual pause or a shield reward holds the countdown; restarting clears it.

The simulation uses a seeded random generator and a fixed 240 Hz step. Add `?seed=<number>` to the URL (for example `http://localhost:5173/?seed=42`) to make a run reproducible; without it, a new seed is chosen.

## Architecture

- `src/game/gameLogic.ts` is the renderer-free simulation. It appends explicit `GameEvent` records for one-shot actions such as shots, hits, wave clears and game over.
- `src/main.ts` runs the fixed-step loop and routes events to audio, the HUD and the 3D scene.
- `src/game/gameScene.ts` owns the Three.js scene; its helpers live in `src/game/scene/` (background, bombs, formation, mystery ship, shadows, shield material, textures and shared constants).
- Models use embedded WebP textures (up to 1024 px); the title art is `public/assets/splashscreen.webp`.

## Announcer voice

The sound palette groups actions into player power (controlled heavy discharge), enemy machinery (unstable motion and breakup), firewall structure (fracture/collapse), shield energy (collapse/restoration), and mission control (clear voice and restrained tonal cues). The audition page maps these roles and their relative scale; sketches are not automatically approved production sounds.

The approved S1-S5 palette targets expressive space-opera action. Gameplay uses S1 for the A's cannon, S2 for alien and mystery ship destruction, S3 for player shield loss, and S4 for shield acquisition. S5 is the ten-second reference mix of these sounds, not a single gameplay effect. They share the existing effects bus, mute/pause controls and announcer ducking.

The four-note formation heartbeat has a stronger low body and upper resonance for speaker audibility. Alien bomb launches use a lower-pitched, filtered S1 variant; firewall impacts use a compact 1.15-second, slightly lower-pitched S2 reactor boom, without the earlier sharp crack/noise layer. These variants have faded endings and independent overlap limits so they do not cut off player cannon, shield-loss or alien destruction sounds. Firewall demolition retains its structural character at a reduced mix level, with rapid simultaneous demolitions grouped to avoid overpowering the energy effects. Supporting bomb cancellation, engine, ground impact and mission cues still use synthesis; their timbres have not yet been redesigned as rendered palette clips.

Approved game clips live in `public/assets/sfx/`; source credits are in `public/assets/sfx/LICENSE.txt`. Failed loading logs an explicit error rather than substituting a rejected effect. Regenerate auditions with `scripts/generate-cinematic-sounds.py --install-palette` to also update the four gameplay clips.

`/sound-audition.html` provides a cinematic comparison set separate from game playback: spacecraft detonation, energy cannon, firewall impact, demolition and a combat sequence. Render it with `scripts/generate-cinematic-sounds.py` (NumPy and ffmpeg required). It processes the credited Kenney CC0 textures in `public/sound-audition/` and adds procedural blast layers and stereo reflections; no movie recordings are used. Source licences are retained beside the clips.

The A's weapon uses an original heavy sci-fi blaster effect: a descending energy sweep, bass punch and metallic discharge instead of a light laser chirp.

Alien destruction uses the approved 4.2-second S2 reactor rupture. Simultaneous kills share one capped sound, and older tails fade out when the overlap limit is reached.

Destroyed firewalls finish with an outward brick explosion, warm flash, rising smoke and a bomb-like detonation: a sharp crack, sustained noisy blast and rolling bass/debris tail, without an explosion ring. Normal damage retains its smaller impact effect.

Sound effects are synthesised in `src/game/audio.ts`. Mission-control voice lines are short MP3 clips in `public/assets/voice/`, played through the same audio graph so the mute button and pause apply to them as well. `src/game/announcer.ts` decides what plays: one line at a time, more urgent lines (game over, last shield) interrupt routine ones, repeats and stale lines are dropped, and effects dip slightly while a line is spoken.

| File | Line | Plays when |
|---|---|---|
| `splash-screen.mp3` | "Welcome to Cloud Defender!" | the title screen is dismissed |
| `start-game.mp3` | "Get ready, player one!" | the first formation flies in |
| `next-wave.mp3` | "Next wave... incoming!" | each later formation flies in |
| `wave-secured.mp3` | "Wave secured." | a wave is cleared |
| `firewall-lost.mp3` | "Firewall taken off-line!" | a firewall is destroyed |
| `shield-lost.mp3` | "Shield destroyed!" | the player is hit with shields left |
| `last-shield.mp3` | "Warning... last shield! Earn fifteen hundred points…" | the player is down to one shield |
| `extra-shield.mp3` | "New shield acquired!" | the bonus shield is awarded |
| `zero-day.mp3` | "Zero-day detected!" | the mystery ship appears |
| `game-over.mp3` | "Game over, player one. You have been hacked!" | the run ends |

The clips are generated with the open-source [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech model (Apache-2.0) using its stock `am_michael` voice. `scripts/generate-voices-neural.py` styles each line as a deep, masked "helmet" announcer: it lowers the pitch about five semitones, adds chest resonance, a short metallic comb echo, heavy compression and a room echo, and normalises loudness. Pass `--preset arena` for the lighter arena style. The dialogue lives in `scripts/voice-lines.json`. Edit the text there and keep the ids. A line can also be an object such as `{"text": "...", "voice": "am_michael", "speed": 0.8, "pitch": 0.85}`. To regenerate:

```powershell
py -3.12 -m venv $env:TEMP\cloud-defender-tts
& $env:TEMP\cloud-defender-tts\Scripts\python -m pip install kokoro soundfile numpy
& $env:TEMP\cloud-defender-tts\Scripts\python scripts\generate-voices-neural.py              # all lines
& $env:TEMP\cloud-defender-tts\Scripts\python scripts\generate-voices-neural.py --only zero-day
& $env:TEMP\cloud-defender-tts\Scripts\python scripts\generate-voices-neural.py --audition am_onyx am_michael --only start-game
```

Auditions are written to `voice-reference/audition/`, which is gitignored. `scripts/generate-voices.ps1` is still available as a quick Windows text-to-speech fallback. To use your own recordings, replace the MP3 files and keep the same names; short, mono, trimmed clips work best. A missing clip simply stays silent. A new line id also needs a matching entry in `src/game/announcer.ts` and an event that triggers it.

## Asset provenance

The 3D assets were created from PNG source images using [image-to-WebGL](https://github.com/DarrenJohns/djtools/tree/dev/apps/image-to-webgl).
