-- Fixture math: reads the GENERATED prelude (SYM/PAY_*) so the integration
-- test exercises the real spec -> .spin prelude path end-to-end.
record Vars { n: int }
record Feat { z: int }
record D { w: float  sym_a: int }
game "spec-integration" {
  bet_levels = [0.1, 1.0]
  max_win = 1000.0
  vars = Vars
  feature = Feat
  data = D
}
action spin { stage = base_game cost = 1.0 }
fn execute(c: ctx, v: Vars) -> outcome {
  -- выигрыш = выплата символа A на первом пороге (из прелюдии: 5.0)
  let w = PAY_A[0]
  return outcome {
    win: w,
    vars: Vars { n: 0 },
    data: D { w: w, sym_a: SYM.A },
  }
}
