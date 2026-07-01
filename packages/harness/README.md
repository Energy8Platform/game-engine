# @energy8platform/harness

A renderer- and platform-agnostic **dev harness** for Energy8 games: it frames the game
in an `<iframe>`, provides screen presets (device testing), the Settings / Replay UI, a
docked right sidebar, and a `wrapper ↔ iframe` message bus.

It is a Vite dev plugin (`apply: 'serve'`). Everything specific to a play backend or a
tool panel is contributed via **plugins**:

- **backend plugins** implement `HarnessBackend` — the play/RGS wire protocol plus the
  `describe()` that tells the core how to launch the iframe and what modes to offer in
  Replay. Example: `stakeRgsPlugin` from `@energy8platform/stake-kit/harness`.
- **panel plugins** implement `HarnessPanel` — an extra tool panel whose client is a
  self-contained browser ESM the harness serves. Example: `reelDevtoolsPlugin` from
  `@energy8platform/game-engine/harness` (the live reel-config sidebar).

```ts
// vite.config.ts
import { createHarness } from '@energy8platform/harness';
import { stakeRgsPlugin } from '@energy8platform/stake-kit/harness';
import { reelDevtoolsPlugin } from '@energy8platform/game-engine/harness';

export default {
  plugins: [
    createHarness({
      plugins: [
        stakeRgsPlugin({ config: './math.config.ts', booksDir: 'stake-math' }),
        reelDevtoolsPlugin(),
      ],
    }),
  ],
};
```

Drop the backend to run a game purely for screen/behaviour testing; drop the reel panel
if you don't need it. The core (`@energy8platform/harness`) has zero `@energy8platform`
runtime dependencies.

## Contracts

- `@energy8platform/harness` — `createHarness`, and the `HarnessBackend` / `HarnessPanel`
  / `HarnessPlugin` types a plugin implements.
- `@energy8platform/harness/panel` — the browser-side `HarnessPanelContext` /
  `HarnessPanelMount` a panel client's `clientEntry` implements.
