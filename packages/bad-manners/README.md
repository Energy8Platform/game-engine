# @energy8platform/bad-manners

BAD MANNERS studio branding for Energy8 slots: the studio intro preloader and the Pixi game shell. Both follow `brand/BRANDBOOK.md`.

```ts
import { createSlotGame } from '@energy8platform/game-engine/host';
import { badMannersPreloader } from '@energy8platform/bad-manners/preloader';
import { createBadMannersShell } from '@energy8platform/bad-manners/shell';

createSlotGame({
  // ...
  loading: { preloaderVariant: badMannersPreloader },
  shellFactory: createBadMannersShell,
});
```

### Accent

The kit's acid lime is the accent, and any colour can replace it:

```ts
loading: { preloaderVariant: createBadMannersPreloader({ accent: '#ff3b8b' }) },
shellFactory: badMannersShell({ accent: '#ff3b8b' }),
```

The shell repaints the raster kit at load: the pills, active bubbles, the SPIN disc, slider fills, outlines and the face's tongue. The intro recolours its tongue, the `!@#$` bubble, the bursts and the underline. A game's `theme.accent` wins over the factory option, and `shell.setTheme({ accent })` switches it live.

## `./preloader`

`badMannersPreloader` is a `PreloaderVariant` that plays the studio intro (BRANDBOOK §6, `intro.json`).

- It is drawn in the DOM with the Web Animations API, so it does not depend on Pixi.
- It replaces the platform's "powered by" splash (`splash: false`), as hellbuddha does.
- The underline follows the real load progress and never moves backwards.
- Tap, click or Space after 500 ms jumps to the final frame.
- A repeat launch within 24 h gets the short intro (`localStorage['bm.introSeen']`).
- With reduced motion, the final frame is shown without animation.

Needs `@energy8platform/platform-core` with object support in `loading.preloaderVariant`.

## `./shell`

`createBadMannersShell(config)` uses the same controller, config and events as every Energy8 shell (`@energy8platform/shell` core), with its own Pixi renderer. It provides:

- the HUD: on desktop, the menu over the round BUY (the face as in the logo, only its tongue in the accent; an accent ✕ disc while a feature is on) over BALANCE on the left, autoplay + turbo over a 2× SPIN over BET on the right, and WIN between them on the bottom line; portrait keeps the same parts in rows;
- the menu, which stacks above the burger while the burger shows the ✕ (§5.6);
- game info with PAYTABLE / MODES / CONTROLS / RULES tabs (§5.3);
- buy bonus (§5.2);
- the bet and autoplay pickers (§5.4, §5.5);
- message and replay modals (§5.7).

Everything is built from the kit: the 9-slice bubbles and pills, the atlas glyphs and the face mark. Fonts are Luckiest Guy and Montserrat 600/800/900; locales outside Latin-1 draw display text in Montserrat 900 caps.

Big-win banners (§5.7) belong to the game (`/slot` `BigWinOverlay`), not to the shell.

## Assets

`brand/` holds the kit sources the package uses. `npm run gen-assets` embeds them in `src/generated/` as base64 and inline SVG. The package never fetches a URL at runtime, because Stake's CSP blocks `data:` fonts and images. Fonts load through `FontFace`, and images decode through `createImageBitmap`.

Demo: `examples/bad-manners-demo` (`?intro=1`, `?open=menu|info|buybonus|bet|auto|replay`, `?screen=phone`).
