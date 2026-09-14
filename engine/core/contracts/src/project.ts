/**
 * The project format, as a vocabulary. Nothing here decides anything: the
 * layering RULE (bundles in profile order, then the profile's own patch,
 * then the home patch, then --patch) lives in `@energy8engine/project`, and
 * reading files lives in the host. These are the shapes those two agree on.
 */
import type { E8SeamDeclaration } from './manifest';

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
  /**
   * `bundle:<name>` for a row a bundle placed, or the patch layer's own
   * name (`patch`) for one a patch placed or overrode — whatever
   * `resolveComposition` was handed as a layer name.
   *
   * There is exactly one patch layer today. A `cli` layer was listed here
   * as a third possibility and had no producer: nothing constructs one,
   * so nothing could ever read one back. It is not listed any more —
   * `resolveComposition` takes whatever layers its caller passes, so
   * adding one is a change to the caller, not to this vocabulary.
   */
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
   * resolvable URLs); `null` when there is nothing to load — including a
   * host with no `dev-game` at all, where the raw bytes would not import.
   *
   * `null` alone does not say WHY, and the reasons are not alike:
   * a package that declares no runtime half is legal and silent, while an
   * unresolvable package name or an `entry` that is not on disk are
   * author mistakes. The host distinguishes them and puts a `Diagnostic`
   * for the latter two in the same response's `diagnostics` — so a reader
   * of this field never has to infer the difference, and a consumer that
   * simply skips a `null` row (`composeFromProject` does) is not thereby
   * swallowing a failure.
   */
  runtimeUrl: string | null;
  /**
   * Present when the row's package declares `e8.seam` — it is a CANDIDATE
   * to provide that capability, not the certain provider. The game picks
   * between candidates through `@energy8engine/seam`'s `selectProvider`
   * and applies only the winner, so two rows both offering `renderer` is
   * a diagnostic rather than a silent first-one-wins. Computed by the
   * host from the package manifest, the same way `runtimeUrl` is.
   */
  seam?: E8SeamDeclaration;
  /**
   * The row's own `e8.runtime.requires` (see `E8RuntimeHalf.requires`) —
   * services it said it cannot work without. Computed by the host from the
   * package manifest, the same way `runtimeUrl`/`seam` are: a browser has
   * no `package.json` of its own to read. `@energy8engine/game-runtime`'s
   * `createGame` is the reader — checked once, after every row in the
   * composition has had its chance to apply, never used to order anything
   * here either.
   */
  requires?: string[];
}
