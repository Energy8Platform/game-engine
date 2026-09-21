import type { SymbolsDoc } from '@energy8engine/contracts';

export interface PaytableSection {
  type: 'paytable';
  title: string;
  rows: { symbol: { text?: string; image?: string }; wins: { count: string; multiplier: number }[] }[];
}

/** `spec.symbols[].pay` as the shell's paytable section; `null` when nothing pays. Art: the symbol's `static` state when it is an `image`. */
export function paytableFrom(spec: unknown, symbols: SymbolsDoc | null): PaytableSection | null {
  const list = (spec as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(list)) return null;
  const art = new Map<string, string>();
  for (const def of symbols?.symbols ?? []) {
    const src = def.static?.type === 'image' ? def.static.props?.src : undefined;
    if (typeof src === 'string' && src) art.set(def.id, src);
  }
  const rows: PaytableSection['rows'] = [];
  for (const s of list as { id?: unknown; name?: unknown; pay?: unknown }[]) {
    if (typeof s?.id !== 'string' || !s.pay || typeof s.pay !== 'object') continue;
    const wins = Object.entries(s.pay as Record<string, unknown>)
      .filter(([, m]) => typeof m === 'number')
      .map(([count, multiplier]) => ({ count, multiplier: multiplier as number }))
      .sort((a, b) => Number(a.count) - Number(b.count));
    if (!wins.length) continue;
    const image = art.get(s.id);
    rows.push({ symbol: image ? { image } : { text: typeof s.name === 'string' ? s.name : s.id }, wins });
  }
  return rows.length ? { type: 'paytable', title: 'Paytable', rows } : null;
}
