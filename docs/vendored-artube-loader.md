# Artube's loading screen, vendored

Artube's branded loading screen ships upstream as **`@artube/loader`**, published only to
`https://gitlab.com/api/v4/projects/81086971/packages/npm/` — Artube's private GitLab npm
registry, `publishConfig.access: restricted`. Consuming it as a dependency means every studio
building an Artube game needs an account on that registry, a `.npmrc`, and a live token before
`npm install` will complete *at all* (npm fails the whole install on one 401, not just that
package). Artube asked us to remove that requirement, so **their code lives in our packages now**
and a game installs nothing from their registry.

## What was vendored, and where

| Upstream export | Vendored to | Entry a consumer uses |
|---|---|---|
| `artubePartnerLoader`, `artubeLoader` (Vite plugin) | `packages/artube-server/src/vite/partnerLoader.ts` | `@energy8platform/artube-server/vite` |
| `LoaderViewController` (browser) | `packages/artube-bridge/src/loader.ts` | `@energy8platform/artube-bridge/loader` |

The split is not cosmetic. The upstream package is one bundle holding **both** a Node-side Vite
plugin and a browser-side controller; our packages are already split along exactly that line, and
mixing them would be a regression either way round:

- The plugin cannot go in `artube-bridge`: that package is the game's **browser** dependency, and
  Vite-plugin code has no business in a game bundle.
- The controller cannot go in `artube-server`: that package depends on `@grpc/grpc-js` and `ws`.
  Importing it from `main.ts` would drag a gRPC client into the browser.
- Neither can go in `game-engine` or `platform-core`: a non-Artube game must pay nothing for
  Artube. The engine's seam is the structural `ExternalLoadingOverlay` interface, and it names no
  Artube type at all.

Within `artube-bridge` the controller is its **own entry** (`/loader`), like `/detect`, because a
game's `main.ts` imports it *statically on every target* — a static import is what lets the plain
`vite build` of the same game resolve it — and `.` would pull `ArtubeBridge` and the game-sdk into
every bundle.

`ARTUBE_LOADER_ELEMENT_IDS` (exported from `artube-server/vite`) is the one thing the two halves
share: the five element ids the plugin prints and the controller looks up. Both files name them and
point at each other; `tests/vite-partner-loader.test.ts` asserts the markup defines exactly that
set, and `artube-bridge/test/loader.test.ts` asserts the controller binds to it. That closes the
loop without a dependency edge between a Node package and a browser one.

## Licensing, stated plainly

Upstream `package.json` declares **no `license`, no `author`, no `repository`**, and the tarball
ships **no LICENSE file**. We redistribute it anyway, inside our packages, because Artube asked for
that. Both vendored files carry a provenance header saying so. Do not let anyone read them as
Energy8 code: they are Artube's, transcribed.

## What "transcribed" means

Upstream publishes **only a build** — 11 KB of minified ESM in `dist/index.js`, no source. The
vendored files are that bundle turned back into readable TypeScript:

- the CSS, the markup and the logo SVG are copied **byte-for-byte**;
- control flow is preserved statement for statement, including its quirks (see the "KNOWN UPSTREAM
  QUIRK" test about the greedy `<body(.*)>` regex);
- the only Energy8 addition is `createArtubeLoader()`, marked as such in the file — a `null`-instead
  -of-throw guard every multi-target game would otherwise copy-paste.

Equivalence was checked, not assumed: with upstream 2.1.0 installed, both plugins were run over the
same document across all six option combinations plus the deprecated alias, and the outputs were
**byte-identical** (evidence in `.superpowers/sdd/2026-08-10-artube-integration/`).

## Re-vendoring when Artube ships a new version

Nothing here updates itself. A game consuming us keeps the 2.1.0 look until someone does this:

1. Get the new tarball (needs a token — *once*, here, not in any game):
   `npm pack @artube/loader --userconfig=/path/to/an/.npmrc-with-a-token`
2. Diff its `dist/index.js` against the vendored files. Only three things can meaningfully change:
   the CSS, the markup, and `LoaderViewController`'s method bodies.
3. Port the change, keeping CSS/markup byte-for-byte, and bump the version in **both** provenance
   headers and in this file.
4. Re-run the byte-equality check above with the new version before trusting the transcription.
5. `npm test --workspace @energy8platform/artube-server` and `… artube-bridge`.

If the element ids move, `ARTUBE_LOADER_ELEMENT_IDS` and the browser half must move together — the
controller throws `Loader elements not found on page!` when they do not, which surfaces as a game
that will not boot on Artube and boots fine everywhere else.
