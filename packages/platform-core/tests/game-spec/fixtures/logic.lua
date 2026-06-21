-- packages/platform-core/tests/game-spec/fixtures/logic.lua
function execute(state)
  -- reads PAYTABLE + SYM injected by the generated prelude
  -- total_win is a multiplier: engine computes spinWin = total_win * bet
  -- so total_win = pay = 5, bet = 2 → totalWin = 10
  local pay = PAYTABLE["A"][3]
  return {
    total_win = pay,
    matrix = {
      { SYM.A, SYM.A, SYM.A },
      { SYM.B, SYM.B, SYM.B },
      { SYM.A, SYM.B, SYM.A },
    },
  }
end
