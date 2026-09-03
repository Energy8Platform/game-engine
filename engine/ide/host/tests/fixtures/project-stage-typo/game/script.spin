-- The tagged-enum dialect declares a CLOSED set of stages — only
-- `base_game` here. `free_spin` below names `free_spins`, which this enum
-- never declares: a typo (or a stage removed from the math without
-- updating the action that still points at it). `isSpinSchema` (task 1)
-- deliberately does not judge this — it is a well-formed schema either
-- way — so the host is where this mismatch becomes a diagnostic.
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

action free_spin {
  stage = free_spins
  cost = 1.0
}
