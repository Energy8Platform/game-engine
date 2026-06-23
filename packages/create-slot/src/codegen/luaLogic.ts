import type { Answers } from '../answers';

export function genLuaLogic(a: Answers): string {
  const cascade = a.cascades === true;
  const ret = cascade
    ? `  return {
    total_win = win,          -- bet-multiplier; the platform multiplies by the actual bet
    cascades = {},            -- TODO: emit cascade steps { winning, removed, new, grid }
  }`
    : `  return {
    total_win = win,          -- bet-multiplier
    matrix = grid,            -- 2D array of SYM.* ids
    wins = {},                -- TODO: emit line/way wins
  }`;
  return `-- Game logic. The spec-derived prelude (SPEC/SYMBOLS/SYM/PAYTABLE) is injected above this file.
-- Reel weights / RTP tuning live here. Implement your mechanic; return a bet-multiplier in total_win.
function execute(state)
  -- state.action ('spin' | 'free_spin' | 'buy_bonus'), state.bet, state.action_config.feature_data
  local grid = {}
  for c = 1, SPEC.cols do
    grid[c] = {}
    for r = 1, SPEC.rows do
      grid[c][r] = engine.random(1, #SYMBOLS)
    end
  end
  local win = 0   -- TODO: evaluate ${cascade ? 'cluster/cascade' : 'line/way'} wins from PAYTABLE
${ret}
end
`;
}
