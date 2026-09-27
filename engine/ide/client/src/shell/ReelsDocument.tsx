import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Context } from 'cordis';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useSymbols } from '../plugins/symbols';
import { useWorkspace } from '../plugins/workspace';
import { SchemaForm } from '../schema-form/SchemaForm';
import type { FieldProps } from '../schema-form/fields';
import { BoardPainter, type BoardShape } from './BoardPainter';
import { SymbolChips } from './SymbolChips';
import { createCanvasRpc, type CanvasRpc } from './canvas-rpc';

/**
 * The Reels document: `reels1`'s config split into sections (its own
 * `grid`/`win`/`board` keys, one each) plus the whole config of the four
 * rows that plug INTO the reel system it hosts (`motion1`, `anticipation1`,
 * `cascade1`, `features1`) — replacing the single long form Composition
 * used to draw for `reels1` and the four separate rows the others sat in
 * (see this slice's brief). A row missing from the composition draws no
 * section at all; `reels.tsx` keeps this whole document unregistered while
 * `reels1` itself is missing, so `reels1`'s own three sections are always
 * there once this renders.
 *
 * The right column is the reel lab canvas (`@energy8engine/scene-edit`'s
 * reels mode, `editor.html?reels=`) — modelled on `SymbolsDocument`'s own
 * canvas half: the iframe is keyed on the project/reload/preview address
 * (never the sections' own edits, which travel as an rpc call, not a
 * remount), and `canvas-rpc` talks to it the same wire protocol. Its own
 * toolbar runs the lab's test actions (`spin`/`scatters`/`win`/`tumble`) —
 * synthetic boards played through the real board steps, no mechanic and no
 * server — and reports whichever answered `{ ok: false, reason }` in
 * `reels-action-status`.
 *
 * Every section write goes through `ctx.gameComposition.update`, same as
 * Composition's own game rows; a successful one (`diagnostics: []`) also
 * re-sends the canvas the CURRENT config of every reel row via the `rows`
 * rpc (Tasks 3–4) — read straight off `ctx.gameComposition.rows` at send
 * time, not the `rows` this render closed over, so a write that lands
 * between commit and this callback still ships the latest. The canvas
 * asks for the same thing itself on `ready` (a fresh load, or a reload the
 * host drove) — whatever board it showed before that is stale.
 *
 * Task 6: two of `reels1`'s own fields aren't drawn by `fields.tsx`'s
 * stock editors. `anticipation1.triggerSymbols` and `win.frameShake.
 * onlyOnSymbols` are both `string[]` of symbol ids — `SchemaForm.
 * fieldOverrides` swaps in `SymbolChips` for them (the Win one keyed
 * `win.frameShake.onlyOnSymbols`, the value-root path — see `SchemaForm`'s
 * own doc comment — even though `root: 'win'` trims what actually draws).
 * `board` is `Schema.any()` — no stock editor exists for it at all — so
 * the Board section draws `BoardPainter` directly instead of a
 * `SchemaForm`, over `reels1.config.board` shaped by the grid's own
 * `cols`/`rowsPerReel ?? rows`. Both read the project's symbol ids off
 * `ctx.symbols` (`useSymbols`, same hook `SymbolsProperties` uses) —
 * `known()` first, then any of `doc()?.symbols` not already in it.
 */
const REEL_ROW_IDS = ['reels1', 'motion1', 'anticipation1', 'cascade1', 'features1'] as const;

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
 * the uniform `rows` entirely when set, same rule `GridSchema` itself
 * documents; unset, every column gets the same `rows`. */
