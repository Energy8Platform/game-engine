-- first-slot — spike: 5x3 lines game, no bonus stage.
-- Three win-representations from ONE spin, on purpose:
--   `lines`           — single-pass evaluation of the initial grid (classic
--                        mechanic: spin, reveal wins, done).
--   `cascade_history` — the same board tumbled: winning cells removed,
--                        gravity, refill, re-evaluate, repeat (cascade
--                        mechanic consumes this instead).
--   `reel_steps`      — the same board under the ReelStep rule: pay the
--                        winning cells, then scroll every reel DOWN by its
--                        own count of them. Nothing is removed — the
--                        symbols ride down, fresh ones enter at the top,
--                        the bottom ones ride off (a project plugin's
--                        `reel-step` mechanic consumes this).
-- classic ignores cascade_history and reel_steps; cascade ignores lines
-- (beyond round 0) and reel_steps; reel-step ignores both of the others.
-- Same game, same script, three playable shapes — switched from the IDE's
-- composition screen.
--
-- The mechanic renders, the math pays: `win` (== `data.win`, the amount the
-- server credits) accumulates EVERY cascade round, so it will not equal
-- sum(lines[].win) whenever the tumble pays more than once. `base_win` is
-- the round-0-only total — sum(lines[].win) === base_win, always. A
-- `classic` presentation reveals `lines` + `base_win`; whichever mechanic is
-- rendering, `win` is what actually got paid.
--
-- Where `reel_steps` sits in that sentence, stated here and not left to be
-- inferred: it is a SECOND chain over the same landed board, not a
-- re-labelling of the first. Round 0 is shared by all three forms — the
-- reels land on `grid`, the same cells win, and
-- reel_steps[0].win === base_win === sum(lines[].win) === cascade_history[0].win.
-- From round 1 on the two chains are looking at different boards, because a
-- scroll and a tumble move symbols differently, so sum(reel_steps[].win) is
-- the ReelStep chain's OWN total and is not the credited figure. `win` is,
-- and `win` is the tumble's total, because the tumble is the chain this
-- `execute` actually walks. A `reel-step` presentation therefore shows its
-- own chain and still reports `win` as what the player was paid — the same
-- rule `classic` already lives under. See `session-dev/src/types.ts`.

record Vars {
  max_win_reached: bool
}

record Feat {
  ante: int
}

record CellPos {
  col: int
  row: int
}

record LineWin {
  line: int
  symbol: int
  count: int
  win: float
  positions: [CellPos]
}

record CascadeStep {
  grid: [[int]]
  removed: [CellPos]
  win: float
}

-- One ReelStep round. The first three fields are the legacy
-- `ReelStepController`'s own `ReelStepData` (`winningCells`, `shifts`,
-- `settledGrid`) — the presentation needs exactly these to run the step.
-- `win` is the fourth, and it is not decoration: without a per-round payout
-- there is no "sum over reel_steps" to hold against `win` at all, and the
-- three forms could disagree in silence. See the header.
record ReelStep {
  -- cells that won on the board this step ran against, paid before the scroll
  winning: [CellPos]
  -- how far each reel scrolls down; length = number of columns, 0 = stays put
  shifts: [int]
  -- the board after every reel has scrolled by its own shifts[col]
  settled: [[int]]
  -- this round's payout; reel_steps[0].win === base_win, always
  win: float
}

enum SpinData tag stage {
  base_game {
    grid: [[int]]
    -- credited amount (cascade-inclusive) — NOT sum(lines[].win); see header.
    win: float
    -- round-0-only total; sum(lines[].win) === base_win.
    base_win: float
    lines: [LineWin]
    cascade_history: [CascadeStep]
    -- the third form: the same landed board under the ReelStep rule.
    -- sum(reel_steps[].win) is this chain's own total, NOT `win`; the two
    -- chains share round 0 and diverge after it. See the header.
    reel_steps: [ReelStep]
  }
}

game "first-slot" {
  bet_levels = [0.2, 1.0, 5.0]
  max_win = 500.0
  vars = Vars
  feature = Feat
  data = SpinData
}

action spin {
  stage = base_game
  cost = 1.0
}

-- ============================================================
-- 5 reels x 3 rows, flat index = col*3+row. 6 symbols, rarer = higher pay.
-- ============================================================

