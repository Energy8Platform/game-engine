-- examples/spec-slot/script.logic.lua
-- Minimal demo logic; reads PAYTABLE/SYM from the generated prelude.
-- Reel weights would live here in a real game.
-- NOTE: total_win is a BET-MULTIPLIER; the engine multiplies it by the actual bet.
function execute(state)
  local roll = engine.random(1, 3)
  local win = 0
  if roll == 1 then win = PAYTABLE["A"][3] end
  return {
    total_win = win,
    matrix = {
      { SYM.A, SYM.B, SYM.C },
      { SYM.B, SYM.C, SYM.A },
      { SYM.C, SYM.A, SYM.B },
    },
  }
end
