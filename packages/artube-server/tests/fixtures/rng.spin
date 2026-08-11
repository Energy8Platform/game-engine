-- Игра для проверки детерминизма: в отличие от feature.spin, каждый сегмент
-- реально зовёт rng(c, 1, 1_000_000) и кладёт результат в win/data. Если
-- движок фактически не читает (server_seed, client_seed, nonce) для
-- построения последовательности бросков, идентичные сиды под разными
-- round_id разойдутся, а разные сиды — совпадут; ни то ни другое не
-- проверить на feature.spin, где exec ни разу не зовёт rng.
--
-- free_spins_awarded фиксировано (не из rng), чтобы число сегментов раунда
-- было стабильным — тест сравнивает последовательности бросков, а не их
-- количество.

record Vars {
  free_spins_awarded: int
}
record Feat { unused: int }
record Data {
  stage: str
  win: float
  roll: int
}

game "rng-game" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  data = Data
}

action spin { stage = base_game  cost = 1.0  opens = free_spin count free_spins_awarded }
action free_spin { stage = free_spins  cost = 1.0  session = true }

fn execute(c: ctx, v: Vars) -> outcome {
  let roll = rng(c, 1, 1000000)
  if action_is(c, "free_spin") {
    let w = to_float(roll) / 1000000.0
    return outcome {
      win: w,
      vars: Vars { free_spins_awarded: 0 },
      data: Data { stage: "free_spins", win: w, roll: roll },
    }
  }
  return outcome {
    win: 0.0,
    vars: Vars { free_spins_awarded: 2 },
    data: Data { stage: "base_game", win: 0.0, roll: roll },
  }
}
