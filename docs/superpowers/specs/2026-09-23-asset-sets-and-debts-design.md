# Asset sets, and the debts slice 31 left — design (slice 32)

Date: 2026-09-23. Branch: `feat/slot-webide-cordis` at `3bde26fb` (slice 31).
Source: round 3 of the paper-duel port, finding F4, plus the debts named in
`docs/superpowers/notes/2026-09-23-slice-31-carried-forward.md` and slice 30's
debt 2. Decided with the user: the asset set is a MAP on the node (option A),
not an object on the prop; the debt list is §2.

## 0. Rules

- `packages/*` is not edited.
- Every new prop keeps the existing rule: a string prop refuses an unquoted
  YAML scalar; `''` means "untouched".
- Every fix carries a unit test in its package; the browser proof is the e2e
  suite plus §3.
- A value that cannot be resolved is a diagnostic on the node that owns it; the
  render continues with the prop's empty value.

## 1. F4 — an asset prop chosen from a declared set

### 1.1 The problem

`image.src` cannot vary with the cell, so paper-duel's four orb bands are four
scene documents plus four symbol ids the mechanic swaps in. A symbol whose ART
varies by value (a 14-step orb ladder, a per-tier frame) pays for it in
documents.

### 1.2 The shape

Two ordinary props beside the asset prop, not an object on it:

```yaml
- id: art
  type: image
  props:
    src: assets/orb_green.webp          # the fallback, and what the IDE's file picker still edits
    srcOf:                              # the declared set — every entry preloaded
      green: assets/orb_green.webp
      blue: assets/orb_blue.webp
      purple: assets/orb_purple.webp
      red: assets/orb_red.webp
    srcKey: '$cell.band'                # an ordinary string prop: a literal, a `$cell` expression, a template
```

- `srcOf` is `Schema.dict(Schema.string().extra('asset', <the type's extensions>))`
  — the IDE already renders a dict of strings as a key→value editor, so the
  panel needs nothing new (the value cell is a text input, not a file picker —
  noted, not fixed here).
- `srcKey` is a plain string prop. It is NOT an asset prop, so the existing
  refusal ("an asset prop cannot be bound to `$cell`") does not touch it, and
  `cellProps` resolves it like any other bound prop.
- The pick, in `mount` and `update`: `srcOf[srcKey]` when it is an OWN key
  with a non-empty value, else `src` (so `'toString'` is no key). An unknown
  key, an empty `srcKey`, or no `srcOf` at all falls back to `src` — which is
  what every document written before this slice has.
