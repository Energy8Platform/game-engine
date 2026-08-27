# Reel Lab

A standalone visual playground for the **configurable reel system** in
`@energy8platform/game-engine/slot`. Tweak every knob in the side panel, watch the reels react
live, trigger any of the special feature mechanics, switch between presets distilled from our
shipped games, and **copy the resulting config** straight into a game.

```bash
npm install            # from the repo root (workspaces)
npm run build --workspace @energy8platform/game-engine   # the lab consumes the built dist
npm run dev --workspace reel-lab-example                  # → http://localhost:5179
```

> The lab imports the engine from its built `dist`, so rebuild `@energy8platform/game-engine`
> after changing engine source (and restart Vite with `--force` to drop the stale dep cache).

## What you can do

- **Grid** — columns, rows, cell size, gap, evaluation model (lines / ways / cluster / megaways),
  reel mask. The header shows the live ways-to-win count.
- **Motion** — style (`swap` / `strip` / `cascade-drop`), spin-up, hold, stop stagger, stop mode
  (sequential / sync / random) + order, settle bounce, squash-on-land, motion blur, turbo factor,
  intensity, slam stop, tape length, and the `cascade-drop` pacing: cell stagger (gap between
  consecutive cells of one reel), reel stagger factor, drop fall factor.
- **Anticipation** — trailing-reel slow-down threshold, slowdown factor, hold, the per-reel ramp
  (slowdown ramp ×/reel and hold ramp ms/reel), optional reel zoom.
- **Cascade / Tumble** — gravity, dim non-winners, per-step deceleration, timings, and a climbing
  win multiplier (additive / multiplicative).
- **Win presentation** — highlight scale, glow, frame shake.
- **Features** — toggle and trigger all the special mechanics: expanding / sticky / walking /
  random wilds, mystery, transform / upgrade, giant, split, stacked, nudge / xNudge, multiplier
  symbols, hold & spin, random reel modifiers.

## Buttons

| Button | Does |
| --- | --- |
| **Spin** | Spins to a fresh random board with the current motion settings. |
| **Spin → scatters** | Spins to a board seeded with scatters (exercises anticipation). |
| **Tumble** | Runs a cascade sequence (needs Cascade enabled). |
| **ReelStep** | Pays the winning fixed lines, then scrolls each winning reel DOWN by N (= distinct winning symbols on it), and repeats until no lines win. Needs Cascade enabled (shares its timings/multiplier). |
| **New board** | Drops in a fresh random board. |
| **Megaways roll** | Re-rolls per-reel heights within `minRows…maxRows`. |
| **Copy TS / JSON** | Copies the config — TS copies only the diff vs `DEFAULT_REEL_CONFIG`. |

The symbol set is procedural (coloured tiles, no art assets) so the lab is fully self-contained.
See `../../docs/reels-analysis-and-design.md` for the design behind the system.
