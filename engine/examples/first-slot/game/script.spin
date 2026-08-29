-- first-slot — spike: 5x3 lines game, no bonus stage.
-- Two win-representations from ONE spin, on purpose:
--   `lines`           — single-pass evaluation of the initial grid (classic
--                        mechanic: spin, reveal wins, done).
--   `cascade_history` — the same board tumbled: winning cells removed,
--                        gravity, refill, re-evaluate, repeat (cascade
--                        mechanic consumes this instead).
-- classic mechanic ignores cascade_history; cascade mechanic ignores lines
-- (beyond round 0) and walks cascade_history instead. Same game, same
-- script, two playable shapes — switched from the IDE's composition screen.
--
-- The mechanic renders, the math pays: `win` (== `data.win`, the amount the
-- server credits) accumulates EVERY cascade round, so it will not equal
-- sum(lines[].win) whenever the tumble pays more than once. `base_win` is
-- the round-0-only total — sum(lines[].win) === base_win, always. A
-- `classic` presentation reveals `lines` + `base_win`; whichever mechanic is
-- rendering, `win` is what actually got paid.

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

enum SpinData tag stage {
  base_game {
    grid: [[int]]
    -- credited amount (cascade-inclusive) — NOT sum(lines[].win); see header.
    win: float
    -- round-0-only total; sum(lines[].win) === base_win.
    base_win: float
    lines: [LineWin]
    cascade_history: [CascadeStep]
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

fn grid_out(c: ctx, gsym: [int; 15]) -> [[int]] {
  let cols: [[int]] = list()
  for col in 0..5 {
    let rows: [int] = list()
    for row in 0..3 { push(rows, gsym[col * 3 + row]) }
    push(cols, rows)
  }
  return cols
}

fn execute(c: ctx, v: Vars) -> outcome {
  let gsym = [0; 15]
  fill_grid(c, gsym)
  let initial_grid = grid_out(c, gsym)

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

  return outcome {
    win: total_win,
    vars: Vars { max_win_reached: false },
    data: SpinData.base_game {
      grid: initial_grid,
      win: total_win,
      base_win: base_win,
      lines: round_lines,
      cascade_history: steps,
    },
  }
}
