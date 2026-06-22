export interface NormalizedBook {
  trigger: string;
  events: unknown[];
}

export function ensureBook(raw: unknown, fallbackTrigger: string): NormalizedBook {
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  if (Array.isArray(parsed)) return { trigger: fallbackTrigger, events: parsed };
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)) {
    const o = parsed as { trigger?: string; events: unknown[] };
    return { trigger: o.trigger ?? fallbackTrigger, events: o.events };
  }
  return { trigger: fallbackTrigger, events: [] };
}

function isEmptyObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0;
}

/** Recursively replace `{}` with `[]` for keys in `fieldSet`, at any depth. */
export function coerceLuaArrays<T>(data: T, fieldSet: Set<string>): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = fieldSet.has(k) && isEmptyObject(val) ? [] : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(data) as T;
}

export function progressMarker(index: number): string {
  return `seg-${index}`;
}

export function parseProgressMarker(s: string): number | null {
  const m = /^seg-(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

export function roundMoney(v: number, precision: 'cents' | 'microUnits' = 'cents'): number {
  const decimals = precision === 'microUnits' ? 6 : 2;
  return Number(Math.round(parseFloat(v + 'e+' + decimals)) + 'e-' + decimals);
}
