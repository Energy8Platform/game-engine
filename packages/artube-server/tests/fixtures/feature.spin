-- Детерминированная игра для тестов: spin всегда открывает 3 фриспина,
-- каждый фриспин платит ровно 1.0 множитель ставки. Ни одного вызова rng,
-- поэтому ожидания в тестах — точные числа, а не диапазоны.

record Vars {
  free_spins_awarded: int
  retrigger_spins: int
}
record Feat { buy: int }
record Data {
  stage: str
  win: float
}

game "feature-game" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  data = Data
}

action spin { stage = base_game  cost = 1.0  opens = free_spin count free_spins_awarded }
action buy_bonus { stage = buy_bonus  cost = 5.0  feature { buy = 1 }  opens = free_spin count free_spins_awarded }
action free_spin { stage = free_spins  cost = 1.0  session = true  extends = retrigger_spins }

fn execute(c: ctx, v: Vars) -> outcome {
  if action_is(c, "free_spin") {
    return outcome {
      win: 1.0,
      vars: Vars { free_spins_awarded: 0, retrigger_spins: 0 },
      data: Data { stage: "free_spins", win: 1.0 },
    }
  }
  return outcome {
    win: 0.0,
    vars: Vars { free_spins_awarded: 3, retrigger_spins: 0 },
    data: Data { stage: "base_game", win: 0.0 },
  }
}
