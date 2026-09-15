# Rigs
One folder per rig: `<symbol id>/rig.json` plus its PNG layers beside it (`h1/rig.json`, `h1/head.png`, …).
`npm run rigs` opens the golem editor over this folder; add the id to `RIGGED` in `src/slot/symbols.ts`.
The editor's `.rig-history/` (undo snapshots) is stripped from `vite build` by the engine's vite config.
