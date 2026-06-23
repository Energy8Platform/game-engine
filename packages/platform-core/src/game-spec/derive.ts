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
  return {
    id: spec.id,
    type: 'SLOT',
    actions,
    bet_levels: [...spec.betLevels],
    max_win: { multiplier: spec.maxWin },
  };
}

function luaTable(record: Record<number, number>): string {
  const parts = Object.entries(record).map(([k, v]) => `[${k}]=${v}`);
  return `{${parts.join(', ')}}`;
}

export function toLuaPrelude(spec: GameSpec): string {
  const lines: string[] = ['-- AUTO-GENERATED from game.spec.ts — do not edit'];
  lines.push(`SPEC = { cols = ${spec.grid.cols}, rows = ${spec.grid.rows}, max_win = ${spec.maxWin} }`);

  const symNames = spec.symbols.map((s) => `"${s.id}"`).join(', ');
  lines.push(`SYMBOLS = { ${symNames} }`);

  const symIndex = spec.symbols.map((s, i) => `${s.id}=${i + 1}`).join(', ');
  lines.push(`SYM = { ${symIndex} }`);

  const payEntries = spec.symbols
    .filter((s) => s.pay)
    .map((s) => `  ${s.id} = ${luaTable(s.pay as Record<number, number>)}`);
  lines.push(`PAYTABLE = {\n${payEntries.join(',\n')}\n}`);

  const valEntries = spec.symbols
    .filter((s) => s.value !== undefined)
    .map((s) => `  ${s.id} = ${Array.isArray(s.value) ? `{${s.value.join(', ')}}` : s.value}`);
  if (valEntries.length) lines.push(`VALUES = {\n${valEntries.join(',\n')}\n}`);

  return lines.join('\n') + '\n';
}

export function toModeMap(spec: GameSpec): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, action] of Object.entries(spec.actions)) {
    if ((action.role ?? 'base') === 'free') continue;
    map[key] = action.mode ?? key.toUpperCase();
  }
  return map;
}

export function toMathModes(spec: GameSpec): MathModeSpec[] {
  const modes: MathModeSpec[] = [];
  for (const [key, action] of Object.entries(spec.actions)) {
    if ((action.role ?? 'base') === 'free') continue;
    modes.push({ action: key, mode: action.mode ?? key.toUpperCase(), costMultiplier: action.cost ?? 1 });
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
