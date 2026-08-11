-- Игра без фичи: единственное действие one_shot закрывает раунд тем же
-- шагом, ничего не открывает. Нужна тесту на "простой раунд без фичи" —
-- openEntry должен вернуть isFinal: true сразу после StartRound, без
-- единого Step.

record Vars {
  unused: int
}
record Feat { unused: int }
record Data {
  stage: str
  win: float
}

game "one-shot-game" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  data = Data
}

action one_shot { stage = base_game  cost = 1.0 }

fn execute(c: ctx, v: Vars) -> outcome {
  return outcome {
    win: 0.0,
    vars: Vars { unused: 0 },
    data: Data { stage: "base_game", win: 0.0 },
  }
}
