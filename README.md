# Azure Invaders

A browser-based 3D arcade prototype: classic flat-plane gameplay, an Azure ship, drifting clouds, and firewall-inspired shields.

## Run locally

1. Install Node.js 20.19+ or 22.12+.
2. Place the player model at `public/assets/azure.glb`.
3. Run `npm install`, then `npm run dev`.

The page displays a clear model-load message if the GLB is missing or invalid. The app does not silently replace the supplied ship model.

## Controls

- Left/right arrows or **A/D**: move
- **Space**: fire
- **Enter**: restart after winning or losing

## Checks

- `npm test` runs the deterministic game-logic tests.
- `npm run build` type-checks the TypeScript and creates the production build.

Enemy meshes are deliberately temporary placeholders so the alien/service designs can be decided later.
