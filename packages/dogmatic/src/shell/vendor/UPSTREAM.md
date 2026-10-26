# DOGMATIC shell baseline

Source: `@energy8platform/shell` 0.15.0, the latest published npm version checked on 2026-10-25.
Renderer engine: `src/ui/pixi-hb/PixiHbRenderer`, with the reference `src/ui/pixi-s/SideBar`.
License: MIT, as declared in `upstream-package.json`.
Upstream: https://github.com/energy8platform/game-engine/tree/main/packages/shell

This local copy keeps the upstream controller, overlay flows, keyboard behavior,
autoplay logic, font registration and side-layout responsive fitting. The explicit hybrid
factory is `src/shell.ts` in the preview host. DOGMATIC changes include palette, generated
artwork, a shared modes rail, outlined/captioned Bonus, attached menu cap, upper-right
chamfers and restored original mobile rows. The original S menu (black skewed rows and MontserratS 800)
and the original S bonus-purchase window (portrait tickets and animated confirmation)
are explicitly connected with DOGMATIC colours and collar artwork. Game Info, bet/autoplay
pickers, generic messages and replay summaries all use the same S skin. The renderer
and controller remain the shared original implementation. Game-specific values in the playground
are demonstration data and are not a new game's rules or mathematics.
