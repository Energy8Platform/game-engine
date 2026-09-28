import type { ReactNode } from 'react';
import type { Context } from 'cordis';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useSymbols } from '../plugins/symbols';
import { SchemaForm } from '../schema-form/SchemaForm';
import type { FieldProps } from '../schema-form/fields';
import { BoardPainter, type BoardShape } from './BoardPainter';
import { SymbolChips } from './SymbolChips';

/**
 * The Reels tab's right sidebar (`shell.sideRight` `reels`): `reels1`'s
 * config split into sections (its own `grid`/`win`/`board` keys, one each)
 * plus the whole config of the four rows that plug INTO the reel system it
 * hosts (`motion1`, `anticipation1`, `cascade1`, `features1`). A row
 * missing from the composition draws no section at all; `reels.tsx` keeps
 * this whole sidebar unregistered while `reels1` itself is missing, so
 * `reels1`'s own three sections are always there once this renders.
 *
 * Every form's `rowId` is `reels-<row id>`, never the bare row id:
 * Composition stays mounted (hidden) while the Reels tab shows and draws
 * the same rows with the bare id — sharing it would collide every field id
 * and radio `name`, and a label here would toggle Composition's copy.
 *
 * Every section write goes through `ctx.gameComposition.update`, same as
 * Composition's own game rows — this component never touches the reel lab
 * canvas itself; `ReelsDocument` (the tab's own document, holding the
 * canvas) follows `ctx.gameComposition`'s rows on its own and re-applies
 * whichever reel row's config actually changed.
 *
 * Two fields aren't drawn by `fields.tsx`'s stock editors — `anticipation1`'s
 * own `triggerSymbols` and `reels1`'s `win.frameShake.onlyOnSymbols` are
 * both `string[]` of symbol ids — `SchemaForm.fieldOverrides` swaps in
 * `SymbolChips` for them (the Win one keyed `win.frameShake.onlyOnSymbols`,
 * the value-root path — see `SchemaForm`'s own doc comment — even though
 * `root: 'win'` trims what actually draws). `board` is `Schema.any()` — no
 * stock editor exists for it at all — so the Board section draws
 * `BoardPainter` directly instead of a `SchemaForm`, over `reels1.config.
 * board` shaped by the grid's own `cols`/`rowsPerReel ?? rows`. Both read
 * the project's symbol ids off `ctx.symbols` (`useSymbols`, same hook
 * `SymbolsProperties` uses) — `known()` first, then any of `doc()?.symbols`
 * not already in it.
 */
function byId(rows: readonly GameCompositionRow[], id: string): GameCompositionRow | null {
  return rows.find((row) => row.id === id) ?? null;
}

/** The chips override's and the board painter's shared id list: `known`
 * (the reel board's registered ids) first, then any symbol the doc has
 * that `known` doesn't (a def not yet wired into `game/spec.json`) —
 * neither is dropped, so an id already in a saved value still resolves to
 * a name instead of reading as unknown for no reason. */
function symbolIds(
  known: readonly { id: string; name: string }[],
  doc: { symbols: readonly { id: string; name?: string }[] } | null,
): { id: string; name: string }[] {
  const seen = new Set(known.map((s) => s.id));
  const extra = (doc?.symbols ?? [])
    .filter((s) => !seen.has(s.id))
    .map((s) => ({ id: s.id, name: s.name ?? s.id }));
  return [...known, ...extra];
}

/** `reels1.config.grid` merged over the schema's own defaults — the shape
 * `BoardPainter` measures the saved `board` against. `rowsPerReel` (an
 * array, one entry per reel — Megaways/variable-height reels) overrides
 * the uniform `rows` entirely when its length is `cols` — reel-core's
 * `normalizeGrid` drops one of any other length, so it does not count
 * here either; otherwise every column gets the same `rows`. */
function boardShape(config: Record<string, unknown>): BoardShape {
  const grid = (config.grid ?? {}) as { cols?: number; rows?: number; rowsPerReel?: number[] };
  const cols = grid.cols ?? 5;
  const rows =
    grid.rowsPerReel?.length === cols ? grid.rowsPerReel : Array(cols).fill(grid.rows ?? 3);
  return { cols, rows };
}

/**
 * One section's chrome: a title, and — when its own slice of the row's
 * config carries any key — a `reset section` button (`fields.tsx`'s own
 * nested-group reset, just applied at the row's OWN top level, which that
 * component never draws a legend for since there's no group node there).
 * `root` scopes both the "any key" check and what reset drops: `undefined`
 * means the whole row (Motion, Anticipation, Cascade, Features — reset
 * writes `{}`), a key means just that part of `reels1`'s config (Grid,
 * Win — reset writes the config without that key, so a sibling section's
 * edits survive).
 */
