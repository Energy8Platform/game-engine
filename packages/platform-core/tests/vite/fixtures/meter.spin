-- Минимальная игра с player-persist: метр тикает на каждом раунде.
-- Используется интеграционным тестом spinPlugin (data.persistent_state).

record Vars { dummy: int }
record Feat { dummy: int }
record Globals { meter: int }

enum SpinData tag stage {
  base_game { meter: int }
}

game "meter-game" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  globals = Globals
  data = SpinData
}

action spin { stage = base_game  cost = 1.0 }

fn execute(c: ctx, v: Vars, g: Globals) -> outcome {
  let m = g.meter + 1
  return outcome {
    win: 0.0,
    vars: Vars { dummy: 0 },
    data: SpinData.base_game { meter: m },
    globals: Globals { meter: m },
  }
}
