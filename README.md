# Azure Invaders

A browser-based 3D arcade prototype: classic flat-plane gameplay, an Azure ship, drifting clouds, and firewall-inspired shields.

## Run locally

1. Install Node.js 20.19+ or 22.12+.
2. Place the player, firewall, and cloud models at `public/assets/azure.glb`, `public/assets/firewall.glb`, and `public/assets/cloud.glb`.
3. Run `npm install`, then `npm run dev`.

The page displays a clear model-load message if any GLB is missing or invalid. The app does not silently replace supplied models. Background clouds use drifting clones of the 3D cloud model. Firewall hits make irregular cut-outs in the supplied shield mesh, with red fragments and a dust puff flying out; each new game varies the resulting damage pattern.

## Controls

- Left/right arrows or **A/D**: move
- **Space**: fire
- **Enter**: restart after winning or losing

## Checks

- `npm test` runs the deterministic game-logic tests.
- `npm run build` type-checks the TypeScript and creates the production build.

Enemy meshes are deliberately temporary placeholders so the alien/service designs can be decided later.
