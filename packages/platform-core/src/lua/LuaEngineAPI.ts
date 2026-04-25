import type { GameDefinition } from './types';
import fengari from 'fengari';

const { lua, lauxlib } = fengari;
const { to_luastring, to_jsstring } = fengari;

export type RngFunction = () => number;

/** Cache for to_luastring() results — avoids re-encoding the same keys every iteration */
const luaStringCache = new Map<string, Uint8Array>();

export function cachedToLuastring(s: string): Uint8Array {
  let cached = luaStringCache.get(s);
  if (!cached) {
    cached = to_luastring(s);
    luaStringCache.set(s, cached);
  }
  return cached;
}

/**
 * Seeded xoshiro128** PRNG for deterministic simulation/replay.
 * Period: 2^128 - 1
 */
export function createSeededRng(seed: number): RngFunction {
  let s0 = (seed >>> 0) | 1;
  let s1 = (seed * 1103515245 + 12345) >>> 0;
  let s2 = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
  let s3 = (seed * 1442695040888963407 + 6364136223846793005) >>> 0;

  return (): number => {
    const result = (((s1 * 5) << 7) * 9) >>> 0;
    const t = s1 << 9;

    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;

    return result / 4294967296;
  };
}

/**
 * Implements and registers all platform `engine.*` functions into a Lua state.
 */
export class LuaEngineAPI {
  private rng: RngFunction;
  private logger: (level: string, msg: string) => void;
  private gameDefinition: GameDefinition;

  constructor(
    gameDefinition: GameDefinition,
    rng?: RngFunction,
    logger?: (level: string, msg: string) => void,
  ) {
    this.gameDefinition = gameDefinition;
    this.rng = rng ?? Math.random;
    this.logger = logger ?? ((level, msg) => {
      const fn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
        : level === 'debug' ? console.debug
        : console.log;
      fn(`[Lua:${level}] ${msg}`);
    });
  }

  /** Register `engine` global table on the Lua state */
  register(L: any): void {
    // Create the `engine` table
    lua.lua_newtable(L);

    this.registerFunction(L, 'random', (LS: any) => {
      const min = lauxlib.luaL_checkinteger(LS, 1);
      const max = lauxlib.luaL_checkinteger(LS, 2);
      const result = this.random(Number(min), Number(max));
      lua.lua_pushinteger(LS, result);
      return 1;
    });

    this.registerFunction(L, 'random_float', (LS: any) => {
      lua.lua_pushnumber(LS, this.randomFloat());
      return 1;
    });

    this.registerFunction(L, 'random_weighted', (LS: any) => {
      lauxlib.luaL_checktype(LS, 1, lua.LUA_TTABLE);
      const weights: number[] = [];
      const len = lua.lua_rawlen(LS, 1);
      for (let i = 1; i <= len; i++) {
        lua.lua_rawgeti(LS, 1, i);
        weights.push(lua.lua_tonumber(LS, -1));
        lua.lua_pop(LS, 1);
      }
      const result = this.randomWeighted(weights);
      lua.lua_pushinteger(LS, result);
      return 1;
    });

    this.registerFunction(L, 'shuffle', (LS: any) => {
      lauxlib.luaL_checktype(LS, 1, lua.LUA_TTABLE);
      const arr: unknown[] = [];
      const len = lua.lua_rawlen(LS, 1);
      for (let i = 1; i <= len; i++) {
        lua.lua_rawgeti(LS, 1, i);
        arr.push(luaToJS(LS, -1));
        lua.lua_pop(LS, 1);
      }
      const shuffled = this.shuffle(arr);
      pushJSArray(LS, shuffled);
      return 1;
    });

    this.registerFunction(L, 'log', (LS: any) => {
      const level = to_jsstring(lauxlib.luaL_checkstring(LS, 1));
      const msg = to_jsstring(lauxlib.luaL_checkstring(LS, 2));
      this.logger(level, msg);
      return 0;
    });

    this.registerFunction(L, 'get_config', (LS: any) => {
      const config = this.getConfig();
      pushJSObject(LS, config);
      return 1;
    });

    // Set the table as global `engine`
    lua.lua_setglobal(L, to_luastring('engine'));
  }

  // ─── engine.* implementations ─────────────────────────

  random(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  randomFloat(): number {
    return this.rng();
  }

  randomWeighted(weights: number[]): number {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = this.rng() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll < 0) return i + 1; // 1-based index
    }
    return weights.length; // fallback to last
  }

  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  getConfig(): Record<string, unknown> {
    const def = this.gameDefinition;
    let betLevels: number[] = [];
    if (Array.isArray(def.bet_levels)) {
      betLevels = def.bet_levels;
    } else if (def.bet_levels && 'levels' in def.bet_levels && def.bet_levels.levels) {
      betLevels = def.bet_levels.levels;
    }
    return {
      id: def.id,
      type: def.type,
      bet_levels: betLevels,
    };
  }

  // ─── Helpers ──────────────────────────────────────────

  private registerFunction(L: any, name: string, fn: (L: any) => number): void {
    lua.lua_pushcfunction(L, fn);
    lua.lua_setfield(L, -2, to_luastring(name));
  }
}

