import { type SymbolResolver } from '@energy8platform/game-engine/slot';

// Placeholder resolver: returns null (blank cell) for every symbol id.
// Replace with real texture-backed AnimatedSymbol instances from public/assets/symbols.
export const resolveSymbol: SymbolResolver = (_id: string) => null;
