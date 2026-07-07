// packages/platform-core/src/game-spec/derive.ts
import type { GameDefinition, ActionDefinition, TransitionRule } from '../lua/types';
import type { GameSpec, ActionSpec, ActionRole, MathModeSpec, PaytableView } from './types';

function freeActionKey(spec: GameSpec): string | undefined {
  return Object.keys(spec.actions).find((k) => spec.actions[k].role === 'free');
}

function defaultStage(role: ActionRole): string {
  return role === 'free' ? 'free_spins' : 'base_game';
}

function defaultTransitions(role: ActionRole, freeKey: string | undefined, actionKey: string): TransitionRule[] {
  if (role === 'free') {
    if (!freeKey) return [];
    return [
      { condition: 'retrigger_spins > 0', add_spins_var: 'retrigger_spins', next_actions: [freeKey] },
      { condition: 'always', next_actions: [freeKey] },
    ];
  }
  // base | buy — always include an "always" fallback so the engine can route back
  const transitions: TransitionRule[] = [];
  if (freeKey) {
    transitions.push({
      condition: 'free_spins_awarded > 0',
      creates_session: true,
      next_actions: [freeKey],
      session_config: { total_spins_var: 'free_spins_awarded' },
    });
  }
  transitions.push({ condition: 'always', next_actions: [actionKey] });
  return transitions;
}

function toActionDefinition(key: string, action: ActionSpec, freeKey: string | undefined): ActionDefinition {
  const role = action.role ?? 'base';
  const transitions = action.transitions ?? defaultTransitions(role, freeKey, key);
  if (role === 'free') {
    return {
      stage: action.stage ?? defaultStage(role),
      debit: 'none',
      credit: 'defer',
      requires_session: true,
      transitions,
      ...(action.feature ? { feature_data: action.feature } : {}),
    };
  }
  return {
    stage: action.stage ?? defaultStage(role),
    debit: 'bet',
    cost_multiplier: action.cost ?? 1,
    credit: role === 'buy' ? 'none' : 'win',
    transitions,
    ...(action.feature ? { feature_data: action.feature } : {}),
  };
}

export function toGameDefinition(spec: GameSpec): GameDefinition {
  const freeKey = freeActionKey(spec);
  const actions: Record<string, ActionDefinition> = {};
  for (const [key, action] of Object.entries(spec.actions)) {
    actions[key] = toActionDefinition(key, action, freeKey);
  }
  const def: GameDefinition = {
    id: spec.id,
    type: 'SLOT',
    // Bare filename — the platform resolves it to games/{id}/script.lua. Required so the exported
    // config.json points at the uploaded script.
    script_path: spec.scriptPath ?? 'script.lua',
    actions,
    bet_levels: [...spec.betLevels],
    max_win: { multiplier: spec.maxWin },
  };
  if (spec.sessionTtl) def.session_ttl = spec.sessionTtl;
  if (spec.persistentState) def.persistent_state = { ...spec.persistentState };
  return def;
}

/** Число с гарантированной float-формой для SpinML (10 → "10.0"). */
function spinF(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/**
 * The generated .spin prelude: SPEC/SYM as const groups,
 * SYMBOLS as a str array, the paytable as indexable threshold/payout arrays
 * (PAY_COUNTS + PAY_<ID>, 0.0 = no pay at that threshold), VALUES as
 * VAL_<ID>. Prepended to the author's script.spin by buildSpinScript.
 */
export function toSpinPrelude(spec: GameSpec): string {
  const lines: string[] = ['-- AUTO-GENERATED from game.spec.ts — do not edit'];
  lines.push(
    `const SPEC = { cols: ${spec.grid.cols}, rows: ${spec.grid.rows}, cells: ${spec.grid.cols * spec.grid.rows}, max_win: ${spinF(spec.maxWin)} }`,
  );

  const symNames = spec.symbols.map((s) => `"${s.id}"`).join(', ');
  lines.push(`const SYMBOLS: [str; ${spec.symbols.length}] = [${symNames}]`);
  lines.push(`const N_SYMBOLS: int = ${spec.symbols.length}`);

  const symIndex = spec.symbols.map((s, i) => `${s.id}: ${i + 1}`).join(', ');
  lines.push(`-- 1-based индексы символов (порядок SYMBOLS)`);
  lines.push(`const SYM = { ${symIndex} }`);

  const paying = spec.symbols.filter((s) => s.pay);
  if (paying.length) {
    const counts = Array.from(
      new Set(paying.flatMap((s) => Object.keys(s.pay as Record<number, number>).map(Number))),
    ).sort((a, b) => a - b);
    lines.push(`-- пейтейбл: пороги count + выплата на порог (0.0 = нет выплаты)`);
    lines.push(`const PAY_COUNTS: [int; ${counts.length}] = [${counts.join(', ')}]`);
    for (const s of paying) {
      const pay = s.pay as Record<number, number>;
      const row = counts.map((c) => spinF(pay[c] ?? 0));
      lines.push(`const PAY_${s.id}: [float; ${counts.length}] = [${row.join(', ')}]`);
    }
  }

  for (const s of spec.symbols) {
    if (s.value === undefined) continue;
    if (Array.isArray(s.value)) {
      lines.push(`const VAL_${s.id}: [int; ${s.value.length}] = [${s.value.join(', ')}]`);
    } else {
      lines.push(`const VAL_${s.id}: int = ${s.value}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function toModeMap(spec: GameSpec): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, action] of Object.entries(spec.actions)) {
    const role = action.role ?? 'base';
    if (role === 'free') continue;
    const mode = action.mode ?? (role === 'base' ? 'BASE' : key.toUpperCase());
    map[key] = mode;
  }
  return map;
}

export function toMathModes(spec: GameSpec): MathModeSpec[] {
  const modes: MathModeSpec[] = [];
  for (const [key, action] of Object.entries(spec.actions)) {
    const role = action.role ?? 'base';
    if (role === 'free') continue;
    const mode = action.mode ?? (role === 'base' ? 'BASE' : key.toUpperCase());
    modes.push({
      action: key,
      mode,
      costMultiplier: action.cost ?? 1,
      ...(typeof action.rtp === 'number' ? { rtp: action.rtp } : {}),
      maxWin: action.maxWin ?? spec.maxWin,
    });
  }
  return modes;
}

export function toPaytableView(spec: GameSpec): PaytableView {
  return {
    symbols: spec.symbols
      .filter((s) => s.pay)
      .map((s) => ({ id: s.id, name: s.name ?? s.id, kind: s.kind, pay: { ...(s.pay as Record<number, number>) } })),
  };
}
