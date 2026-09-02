/**
 * The project format, as a vocabulary. Nothing here decides anything: the
 * layering RULE (bundles in profile order, then the profile's own patch,
 * then the home patch, then --patch) lives in `@energy8engine/project`, and
 * reading files lives in the host. These are the shapes those two agree on.
 */

/** `e8.profile.yml` — which bundles stack, and in what order. */
export interface Profile {
  bundles: string[];
}

/** One row of `e8.patch.yml` — a delta addressed by row id. */
export interface PatchRow {
  id: string;
  /** Absent when the row only overrides config of a row a bundle already placed. */
  name?: string;
  config?: Record<string, unknown>;
  /** `true` removes a row a bundle placed. */
  remove?: boolean;
}

/**
 * A row after layering, ready to compose. `from` records WHICH layer put it
 * here — the IDE shows it, and a person debugging "why is this plugin
 * loaded" needs it more than any other field.
 */
export interface ResolvedRow {
  id: string;
  name: string;
  config: Record<string, unknown>;
  /** `bundle:<name>` | `patch` | `cli` */
  from: string;
}

export interface ResolvedComposition {
  rows: ResolvedRow[];
}

/**
 * The wire shape `GET /api/composition` actually serves
 * (`engine/ide/host/src/plugins/runtime-assets.ts`) — a `ResolvedRow` plus
 * where to fetch its runtime half. `resolveComposition` above never
 * produces this: it is a pure function with no `fs` access (see this
 * file's module doc) and has no way to know whether a row's package
 * declares `e8.runtime`, let alone whether a vite dev server is around to
 * serve its TypeScript straight off disk. The host computes `runtimeUrl`
 * per row AFTER calling `resolveComposition`, the same way `composition.ts`
 * computes `CompositionRow.clientUrl` for the EDITOR's own rows
 * (`protocol.ts`) — this is that same precedent for the GAME's rows.
 */
export interface GameCompositionRow extends ResolvedRow {
  /**
   * `/@fs/<realpath>` when `dev-game` is composed (served straight through
   * its vite instance — TypeScript stripped, bare specifiers rewritten to
   * resolvable URLs); `/plugin-runtime/<id>` otherwise (this package's own
   * route, raw bytes, no transform); `null` when the row's package
   * declares no runtime half at all.
   */
  runtimeUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isResolvedRow(value: unknown): value is ResolvedRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.config) &&
    typeof value.from === 'string'
  );
}