- Preload: the type's `assets(props)` returns `src` then every `srcOf` value,
  deduped and with `''` dropped (a fresh node's empty `src` included), so the whole set is loaded with the document, and a `bind` that changes the
  key swaps a texture that is already there. This is the property that makes
  the map the right shape and an interpolated path the wrong one.

Types that get it: `image` (`src`) and `strip` (`src`) — the two a symbol's art
is made of. `spritesheet`/`video`/`gif`/`text.font` do not, until something asks.

### 1.3 The contract

`NodeType` gains:

```ts
/** Props holding a MAP of project-relative asset paths (`{ key: path }`) — checked and preloaded like `assetProps`, per value. */
assetMapProps?: string[];
```

`image`/`strip` declare `assetMapProps: ['srcOf']`. The host's check walks each
named dict: every value must be a string naming a file in the project, and no
value may mention `$cell` (the same refusal an asset prop gets, for the same
reason — the set is preloaded from the document).

## 2. The debts

### 2.1 A `$cell` prop resolved with no cell says so (slice 30, debt 2)

Today a `$cell` binding in a document that has no cell — an ordinary scene
reached by `show`, a cell scene nested through a `scene` node, a built `dist`
whose host check errored but whose game ran — mounts at the prop's empty value
in silence: a string renders empty, a number `0`, a boolean `false`. The
runtime reports it once per node+prop, as a `warning` at the node's `where`:

> message: `"<prop>" reads $cell, but this document was not mounted for a cell`
> fix: `only a symbol state's own document is mounted per cell`

Shown-time, not mount-time: `replace()` mounts every declared document
hidden — cell scenes included — so a mount-time check would warn on every
correct cell scene. It fires when the game `show`s a document (or remounts a
shown one); a preview `show` (`opts.preview`, the IDE looking at a document)
does not report. A `bind` always has a cell. Once per prop — a 5×6 board
re-mounting is not thirty rows (the diagnostics service already collapses by
plugin+where+message).

### 2.2 A required path outside `assets/` says so

`e8 build` copies `assets/` wholesale and nothing else, so a path a row
`require`s from beside its plugin resolves in dev and 404s in `dist`. The build
cannot see it (the paths live in TypeScript), so the RUNTIME says it:
`require(paths)` reports once per offending path, a `warning` at `assetLoader`:

> message: `"<path>" is outside assets/ — a built dist will not carry it`
> fix: `move it under assets/`

(A leading `./` is normalised first — `./assets/x.png` ships; `/assets/x.png`
still warns.)

### 2.3 A `wait: false` step that never settles releases the plan

`executePlan`'s end-of-plan await is unbounded today, so a non-blocking step
that never settles holds the plan, the flow's `present` node and the shell's
`busy` forever; `skip()` is the only escape, and a registered handler without
one has none. The await becomes a race against a cap — `play-loop`'s row config
gains `pendingMs` (default 30000, `0` disables):

- on expiry, one `error` per still-pending step (`step "<kind>" did not settle
  in 30 s`, at the index it started at) and `executePlan` returns;
- the promises are not cancelled — they are abandoned, and their later
  rejection is swallowed (the plan has already reported).

### 2.4 A non-blocking step's failure does not fail the round

A `wait: false` step is one the author declared must not hold the plan; its
failure should not fail the round either. `executePlan` reports it as a
`warning` (a blocking step's failure stays an `error`), and `present`
(`@energy8engine/flow`) takes `failed` only on an `error` — so the spin log
keeps the plan it drew instead of recording `[]`, and the round completes. The
timeout of §2.3 stays an `error`: a step that never settled is a broken step,
not a decorative one.

### 2.5 The `$cell` widening's sharp edges say something

`cellProps` reports (a `warning` on the node, the prop stands at its empty)
when a bound prop resolves to:

- an object (`'$cell'` alone, or a path to a record) — `"<prop>" resolved to an
  object; name a field`;
- `NaN` on a `number` prop — `"<prop>" resolved to NaN` with the fix naming the
  likeliest cause: a field name that is not an identifier (`$cell.step-win`
  parses as a subtraction).

A string prop resolving to `NaN` is left alone (`'NaN'` is a legal thing to
draw, and the author asked for arithmetic).

### 2.6 One source for the e2e's host port

`E8_E2E_HOST_PORT` is read in two places that must agree (the fixture and the
IDE's vite proxy) and nothing checks that they do. A tiny module —
`engine/apps/web/e2e-ports.ts`, plain TS with no test-only imports — exports
`IDE_HOST_PORT` (and the IDE's own `5680`/`5690` while we are there); both the
fixture and `vite.config.ts` import it. Defaults unchanged.

## 3. Tests

- scenes: `assets()` returns the map's values; `mount`/`update` pick by key,
  fall back on an unknown key / an empty key / no map; a `bind` that changes
  `srcKey` swaps the texture without a remount; the no-cell warning (once per
  prop, mount only); the object/NaN warnings; `require`'s outside-`assets/`
  warning.
- contracts: `assetMapProps` on `NodeType`.
- ide-host: a `srcOf` value that is not in the project, and one that mentions
  `$cell`, are refused; a good map checks clean; `assetProps`' own rules
  unchanged.
- play-loop: `pendingMs` expiry reports per pending step and returns; `0`
  disables; a non-blocking failure is a `warning` and a blocking one an
  `error`; a rejection after the cap is swallowed.
- flow: `present` takes `next` when the only problems are warnings, and records
  the plan; `failed` on an error.
- ide-web/e2e: both readers import the one constant (a unit test asserting the
  vite config and the fixture resolve the same number is enough).
- e2e: the example's orb becomes ONE document with a four-entry `srcOf` and
  `srcKey: '$cell.band'`; the browser case proves the art swaps with the cell's
  band (a mechanic that emits a band, or the IDE writing a symbols document —
  the plan decides which is honest for `first-slot`'s math).

## 4. Not here

- An interpolated asset path (`assets/orb_{$cell.band}.webp`) — unpreloadable.
- `spritesheet`/`video`/`gif`/`text.font` sets.
- A cell copy that never `refresh`es or flips orientation (slice 30's debts
  3–4) — a separate conversation.
- `emit { wait }` racing the abort signal (slice 29's debt 4).
- Bucket B (`packages/*`).