function boardShape(config: Record<string, unknown>): BoardShape {
  const grid = (config.grid ?? {}) as { cols?: number; rows?: number; rowsPerReel?: number[] };
  const cols = grid.cols ?? 5;
  const rows = grid.rowsPerReel ?? Array(cols).fill(grid.rows ?? 3);
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

export function ReelsDocument({ ctx }: { ctx: Context }) {
  const { rows, reloads } = useGameComposition(ctx);
  const list = rows ?? [];
  const reels1 = byId(list, 'reels1');
  const motion1 = byId(list, 'motion1');
  const anticipation1 = byId(list, 'anticipation1');
  const cascade1 = byId(list, 'cascade1');
  const features1 = byId(list, 'features1');

  const { known, doc } = useSymbols(ctx);
  const ids = symbolIds(known, doc);
  const chips = (props: FieldProps) => <SymbolChips {...props} known={ids} />;

  const workspace = useWorkspace(ctx);
  const previewUrl = workspace?.previewUrl ?? null;
  /** Same key `SymbolsDocument` uses: a reload, a project switch or a
   * changed preview address all remount the canvas — a section edit never
   * does, it travels as a `rows` rpc call instead. */
  const canvasKey = workspace ? `${reloads}:${workspace.active}:${previewUrl}` : null;

  const [rpc] = useState<CanvasRpc>(() => createCanvasRpc());
  const rpcRef = useRef<CanvasRpc | null>(rpc);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** Every reel row's CURRENT config, off the service directly (never the
   * `list` this render closed over — see the class doc above). */
  const sendRows = () => {
    const current = ctx.gameComposition.rows ?? [];
    const reelRows = REEL_ROW_IDS.map((id) => byId(current, id))
      .filter((row): row is GameCompositionRow => row !== null)
      .map((row) => ({ id: row.id, config: row.config }));
    void rpcRef.current?.call('rows', { rows: reelRows }).catch(() => {});
  };

  useEffect(() => {
    rpcRef.current = rpc;
    rpc.on('ready', sendRows);
    return () => {
      rpc.dispose();
      rpcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rpc]);

  /** The iframe's own ref, not its `load` event — `contentWindow` exists as soon as it's inserted (`SymbolsDocument`'s own reasoning). */
  const attachIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el && previewUrl) rpc.attach(el, new URL(previewUrl).origin);
    },
    [rpc, previewUrl],
  );

  const write = (id: string, config: Record<string, unknown>) =>
    void ctx.gameComposition.update(id, config).then((answer) => {
      if (answer.diagnostics.length === 0) sendRows();
    });

  const runAction = async (method: string, params?: unknown) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await rpcRef.current!.call<{ ok: boolean; reason?: string }>(method, params);
      if (result && result.ok === false) setStatus(result.reason ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const anticipationOn = anticipation1 !== null && anticipation1.config.enabled !== false;
  const scattersDisabled = busy || !anticipationOn;

  return (
    <div className="e8-reels-doc" data-testid="reels-doc">
      <div className="e8-reels-sections">
        {reels1 ? (
          <>
            <Section name="grid" title="Grid" row={reels1} root="grid" write={write}>
              <SchemaForm
                rowId={reels1.id}
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
                rowId={reels1.id}
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
              rowId={motion1.id}
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
              rowId={anticipation1.id}
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
              rowId={cascade1.id}
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
              rowId={features1.id}
              schema={features1.schema}
              value={features1.config}
              onChange={(next) => write(features1.id, next)}
              commit="blur"
              resettable
            />
          </Section>
        ) : null}
      </div>
      <div className="e8-reels-canvas">
        {workspace === null ? (
          <p className="e8-empty">loading…</p>
        ) : previewUrl === null ? (
          <p className="e8-empty" data-testid="reels-canvas-unavailable">
            canvas unavailable: no project open
          </p>
        ) : (
          <>
            <div className="e8-reels-toolbar" data-testid="reels-toolbar">
              <button
                type="button"
                data-testid="reels-action-spin"
                disabled={busy}
                onClick={() => void runAction('spin')}
              >
                Spin
              </button>
              <button
                type="button"
                data-testid="reels-action-scatters"
                disabled={scattersDisabled}
                onClick={() =>
                  void runAction('scatters', {
                    triggers: (anticipation1?.config.triggerSymbols as string[] | undefined) ?? [
                      'scatter',
                    ],
                    threshold: (anticipation1?.config.threshold as number | undefined) ?? 2,
                  })
                }
              >
                Scatters
              </button>
              <button
                type="button"
                data-testid="reels-action-win"
                disabled={busy}
                onClick={() => void runAction('win')}
              >
                Win
              </button>
              {cascade1 ? (
                <button
                  type="button"
                  data-testid="reels-action-tumble"
                  disabled={busy}
                  onClick={() => void runAction('tumble')}
                >
                  Tumble
                </button>
              ) : null}
              <span className="e8-reels-status" data-testid="reels-action-status">
                {status ?? ''}
              </span>
            </div>
            <div className="e8-reels-stage">
              <iframe
                key={canvasKey}
                ref={attachIframe}
                title="reels canvas"
                src={`${previewUrl}/editor.html?reels=`}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
