-- session-fixture — the smallest game that opens a SESSION.
--
-- A round on e8-server is `StartRound` then `Step(round_id, action)` until
-- `round_complete`. `first-slot` can never show that: every one of its
-- rounds completes on the first response. This fixture exists to be the
-- other case, deterministically — `action spin` ALWAYS awards 2 free spins,
-- so `StartRound` always answers `round_complete: false`,
-- `next_actions: ["free_spin"]`, `spins_remaining: 2`, and it takes exactly
-- two `Step` calls to finish the round.
--
-- Deliberately tiny: 5x3, three symbols, three horizontal lines, no cascade.
-- The `SpinData` shape is `first-slot`'s though (`grid`/`win`/`base_win`/
-- `lines`/`reel_steps`), so both stages bind to the shipped `classic`
-- mechanic (`grid` + `base_win` + `lines`) and to `first-slot`'s `reel-step`
-- one (`grid` + `reel_steps`) without a fixture-specific presentation.

record Vars {
  -- the count `action spin`'s `opens` clause reads; always 2, see do_base.
  free_spins_awarded: int
  -- the session's early-close flag. Never set here — the session ends by
  -- running out of spins, which is the case this fixture exists to drive.
  max_win_reached: bool
}

-- Required by the compiler ("the game block needs 'feature = <record>'"),
-- not by this fixture: nothing reads it, and no action declares an inline
-- `feature { ... }` block. The session's length comes from the var
-- `action spin`'s `opens` clause counts, never from here.
record Feat {
  spins: int
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

-- One ReelStep round: the cells that paid, how far each reel then scrolled
-- DOWN, the board it settled onto, and what the round paid. This fixture
-- records at most one — enough for a presentation to walk, and the chain
-- itself is not what is under test here.
record ReelStep {
  winning: [CellPos]
  shifts: [int]
  settled: [[int]]
  win: float
}

enum SpinData tag stage {
  base_game {
    grid: [[int]]
    win: float
    base_win: float
    lines: [LineWin]
    reel_steps: [ReelStep]
  }
  free_spins {
    grid: [[int]]
    win: float
    base_win: float
    lines: [LineWin]
    reel_steps: [ReelStep]
  }
}

game "session-fixture" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  data = SpinData
}

action spin {
  stage = base_game
  cost = 1.0
  opens = free_spin count free_spins_awarded
}

action free_spin {
  stage = free_spins
  cost = 1.0
  session = true
  ends when max_win_reached
}

-- ============================================================
-- 5 reels x 3 rows, flat index = col*3+row. 3 symbols, rarer = higher pay.
-- ============================================================

const SYM_W: [int; 3] = [10, 20, 30]
const PAY_VAL: [float; 9] = [
  2.0, 5.0, 10.0,
  1.0, 2.0, 5.0,
  0.5, 1.0, 2.0,
]

fn fill_grid(c: ctx, g: [int; 15]) {
  for col in 0..5 {
    for row in 0..3 {
      let i = col * 3 + row
      if g[i] == 0 { g[i] = rng_weighted(c, SYM_W) + 1 }
    }
  }
}

-- The three horizontal lines, left to right. Marks winning cells in `won`,
-- fills the parallel out-arrays (one slot per row) and returns their count.
fn mark_and_pay(g: [int; 15], won: [int; 15], line_row: [int; 3], line_sym: [int; 3], line_count: [int; 3], line_win: [float; 3]) -> int {
  let n = 0
  for row in 0..3 {
    let sym = g[row]
    let count = 1
    while count < 5 {
      if g[count * 3 + row] != sym { break }
      count = count + 1
    }
    if count >= 3 {
      for k in 0..count { won[k * 3 + row] = 1 }
      line_row[n] = row
      line_sym[n] = sym
      line_count[n] = count
      line_win[n] = PAY_VAL[(sym - 1) * 3 + (count - 3)]
      n = n + 1
    }
  }
  return n
}

fn total_of(n: int, line_win: [float; 3]) -> float {
  let t = 0.0
  for i in 0..n { t = t + line_win[i] }
  return t
}

