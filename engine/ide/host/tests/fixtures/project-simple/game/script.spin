-- Minimal, known-good `.spin` — the exact MINIMAL fixture spin-parser's
-- own suite already proves parses cleanly (see
-- engine/core/spin-parser/tests/parse.test.ts). Used here only so
-- schema.ts's tests have a real file to read; the parser itself is
-- already covered elsewhere.
record Vars {
  max_win_reached: bool
}

enum SpinData tag stage {
  base_game {
    grid: [[int]]
    win: float
  }
}

game "demo" {
  bet_levels = [0.2, 1.0]
  max_win = 500.0
  vars = Vars
  data = SpinData
}

action spin {
  stage = base_game
  cost = 1.0
}
