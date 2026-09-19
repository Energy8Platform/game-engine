/**
 * `symbols`: `symbols.yml` turned into the legacy `SymbolView` a reel
 * board's cells consume — one `SymbolHandle` per resolved id, its
 * `static`/`idle`/`win` states mounted through `@energy8engine/scenes`'
 * node types. The `symbols1` row (`./runtime`) provides `assets.resolve`
 * and the `symbols` service around it.
 */
export { fallbackBox } from './fallback';
export { createSymbolHandle, type SymbolHandle, type ViewDeps } from './view';
export type { SymbolsConfig, SymbolsService } from './runtime';