fn grid_out(c: ctx, g: [int; 15]) -> [[int]] {
  let cols: [[int]] = list()
  for col in 0..5 {
    let rows: [int] = list()
    for row in 0..3 { push(rows, g[col * 3 + row]) }
    push(cols, rows)
  }
  return cols
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

fn won_out(c: ctx, won: [int; 15]) -> [CellPos] {
  let l: [CellPos] = list()
  for col in 0..5 {
    for row in 0..3 {
      if won[col * 3 + row] == 1 { push(l, CellPos { col: col, row: row }) }
    }
  }
  return l
}

fn shifts_of(won: [int; 15], col: int) -> int {
  let n = 0
  for row in 0..3 {
    if won[col * 3 + row] == 1 { n = n + 1 }
  }
  return n
}

fn shifts_out(c: ctx, won: [int; 15]) -> [int] {
  let l: [int] = list()
  for col in 0..5 { push(l, shifts_of(won, col)) }
  return l
}

-- Scroll every reel down by its own shift, in place; fresh symbols enter at
-- the top. Written bottom-up so each row reads a source row this pass has
-- not overwritten yet.
fn scroll_reels(c: ctx, g: [int; 15], won: [int; 15]) {
  for col in 0..5 {
    let n = shifts_of(won, col)
    if n > 3 { n = 3 }
    if n > 0 {
      for k in 0..3 {
        let row = 2 - k
        let i = col * 3 + row
        if row >= n {
          g[i] = g[col * 3 + (row - n)]
        } else {
          g[i] = rng_weighted(c, SYM_W) + 1
        }
      }
    }
  }
}

-- At most one round: a spin that paid gets the chain a `reel-step`
-- presentation walks, a spin that paid nothing gets an empty list. Mutates
-- `g`, so every caller reads its landed board out BEFORE calling this.
fn reel_steps_out(c: ctx, g: [int; 15], won: [int; 15], n: int, line_win: [float; 3]) -> [ReelStep] {
  let steps: [ReelStep] = list()
  if n > 0 {
    let winning = won_out(c, won)
    let shifts = shifts_out(c, won)
    let step_win = total_of(n, line_win)
    scroll_reels(c, g, won)
    push(steps, ReelStep { winning: winning, shifts: shifts, settled: grid_out(c, g), win: step_win })
  }
  return steps
}

fn execute(c: ctx, v: Vars) -> outcome {
  if action_is(c, "free_spin") { return do_free_spin(c, v) }
  return do_base(c, v)
}

-- ALWAYS 2, win or no win: the session must open on every single spin, or
-- the tests that drive it would have to spin until it did.
fn do_base(c: ctx, v: Vars) -> outcome {
  let g = [0; 15]
  let won = [0; 15]
  let line_row = [0; 3]
  let line_sym = [0; 3]
  let line_count = [0; 3]
  let line_win = [0.0; 3]

  fill_grid(c, g)
  let n = mark_and_pay(g, won, line_row, line_sym, line_count, line_win)
  let landed = grid_out(c, g)
  let win = total_of(n, line_win)

  -- Both bound before the literal: the compiler skips output values in
  -- simulation, so anything that draws RNG (reel_steps_out scrolls, and a
  -- scroll refills) is rejected inside one.
  let lines = lines_out(c, n, line_row, line_sym, line_count, line_win)
  let steps = reel_steps_out(c, g, won, n, line_win)

  return outcome {
    win: win,
    vars: Vars { free_spins_awarded: 2, max_win_reached: false },
    data: SpinData.base_game {
      grid: landed,
      win: win,
      base_win: win,
      lines: lines,
      reel_steps: steps,
    },
  }
}

fn do_free_spin(c: ctx, v: Vars) -> outcome {
  let g = [0; 15]
  let won = [0; 15]
  let line_row = [0; 3]
  let line_sym = [0; 3]
  let line_count = [0; 3]
  let line_win = [0.0; 3]

  fill_grid(c, g)
  let n = mark_and_pay(g, won, line_row, line_sym, line_count, line_win)
  let landed = grid_out(c, g)
  let win = total_of(n, line_win)

  -- Both bound before the literal: the compiler skips output values in
  -- simulation, so anything that draws RNG (reel_steps_out scrolls, and a
  -- scroll refills) is rejected inside one.
  let lines = lines_out(c, n, line_row, line_sym, line_count, line_win)
  let steps = reel_steps_out(c, g, won, n, line_win)

  return outcome {
    win: win,
    vars: Vars { free_spins_awarded: 0, max_win_reached: false },
    data: SpinData.free_spins {
      grid: landed,
      win: win,
      base_win: win,
      lines: lines,
      reel_steps: steps,
    },
  }
}