function Section({
  name,
  title,
  row,
  root,
  write,
  children,
}: {
  name: string;
  title: string;
  row: GameCompositionRow;
  root?: string;
  write: (id: string, config: Record<string, unknown>) => void;
  children: ReactNode;
}) {
  const config = row.config;
  const scoped = root ? ((config[root] ?? {}) as Record<string, unknown>) : config;
  const hasAny = Object.keys(scoped).length > 0;
  const reset = () => {
    if (!root) return write(row.id, {});
    const rest = { ...config };
    delete rest[root];
    write(row.id, rest);
  };
  return (
    <section className="e8-reels-section" data-testid={`reels-section-${name}`}>
      <header className="e8-reels-section-header">
        <strong>{title}</strong>
        {hasAny ? (
          <button
            type="button"
            className="e8-field-reset"
            aria-label={`reset section ${name}`}
            onClick={reset}
          >
            reset section
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function ReelsSettings({ ctx }: { ctx: Context }) {
  const { rows } = useGameComposition(ctx);
  const list = rows ?? [];
  const reels1 = byId(list, 'reels1');
  const motion1 = byId(list, 'motion1');
  const anticipation1 = byId(list, 'anticipation1');
  const cascade1 = byId(list, 'cascade1');
  const features1 = byId(list, 'features1');

  const { known, doc } = useSymbols(ctx);
  const ids = symbolIds(known, doc);
  const chips = (props: FieldProps) => <SymbolChips {...props} known={ids} />;

  const write = (id: string, config: Record<string, unknown>) =>
    void ctx.gameComposition.update(id, config);

  return (
    <div className="e8-reels-settings" data-testid="reels-settings">
      {reels1 ? (
        <>
          <Section name="grid" title="Grid" row={reels1} root="grid" write={write}>
            <SchemaForm
              rowId={`reels-${reels1.id}`}
              schema={reels1.schema}
              value={reels1.config}
              onChange={(next) => write(reels1.id, next)}
              commit="blur"
              resettable
              root="grid"
            />
          </Section>
          <Section name="win" title="Win" row={reels1} root="win" write={write}>
            <SchemaForm
              rowId={`reels-${reels1.id}`}
              schema={reels1.schema}
              value={reels1.config}
              onChange={(next) => write(reels1.id, next)}
              commit="blur"
              resettable
              root="win"
              fieldOverrides={{ 'win.frameShake.onlyOnSymbols': chips }}
            />
          </Section>
          <section className="e8-reels-section" data-testid="reels-section-board">
            <header className="e8-reels-section-header">
              <strong>Board</strong>
            </header>
            <BoardPainter
              board={reels1.config.board}
              shape={boardShape(reels1.config)}
              known={ids}
              onChange={(board) => {
                const next = { ...reels1.config } as Record<string, unknown>;
                if (board === undefined) delete next.board;
                else next.board = board;
                write(reels1.id, next);
              }}
            />
          </section>
        </>
      ) : null}
      {motion1 ? (
        <Section name="motion" title="Motion" row={motion1} write={write}>
          <SchemaForm
            rowId={`reels-${motion1.id}`}
            schema={motion1.schema}
            value={motion1.config}
            onChange={(next) => write(motion1.id, next)}
            commit="blur"
            resettable
          />
        </Section>
      ) : null}
      {anticipation1 ? (
        <Section name="anticipation" title="Anticipation" row={anticipation1} write={write}>
          <SchemaForm
            rowId={`reels-${anticipation1.id}`}
            schema={anticipation1.schema}
            value={anticipation1.config}
            onChange={(next) => write(anticipation1.id, next)}
            commit="blur"
            resettable
            fieldOverrides={{ triggerSymbols: chips }}
          />
        </Section>
      ) : null}
      {cascade1 ? (
        <Section name="cascade" title="Cascade" row={cascade1} write={write}>
          <SchemaForm
            rowId={`reels-${cascade1.id}`}
            schema={cascade1.schema}
            value={cascade1.config}
            onChange={(next) => write(cascade1.id, next)}
            commit="blur"
            resettable
          />
        </Section>
      ) : null}
      {features1 ? (
        <Section name="features" title="Features" row={features1} write={write}>
          <SchemaForm
            rowId={`reels-${features1.id}`}
            schema={features1.schema}
            value={features1.config}
            onChange={(next) => write(features1.id, next)}
            commit="blur"
            resettable
          />
        </Section>
      ) : null}
    </div>
  );
}
