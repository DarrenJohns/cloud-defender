# Azure Invaders

A browser-based 3D arcade game: classic flat-plane gameplay, an Azure ship, ten alien models across successive waves, drifting clouds, and firewall-inspired shields.

## Run locally

1. Install Node.js 20.19+ or 22.12+.
2. Place the player, firewall, cloud, and ten alien models at `public/assets/azure.glb`, `public/assets/firewall.glb`, `public/assets/cloud.glb`, and `public/assets/alien1.glb` through `public/assets/alien10.glb`.
3. Run `npm install`, then `npm run dev`.

The page displays a clear model-load message if any GLB is missing or invalid. The app does not silently replace supplied models. Each wave uses a distinct trio of alien models, one per row, cycling through all ten over successive levels; their normalized 3D models hover and bank independently. Waves automatically advance with faster movement and enemy fire, while shield damage persists until a new game. Background clouds use drifting clones of the 3D cloud model. Firewall hits make irregular cut-outs in the supplied shield mesh, with red fragments and a dust puff flying out; each new game varies the resulting damage pattern.

## Controls

- Left/right arrows or **A/D**: move
- **Space**: fire
- **Enter**: restart after losing

## Checks

- `npm test` runs the deterministic game-logic tests.
- `npm run build` type-checks the TypeScript and creates the production build.