// ─── Lua ↔ JS marshalling ───────────────────────────────

/** Read a Lua value at the given stack index and return its JS equivalent */
export function luaToJS(L: any, idx: number): unknown {
  const type = lua.lua_type(L, idx);

  switch (type) {
    case lua.LUA_TNIL:
      return null;

    case lua.LUA_TBOOLEAN:
      return lua.lua_toboolean(L, idx);

    case lua.LUA_TNUMBER:
      if (lua.lua_isinteger(L, idx)) {
        return Number(lua.lua_tointeger(L, idx));
      }
      return lua.lua_tonumber(L, idx);

    case lua.LUA_TSTRING:
      return to_jsstring(lua.lua_tostring(L, idx));

    case lua.LUA_TTABLE:
      return luaTableToJS(L, idx);

    default:
      return null;
  }
}

/** Convert a Lua table to a JS object or array */
function luaTableToJS(L: any, idx: number): Record<string, unknown> | unknown[] {
  // Normalize index to absolute
  if (idx < 0) idx = lua.lua_gettop(L) + idx + 1;

  // Check if it's an array (sequential integer keys starting at 1)
  const len = lua.lua_rawlen(L, idx);
  if (len > 0) {
    // Verify it's a pure array by checking key 1 exists
    lua.lua_rawgeti(L, idx, 1);
    const hasFirst = lua.lua_type(L, -1) !== lua.LUA_TNIL;
    lua.lua_pop(L, 1);

    if (hasFirst) {
      // Check if there are also string keys (mixed table)
      let hasStringKeys = false;
      lua.lua_pushnil(L);
      while (lua.lua_next(L, idx) !== 0) {
        lua.lua_pop(L, 1); // pop value
        if (lua.lua_type(L, -1) === lua.LUA_TSTRING) {
          hasStringKeys = true;
          lua.lua_pop(L, 1); // pop key
          break;
        }
      }

      if (!hasStringKeys) {
        // Pure array
        const arr: unknown[] = [];
        for (let i = 1; i <= len; i++) {
          lua.lua_rawgeti(L, idx, i);
          arr.push(luaToJS(L, -1));
          lua.lua_pop(L, 1);
        }
        return arr;
      }
    }
  }

  // Object (or mixed table)
  const obj: Record<string, unknown> = {};
  lua.lua_pushnil(L);
  while (lua.lua_next(L, idx) !== 0) {
    const keyType = lua.lua_type(L, -2);
    let key: string;
    if (keyType === lua.LUA_TSTRING) {
      key = to_jsstring(lua.lua_tostring(L, -2));
    } else if (keyType === lua.LUA_TNUMBER) {
      key = String(lua.lua_tonumber(L, -2));
    } else {
      lua.lua_pop(L, 1);
      continue;
    }
    obj[key] = luaToJS(L, -1);
    lua.lua_pop(L, 1);
  }
  return obj;
}

/** Push a JS value onto the Lua stack */
export function pushJSValue(L: any, value: unknown): void {
  if (value === null || value === undefined) {
    lua.lua_pushnil(L);
  } else if (typeof value === 'boolean') {
    lua.lua_pushboolean(L, value ? 1 : 0);
  } else if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      lua.lua_pushinteger(L, value);
    } else {
      lua.lua_pushnumber(L, value);
    }
  } else if (typeof value === 'string') {
    lua.lua_pushstring(L, cachedToLuastring(value));
  } else if (Array.isArray(value)) {
    pushJSArray(L, value);
  } else if (typeof value === 'object') {
    pushJSObject(L, value as Record<string, unknown>);
  } else {
    lua.lua_pushnil(L);
  }
}

/** Push a JS array as a Lua table (1-based) */
function pushJSArray(L: any, arr: unknown[]): void {
  lua.lua_createtable(L, arr.length, 0);
  for (let i = 0; i < arr.length; i++) {
    pushJSValue(L, arr[i]);
    lua.lua_rawseti(L, -2, i + 1);
  }
}

/** Push a JS object as a Lua table */
function pushJSObject(L: any, obj: Record<string, unknown>): void {
  const keys = Object.keys(obj);
  lua.lua_createtable(L, 0, keys.length);
  for (const key of keys) {
    pushJSValue(L, obj[key]);
    lua.lua_setfield(L, -2, cachedToLuastring(key));
  }
}
