import type { Answers } from '../answers';

/**
 * Skeleton `script.spin` — the SpinML math the scaffold starts from.
 * The spec prelude (SPEC / SYMBOLS / SYM / PAY_*) is prepended by
 * buildSpinScript, so this file only holds the game's own declarations
 * and `execute`. It compiles and plays out of the box: uniform reels,
 * placeholder pays, free spins with a small retrigger.
 */
export function genSpinLogic(a: Answers): string {
  return `-- Game math (SpinML). The spec-derived prelude (SPEC/SYMBOLS/SYM/PAY_*)
-- is prepended by buildSpinScript — tune weights here, keep pays in game.spec.ts.
-- Contract: execute returns outcome{win, vars, data}; sessions open/extend/end
-- from the DECLARED transitions below (no manual session management).

record Vars {
  free_spins_awarded: int
  retrigger_spins: int
  max_win_reached: bool
}

record Feat {
  buy: int
  ante: int
}

record Data {
  stage: str
  grid: [[int]]
  win: float
  free_spins_awarded: int
}

game "${a.id}" {
  bet_levels = [0.01, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 10000.0, 100000.0, 1000000.0]
  max_win = 5000.0
  vars = Vars
  feature = Feat
  data = Data
}

action spin {
  stage = base_game
  cost = 1.0
  opens = free_spin count free_spins_awarded
}

action ante {
  stage = base_game
  cost = 1.5
  feature { ante = 1 }
  opens = free_spin count free_spins_awarded
}

action buy_bonus {
  stage = buy_bonus
  cost = 100.0
  feature { buy = 1 }
  opens = free_spin count free_spins_awarded
}

action free_spin {
  stage = free_spins
  cost = 1.0
  session = true
  extends = retrigger_spins
  ends when max_win_reached
}

-- равновероятная сетка-заглушка: замени на веса своего механика
fn fill_grid(c: ctx, g: [int; 64]) {
  for i in 0..SPEC.cells {
    g[i] = rng(c, 1, N_SYMBOLS)
  }
}

fn grid_out(c: ctx, g: [int; 64]) -> [[int]] {
  let rowsv: [[int]] = list()
  for col in 0..SPEC.cols {
    let rowv: [int] = list()
    for row in 0..SPEC.rows {
      push(rowv, g[col * SPEC.rows + row])
    }
    push(rowsv, rowv)
  }
  return rowsv
}

fn execute(c: ctx, v: Vars) -> outcome {
  let g = [0; 64]
  fill_grid(c, g)

  -- плейсхолдерная математика: замени на свой механик (${a.mechanic})
  if action_is(c, "buy_bonus") {
    return outcome {
      win: 0.0,
      vars: Vars { free_spins_awarded: 10, retrigger_spins: 0, max_win_reached: false },
      data: Data { stage: "buy_bonus", grid: grid_out(c, g), win: 0.0, free_spins_awarded: 10 },
    }
  }

  if action_is(c, "free_spin") {
    let win = 0.0
    let retrigger = 0
    let roll = rng(c, 1, 1000)
    if roll <= 300 { win = to_float(rng(c, 1, 20)) / 2.0 }
    if roll <= 50 { retrigger = 2 }
    return outcome {
      win: win,
      vars: Vars {
        free_spins_awarded: 0,
        retrigger_spins: retrigger,
        max_win_reached: win >= SPEC.max_win,
      },
      data: Data { stage: "free_spins", grid: grid_out(c, g), win: win, free_spins_awarded: 0 },
    }
  }

  -- base game: spin и ante (у ante выше шанс фриспинов)
  let win = 0.0
  let fs = 0
  let fs_th = 20
  if action_is(c, "ante") { fs_th = 30 }
  let roll = rng(c, 1, 1000)
  if roll <= 200 { win = to_float(rng(c, 1, 10)) / 2.0 }
  if roll <= fs_th { fs = 10 }
  return outcome {
    win: win,
    vars: Vars { free_spins_awarded: fs, retrigger_spins: 0, max_win_reached: false },
    data: Data { stage: "base_game", grid: grid_out(c, g), win: win, free_spins_awarded: fs },
  }
}
`;
}
