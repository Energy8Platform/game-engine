# @energy8platform/dogmatic

DOGMATIC provider branding for Energy8 slots: the neon collar loader and the Pixi game shell. Both are taken from the provider's own preview package.

```ts
import { createSlotGame } from '@energy8platform/game-engine/host';
import { dogmaticPreloader } from '@energy8platform/dogmatic/preloader';
import { createDogmaticShell } from '@energy8platform/dogmatic/shell';

createSlotGame({
  // ...
  loading: { preloaderVariant: dogmaticPreloader },
  shellFactory: createDogmaticShell,
});
```

## `./preloader`

`dogmaticPreloader` is a `PreloaderVariant`.

- The collar flickers on like neon and settles at 1.41 s. The DOGMATIC wordmark follows at 1.7 s, and the LOADING line at 2.55 s.
- The bar and the percentage follow the game's real load and never move backwards.
- The D tag keeps swinging.
- It replaces the platform's "powered by" splash (`splash: false`).
- With reduced motion, it skips the flicker and the swing.

## `./shell`

`createDogmaticShell(config)` runs the provider's fork of the `@energy8platform/shell` 0.15.0 Pixi UI (`src/shell/vendor/`, see `UPSTREAM.md`) on the published shell controller, so a host drives it like any other `Shell`. The fork contains:

- the S side bar in the DOGMATIC palette;
- the BONUS button with the collar;
- the S menu, without the Spacebar-to-spin row;
- the S buy bonus: portrait cards in a row, in the DOGMATIC look;
- S game info, bet / autoplay pickers, messages and replay, all in the same DOGMATIC style.

Do not edit `vendor/` to keep it in sync with `packages/shell`: it is the provider's design. For a new drop from the provider, copy the files reachable from their `src/shell.ts` again. The only change the copy makes is rewriting the `@/` imports to relative paths.

## Assets

`brand/` holds the outline artwork and Manrope 800, cut down to the loader's digits and `%`. `npm run gen-assets` embeds them in `src/generated/`. Nothing is fetched at runtime, because of Stake's CSP. The artwork is decoded with `createImageBitmap` and drawn to canvases. The loader and the shell share one artwork chunk.

Demo: `examples/dogmatic-demo` (`?open=menu|info|buybonus`, `?screen=phone`, `intro.html?p=0.6`).
