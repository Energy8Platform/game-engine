import type { Answers } from '../answers';

export function genLuaLogic(a: Answers): string {
  const cascade = a.cascades === true;
  const ret = cascade
    ? `  return {
    total_win = win,          -- bet-multiplier; the platform multiplies by the actual bet
    cascades = {},            -- TODO: emit cascade steps { winning, removed, new, grid }
    free_spins = free_spins_result,
    -- The engine reads these VARIABLES (not the nested free_spins table) to open / retrigger the
    -- free-spins SESSION. Without them, free_spin would fail "requires an active session".
    variables = { free_spins_awarded = fs_awarded, retrigger_spins = retrigger_awarded },
  }`
    : `  return {
    total_win = win,          -- bet-multiplier
    matrix = grid,            -- 2D array of SYM.* ids
    wins = {},                -- TODO: emit line/way wins
    free_spins = free_spins_result,
    -- The engine reads these VARIABLES (not the nested free_spins table) to open / retrigger the
    -- free-spins SESSION. Without them, free_spin would fail "requires an active session".
    variables = { free_spins_awarded = fs_awarded, retrigger_spins = retrigger_awarded },
  }`;
  return `-- Game logic. The spec-derived prelude (SPEC/SYMBOLS/SYM/PAYTABLE) is injected above this file.
-- Reel weights / RTP tuning live here. Implement your mechanic; return a bet-multiplier in total_win.
function execute(state)
  -- state.action: 'spin' | 'ante' | 'buy_bonus' | 'free_spin'
  -- state.bet, state.action_config.feature_data
  local action = state.action or 'spin'
  local grid = {}
  for c = 1, SPEC.cols do
    grid[c] = {}
    for r = 1, SPEC.rows do
      grid[c][r] = engine.random(1, #SYMBOLS)
    end
  end

  -- Placeholder random payout (replace with your real mechanic).
  local win = 0
  local free_spins_result = nil
  local fs_awarded = 0        -- engine VARIABLE: spins this round awards (opens the session)
  local retrigger_awarded = 0 -- engine VARIABLE: extra spins a free_spin retrigger awards

  if action == 'buy_bonus' then
    -- Player bought free spins: always award them, no base win.
    fs_awarded = 10
    free_spins_result = { awarded = fs_awarded, total = fs_awarded }

  elseif action == 'free_spin' then
    -- Free-spin round: random payout + small retrigger chance (~5%).
    local roll = engine.random(1, 1000)
    if roll <= 400 then        -- ~40% small win (higher hit-rate in bonus)
      win = engine.random(1, 8) * 0.3
    elseif roll <= 440 then    -- ~4% medium win
      win = engine.random(10, 50)
    elseif roll <= 442 then    -- ~0.2% large win
      win = engine.random(100, 800)
    end
    -- Retrigger: ~5% chance to award extra spins (read via retrigger_spins).
    local retrigger_roll = engine.random(1, 100)
    if retrigger_roll <= 5 then
      retrigger_awarded = 5
      free_spins_result = { awarded = retrigger_awarded, total = retrigger_awarded }
    end

  elseif action == 'ante' then
    -- Ante (paid-boost) spin: same payouts as base but higher free-spins trigger (~5%).
    local roll = engine.random(1, 1000)
    if roll <= 250 then        -- ~25% small win
      win = engine.random(1, 5) * 0.2
    elseif roll <= 270 then    -- ~2% medium win
      win = engine.random(5, 30)
    elseif roll <= 272 then    -- ~0.2% large win
      win = engine.random(50, 500)
    end
    local fs_roll = engine.random(1, 100)
    if fs_roll <= 5 then       -- ~5% free-spins trigger
      fs_awarded = 8
      free_spins_result = { awarded = fs_awarded, total = fs_awarded }
    end

  else
    -- Base spin ('spin'): random payout + small free-spins trigger (~2%).
    local roll = engine.random(1, 1000)
    if roll <= 250 then        -- ~25% small win
      win = engine.random(1, 5) * 0.2
    elseif roll <= 270 then    -- ~2% medium win
      win = engine.random(5, 30)
    elseif roll <= 272 then    -- ~0.2% large win
      win = engine.random(50, 500)
    end
    local fs_roll = engine.random(1, 100)
    if fs_roll <= 2 then       -- ~2% free-spins trigger
      fs_awarded = 8
      free_spins_result = { awarded = fs_awarded, total = fs_awarded }
    end
  end

${ret}
end
`;
}
