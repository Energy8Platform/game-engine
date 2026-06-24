-- examples/spec-slot/script.logic.lua
-- Demo logic; reads PAYTABLE/SYM from the generated prelude.
-- Branches on state.action so buy_bonus/ante/free_spin actually work in the demo.
-- NOTE: total_win is a BET-MULTIPLIER; the engine multiplies it by the actual bet.
function execute(state)
  local action = state.action or 'spin'
  local win = 0
  local free_spins_result = nil

  if action == 'buy_bonus' then
    -- Player bought free spins: always award them, no base win.
    free_spins_result = { awarded = 10, total = 10 }

  elseif action == 'free_spin' then
    -- Free-spin payout with small retrigger chance (~5%).
    local roll = engine.random(1, 3)
    if roll == 1 then win = PAYTABLE["A"][3] end
    local retrigger_roll = engine.random(1, 100)
    if retrigger_roll <= 5 then
      free_spins_result = { awarded = 5, total = 5 }
    end

  elseif action == 'ante' then
    -- Ante spin: same payout roll but ~5% free-spins trigger.
    local roll = engine.random(1, 3)
    if roll == 1 then win = PAYTABLE["A"][3] end
    local fs_roll = engine.random(1, 100)
    if fs_roll <= 5 then
      free_spins_result = { awarded = 8, total = 8 }
    end

  else
    -- Base spin ('spin'): payout roll + ~2% free-spins trigger.
    local roll = engine.random(1, 3)
    if roll == 1 then win = PAYTABLE["A"][3] end
    local fs_roll = engine.random(1, 100)
    if fs_roll <= 2 then
      free_spins_result = { awarded = 8, total = 8 }
    end
  end

  return {
    total_win = win,
    matrix = {
      { SYM.A, SYM.B, SYM.C },
      { SYM.B, SYM.C, SYM.A },
      { SYM.C, SYM.A, SYM.B },
    },
    free_spins = free_spins_result,
  }
end
