-- Basic slot game: 5x3 grid, 9 symbols, simple line evaluation
-- Demonstrates engine.* API usage for dev/simulation

local COLS = 5
local ROWS = 3
local NUM_SYMBOLS = 9

-- Symbol weights per reel (higher = more frequent)
local SYMBOL_WEIGHTS = {5, 7, 9, 11, 14, 17, 20, 23, 26}

-- Payouts: symbol_id → {match_3, match_4, match_5} as bet multipliers
local PAYOUTS = {
    [1] = {5, 15, 50},    -- premium 1
    [2] = {4, 12, 40},    -- premium 2
    [3] = {3, 10, 30},    -- premium 3
    [4] = {2, 8, 20},     -- mid 1
    [5] = {2, 6, 15},     -- mid 2
    [6] = {1, 4, 10},     -- low 1
    [7] = {1, 3, 8},      -- low 2
    [8] = {0.5, 2, 5},    -- low 3
    [9] = {0.5, 1.5, 4},  -- low 4
}

-- Scatter symbol (triggers free spins)
local SCATTER_ID = 1
local SCATTER_TRIGGER = 3      -- 3+ scatters = free spins
local FREE_SPINS_AWARD = 10

-- 20 paylines (standard 5x3 layout)
local PAYLINES = {
    {2,2,2,2,2},  -- middle row
    {1,1,1,1,1},  -- top row
    {3,3,3,3,3},  -- bottom row
    {1,2,3,2,1},  -- V shape
    {3,2,1,2,3},  -- inverted V
    {1,1,2,3,3},  -- top-left to bottom-right
    {3,3,2,1,1},  -- bottom-left to top-right
    {2,1,1,1,2},  -- U shape top
    {2,3,3,3,2},  -- U shape bottom
    {1,2,2,2,1},  -- shallow V
    {3,2,2,2,3},  -- shallow inverted V
    {2,1,2,3,2},  -- zigzag up
    {2,3,2,1,2},  -- zigzag down
    {1,1,2,1,1},  -- bump top
    {3,3,2,3,3},  -- bump bottom
    {1,2,1,2,1},  -- wave up
    {3,2,3,2,3},  -- wave down
    {2,2,1,2,2},  -- dip top
    {2,2,3,2,2},  -- dip bottom
    {1,3,1,3,1},  -- big zigzag
}

-- Pick a random symbol based on weights
local function pick_symbol()
    return engine.random_weighted(SYMBOL_WEIGHTS)
end

-- Generate the reel matrix
local function generate_matrix()
    local matrix = {}
    for col = 1, COLS do
        matrix[col] = {}
        for row = 1, ROWS do
            matrix[col][row] = pick_symbol()
        end
    end
    return matrix
end

-- Count scatter symbols in matrix
local function count_scatters(matrix)
    local count = 0
    for col = 1, COLS do
        for row = 1, ROWS do
            if matrix[col][row] == SCATTER_ID then
                count = count + 1
            end
        end
    end
    return count
end

-- Evaluate a single payline
local function evaluate_line(matrix, line)
    local symbol = matrix[1][line[1]]
    local count = 1

    for col = 2, COLS do
        if matrix[col][line[col]] == symbol then
            count = count + 1
        else
            break
        end
    end

    if count >= 3 and PAYOUTS[symbol] then
        return {
            symbol = symbol,
            count = count,
            win = PAYOUTS[symbol][count - 2],  -- index: 3→1, 4→2, 5→3
        }
    end

    return nil
end

-- Evaluate all paylines
local function evaluate_paylines(matrix)
    local wins = {}
    local total = 0

    for i, line in ipairs(PAYLINES) do
        local result = evaluate_line(matrix, line)
        if result then
            result.line = i
            wins[#wins + 1] = result
            total = total + result.win
        end
    end

    return wins, total
end

-- Main entry point
function execute(state)
    local matrix = generate_matrix()
    local wins, total_win = evaluate_paylines(matrix)
    local scatter_count = count_scatters(matrix)

    local variables = {}

    -- Check scatter trigger (base game only)
    if state.stage == "base_game" and scatter_count >= SCATTER_TRIGGER then
        variables.free_spins_awarded = FREE_SPINS_AWARD
        engine.log("info", "Free spins triggered! Scatters: " .. scatter_count)
    end

    return {
        total_win = total_win,
        variables = variables,
        matrix = matrix,
        wins = wins,
        scatter_count = scatter_count,
    }
end