const SYM_W: [int; 6] = [5, 10, 15, 20, 25, 30]
const PAY_VAL: [float; 18] = [
  5.0, 10.0, 25.0,
  4.0, 8.0, 15.0,
  3.0, 6.0, 12.0,
  2.0, 4.0, 8.0,
  1.0, 2.0, 4.0,
  0.5, 1.0, 2.0,
]

fn pay_for(sym: int, count: int) -> float {
  let n = count
  if n > 5 { n = 5 }
  return PAY_VAL[(sym - 1) * 3 + (n - 3)]
}

fn fill_grid(c: ctx, gsym: [int; 15]) {
  for col in 0..5 {
    for row in 0..3 {
      let i = col * 3 + row
      if gsym[i] == 0 {
        gsym[i] = rng_weighted(c, SYM_W) + 1
      }
    }
  }
}

-- Evaluate the 3 horizontal lines. Marks winning cells in `removed`, fills
-- the parallel out-arrays (max 3 lines: one per row) and returns their count.
fn mark_and_pay(gsym: [int; 15], removed: [int; 15], line_row: [int; 3], line_sym: [int; 3], line_count: [int; 3], line_win: [float; 3]) -> int {
  let n = 0
  for row in 0..3 {
    let sym = gsym[row]
    let count = 1
    while count < 5 {
      if gsym[count * 3 + row] != sym { break }
      count = count + 1
    }
    if count >= 3 {
      for k in 0..count { removed[k * 3 + row] = 1 }
      line_row[n] = row
      line_sym[n] = sym
      line_count[n] = count
      line_win[n] = pay_for(sym, count)
      n = n + 1
    }
  }
  return n
}

fn lines_out(c: ctx, n: int, line_row: [int; 3], line_sym: [int; 3], line_count: [int; 3], line_win: [float; 3]) -> [LineWin] {
  let l: [LineWin] = list()
  for i in 0..n {
    let cnt = line_count[i]
    let row = line_row[i]
    let positions: [CellPos] = list()
    for k in 0..cnt { push(positions, CellPos { col: k, row: row }) }
    push(l, LineWin { line: row, symbol: line_sym[i], count: cnt, win: line_win[i], positions: positions })
  }
  return l
}

fn removed_out(c: ctx, removed: [int; 15]) -> [CellPos] {
  let l: [CellPos] = list()
  for col in 0..5 {
    for row in 0..3 {
      if removed[col * 3 + row] == 1 { push(l, CellPos { col: col, row: row }) }
    }
  }
  return l
}

fn total_of(n: int, line_win: [float; 3]) -> float {
  let t = 0.0
  for i in 0..n { t = t + line_win[i] }
  return t
}

fn remove_marked(gsym: [int; 15], removed: [int; 15]) {
  for i in 0..15 {
    if removed[i] == 1 { gsym[i] = 0 }
  }
}

fn apply_gravity(gsym: [int; 15]) {
  for col in 0..5 {
    let wr = 2
    for r in 0..3 {
      let row = 2 - r
      let i = col * 3 + row
      if gsym[i] != 0 {
        if wr != row {
          let j = col * 3 + wr
          gsym[j] = gsym[i]
          gsym[i] = 0
        }
        wr = wr - 1
      }
    }
  }
}

-- ── the ReelStep rule ───────────────────────────────────────────────────
-- Not a variant of the tumble above: nothing is removed and gravity never
-- runs. A reel scrolls DOWN by one position per winning cell that landed on
-- it, so its symbols ride down, that many fresh symbols enter at the top,
-- and the same number ride off the bottom — winners and non-winners alike.
-- That is why this is a second chain and not a second reading of the first:
-- from round 1 on it is evaluating a board the tumble never produces.

-- How far each reel scrolls: one position per winning cell on that reel.
fn shifts_of(removed: [int; 15], col: int) -> int {
  let n = 0
  for row in 0..3 {
    if removed[col * 3 + row] == 1 { n = n + 1 }
  }
  return n
}

fn shifts_out(c: ctx, removed: [int; 15]) -> [int] {
  let l: [int] = list()
  for col in 0..5 { push(l, shifts_of(removed, col)) }
  return l
}

-- Scroll every reel down by its own shift, in place. Written bottom-up so
-- each row reads a source row this pass has not overwritten yet.
fn scroll_reels(c: ctx, gsym: [int; 15], removed: [int; 15]) {
  for col in 0..5 {
    let n = shifts_of(removed, col)
    if n > 3 { n = 3 }
    if n > 0 {
      for k in 0..3 {
        let row = 2 - k
        let i = col * 3 + row
        if row >= n {
          gsym[i] = gsym[col * 3 + (row - n)]
        } else {
          gsym[i] = rng_weighted(c, SYM_W) + 1
        }
      }
    }
  }
}

