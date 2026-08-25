-- Детерминированный платящий фикстур для регресс-теста валюты в toLegacy.
-- База платит 2.0 множителя и открывает 3 фриспина по 1.0 — раунд из
-- нескольких спинов, чтобы задеть обе ветки totalWin (r.win и r.total_win).
-- Ни одного rng ⇒ ожидания в тесте — точные числа, а не диапазоны.

record Vars {
  free_spins_awarded: int
  retrigger_spins: int
}
record Feat { dummy: int }
record Data {
  stage: str
  win: float
}

game "payer-game" {
  bet_levels = [1.0, 10.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  data = Data
}

action spin { stage = base_game  cost = 1.0  opens = free_spin count free_spins_awarded }
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
    win: 2.0,
    vars: Vars { free_spins_awarded: 3, retrigger_spins: 0 },
    data: Data { stage: "base_game", win: 2.0 },
  }
}
