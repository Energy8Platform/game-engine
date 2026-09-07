-- Half-readable on purpose: `record Broken`'s brace never closes, so the
-- parser drops that ONE record and reads everything else. What this
-- fixture exists to pin is the severity of that loss — a `.spin` this
-- parser could only half-read must degrade the game (a warning on the
-- composition screen), never stop it. See `../../schema.test.ts`.
record Broken {
  a: int

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