fn grid_out(c: ctx, gsym: [int; 15]) -> [[int]] {
  let cols: [[int]] = list()
  for col in 0..5 {
    let rows: [int] = list()
    for row in 0..3 { push(rows, gsym[col * 3 + row]) }
    push(cols, rows)
  }
  return cols
}

-- Walk the ReelStep chain from the board the reels landed on. Same stop
-- rule and same 10-round cap as the tumble: a round that pays nothing ends
-- the chain, and no round is ever recorded without a payout — which is what
-- makes "this spin has a reel chain" and "this spin paid" the same fact.
fn reel_chain(c: ctx, landed: [int; 15]) -> [ReelStep] {
  let g = [0; 15]
  for i in 0..15 { g[i] = landed[i] }

  let steps: [ReelStep] = list()
  let iterations = 0

  while iterations < 10 {
    iterations = iterations + 1
    let removed = [0; 15]
    let line_row = [0; 3]
    let line_sym = [0; 3]
    let line_count = [0; 3]
    let line_win = [0.0; 3]
    let n = mark_and_pay(g, removed, line_row, line_sym, line_count, line_win)
    if n == 0 { break }

    -- read the round off the board it ran against, THEN scroll: `winning`
    -- and `shifts` name the pre-scroll board, `settled` is the post-scroll one.
    let winning = removed_out(c, removed)
    let shifts = shifts_out(c, removed)
    let step_win = total_of(n, line_win)

    scroll_reels(c, g, removed)

    push(steps, ReelStep {
      winning: winning,
      shifts: shifts,
      settled: grid_out(c, g),
      win: step_win,
    })
  }

  return steps
}

fn execute(c: ctx, v: Vars) -> outcome {
  let gsym = [0; 15]
  fill_grid(c, gsym)
  let initial_grid = grid_out(c, gsym)

  -- The board the reels landed on, kept aside: the tumble below consumes
  -- `gsym`, and the ReelStep chain has to start from the same board — that
  -- shared round 0 is the whole reason the three forms agree about anything.
  let landed = [0; 15]
  for i in 0..15 { landed[i] = gsym[i] }

  let steps: [CascadeStep] = list()
  let total_win = 0.0
  let first = true
  let iterations = 0

  -- round-0 line detail, captured once for `data.lines` (classic reveal) —
  -- a list local can't be reassigned, so we snapshot the parallel arrays
  -- instead and build the [LineWin] list once, after the cascade loop.
  let r0_n = 0
  let r0_row = [0; 3]
  let r0_sym = [0; 3]
  let r0_count = [0; 3]
  let r0_win = [0.0; 3]

  while iterations < 10 {
    iterations = iterations + 1
    let removed = [0; 15]
    let line_row = [0; 3]
    let line_sym = [0; 3]
    let line_count = [0; 3]
    let line_win = [0.0; 3]
    let n = mark_and_pay(gsym, removed, line_row, line_sym, line_count, line_win)
    if n == 0 { break }

    if first {
      r0_n = n
      for i in 0..n {
        r0_row[i] = line_row[i]
        r0_sym[i] = line_sym[i]
        r0_count[i] = line_count[i]
        r0_win[i] = line_win[i]
      }
      first = false
    }

    let step_win = total_of(n, line_win)
    total_win = total_win + step_win
    let removed_positions = removed_out(c, removed)

    remove_marked(gsym, removed)
    apply_gravity(gsym)
    fill_grid(c, gsym)

    push(steps, CascadeStep {
      grid: grid_out(c, gsym),
      removed: removed_positions,
      win: step_win,
    })
  }

  let round_lines = lines_out(c, r0_n, r0_row, r0_sym, r0_count, r0_win)
  let base_win = total_of(r0_n, r0_win)

  -- Run last, on the copy: the tumble's RNG draws stay exactly what they
  -- were before this chain existed, so adding a third form changed no
  -- board the other two already described.
  let reel_steps = reel_chain(c, landed)

  return outcome {
    win: total_win,
    vars: Vars { max_win_reached: false },
    data: SpinData.base_game {
      grid: initial_grid,
      win: total_win,
      base_win: base_win,
      lines: round_lines,
      cascade_history: steps,
      reel_steps: reel_steps,
    },
  }
}
