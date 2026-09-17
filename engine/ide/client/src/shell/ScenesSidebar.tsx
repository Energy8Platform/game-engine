import { useState } from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useGameDiagnostics } from '../plugins/diagnostics';
import { activateOnKey } from './activate';
import { InlineInput } from './Explorer';

/**
 * Which layers each scene shows, in what z-order, with what transition —
 * a view over the STAGE row's config (`@energy8engine/stage/schema`), not
 * a store of its own, drawn as one sidebar column in the Explorer's own
 * idiom: a header with the one action (`+`), scene rows, the selected
 * scene's layers under them, its transition, its diagnostics. Every edit
 * builds the whole next config from the stage row's EFFECTIVE config —
 * the raw patch run through the row's own schema, so `layers:
 * [{id:'reels',z:0}]` and `scenes: {}` exist here even when `e8.patch.yml`
 * only says `{ design }` — and `PUT`s it through
 * `ctx.gameComposition.update`, exactly as the Composition screen's form
 * would; the host's frame brings the rows back and this view re-renders
 * from them. The first edit therefore makes every schema default explicit
 * in the patch (`transition: cut`, `transitionMs: 300`, …): acceptable,
 * and what the form's own PUT already does. The stage row is found by its
 * schema (the one whose `dict` has `scenes`), not by name — a fork of the
 * stage package keeps its view.
 *
 * Clicking a scene selects it AND pushes it into the preview
 * (`previewScene`) — what "click a scene" means to a person looking at a
 * game. Which scene the preview is in right now is not a fact the IDE
 * holds (the game answers a push, it never announces a spin's own
 * transition), so no row is marked "showing"; the selection is the IDE's
 * own cursor, nothing more.
 */
interface Layer {
  id: string;
  z: number;
}

interface SceneConfig {
  layers?: string[];
  transition?: string;
}

interface StageConfig {
  layers?: Layer[];
  scenes?: Record<string, SceneConfig>;
  [key: string]: unknown;
}

function hasScenes(schema: unknown): boolean {
  if (schema == null) return false;
  try {
    return 'scenes' in ((new Schema(schema as never) as { dict?: object }).dict ?? {});
  } catch {
    return false;
  }
}

export function findStageRow(rows: GameCompositionRow[]): GameCompositionRow | undefined {
  return rows.find((row) => hasScenes(row.schema));
}

/**
 * The row's config with its schema defaults filled in (schemastery's
 * validate returns the config with defaults applied). A config the schema
 * rejects is shown as it is, with the rejection as a warning of this
 * view's own — editing on top of a config the host itself would refuse
 * is not this view's call to make quietly.
 */
export function materialise(row: GameCompositionRow): {
  config: StageConfig;
  warning: string | null;
} {
  const raw = (row.config ?? {}) as StageConfig;
  try {
    return { config: new Schema(row.schema as never)(raw) as StageConfig, warning: null };
  } catch (error) {
    return { config: raw, warning: error instanceof Error ? error.message : String(error) };
  }
}

const DATALIST_ID = 'e8-scene-add-stages';

export function ScenesSidebar({ ctx }: { ctx: Context }) {
  const { rows, diagnostics, stages, transitions } = useGameComposition(ctx);
  const { groups } = useGameDiagnostics(ctx);
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // This view's own refusal of a new id — cleared by the next attempt or a cancel.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Pinned to the scene it was asked for: a frame that drops the picked
  // scene moves `selected` on, and the old answer must not follow it.
  const [preview, setPreview] = useState<{ scene: string; diagnostics: Diagnostic[] } | null>(null);

  const header = (
    <div className="e8-explorer-header">
      <span className="e8-explorer-title">Scenes</span>
      {rows !== null && findStageRow(rows) ? (
        <span className="e8-explorer-actions">
          <button
            type="button"
            className="e8-explorer-action"
            data-testid="scene-add"
            title="new scene"
            aria-label="new scene"
            onClick={() => {
              setRefusal(null);
              setAdding(true);
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </span>
      ) : null}
    </div>
  );

  if (rows === null) {
    return (
      <div className="e8-explorer e8-scenes" data-testid="scenes-screen">
        {header}
        <p className="e8-empty">connecting…</p>
      </div>
    );
  }
  const stageRow = findStageRow(rows);
  if (!stageRow) {
    return (
      <div className="e8-explorer e8-scenes" data-testid="scenes-screen">
        {header}
        <p className="e8-empty" data-testid="scenes-empty">
          No stage row in this composition — add @energy8engine/stage to give the game scenes.
        </p>
      </div>
    );
  }

  const { config, warning } = materialise(stageRow);
  const layers: Layer[] = Array.isArray(config.layers) ? config.layers : [];
  const scenes: Record<string, SceneConfig> = config.scenes ?? {};
  const sceneIds = Object.keys(scenes);
  const selected =
    picked !== null && Object.hasOwn(scenes, picked) ? picked : (sceneIds[0] ?? null);
  const scene = selected === null ? null : scenes[selected];
  const shown = new Set(scene?.layers ?? []);
  const byZ = layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.z - b.layer.z);
  const unused = stages.filter((stage) => !Object.hasOwn(scenes, stage));

  const put = (next: StageConfig) => void ctx.gameComposition.update(stageRow.id, next);

  const toggle = (id: string) => {
    if (selected === null) return;
    const next = layers.map((l) => l.id).filter((l) => (l === id ? !shown.has(l) : shown.has(l)));
    put({ ...config, scenes: { ...scenes, [selected]: { ...scene, layers: next } } });
  };

  const swap = (position: number, other: number) => {
    const a = byZ[position];
    const b = byZ[other];
    if (!a || !b) return;
    const next = layers.map((layer, index) =>
      index === a.index
        ? { ...layer, z: b.layer.z }
        : index === b.index
          ? { ...layer, z: a.layer.z }
          : layer,
    );
    // The runtime breaks a z-tie by array index (the schema default is 0,
    // so every form-added layer ties): swapping equal z values alone would
    // write the same config back.
    if (a.layer.z === b.layer.z) [next[a.index], next[b.index]] = [next[b.index], next[a.index]];
    put({ ...config, layers: next });
  };

  const setTransition = (transition: string) => {
    if (selected === null) return;
    const { transition: _dropped, ...rest } = scene ?? {};
    put({
      ...config,
      scenes: { ...scenes, [selected]: transition ? { ...rest, transition } : rest },
    });
  };

  /** Enter in the new-scene row. Returns whether the id was taken — a refused one keeps the input up. */
  const add = (id: string): boolean => {
    if (!id) {
      setRefusal('type a scene id');
      return false;
    }
    if (Object.hasOwn(scenes, id)) {
      setRefusal(`"${id}" already exists`);
      return false;
    }
    setRefusal(null);
    setAdding(false);
    put({ ...config, scenes: { ...scenes, [id]: { layers: layers.map((l) => l.id) } } });
    setPicked(id);
    return true;
  };

  const remove = (id: string) => {
    setPending(null);
    const { [id]: _gone, ...rest } = scenes;
    put({ ...config, scenes: rest });
  };

  const select = async (id: string) => {
    setPicked(id);
    setPreview({ scene: id, diagnostics: await ctx.gameComposition.previewScene(id) });
  };

  // `checkScenes` reports through the host's `game-diagnostics` frame
  // (`source: 'host'`), not the composition's own list — both are read.
  const fromHost = (groups ?? []).flatMap((group) =>
    group.diagnostics.filter((entry) => entry.source === 'host').map((entry) => entry.diagnostic),
  );
  const sceneDiagnostics = [
    ...[...diagnostics, ...fromHost].filter((d) => d.plugin === 'scenes' && d.where === selected),
    ...(preview?.scene === selected ? preview.diagnostics : []),
  ];

  return (
    <div className="e8-explorer e8-scenes" data-testid="scenes-screen">
      {header}
      {warning !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="scenes-warning">
          stage config does not match its schema — shown as written: {warning}
        </p>
      ) : null}
      {refusal !== null ? <p className="e8-explorer-diagnostic">{refusal}</p> : null}

      <ul className="e8-explorer-tree">
        {adding ? (
          <li className="e8-explorer-entry">
            <InlineInput
              initial=""
              testId="scene-add-input"
              list={DATALIST_ID}
              placeholder="scene id — a stage from the script"
              onSubmit={add}
              onCancel={() => {
                setAdding(false);
                setRefusal(null);
              }}
            />
            <datalist id={DATALIST_ID}>
              {unused.map((stage) => (
                <option key={stage} value={stage} />
              ))}
            </datalist>
          </li>
        ) : null}
        {sceneIds.length === 0 && !adding ? (
          <li className="e8-empty" data-testid="scenes-none">
            No scenes yet — press + to add one
          </li>
        ) : null}
        {sceneIds.map((id) => (
          <li
            key={id}
            role="button"
            tabIndex={0}
            className={`e8-explorer-entry${id === selected ? ' e8-explorer-selected' : ''}`}
            data-testid={`scene-${id}`}
            onClick={() => void select(id)}
            onKeyDown={activateOnKey(() => void select(id))}
          >
            {/* The question names the scene; the column is too narrow to say it twice. */}
            {pending === id ? null : <span className="e8-explorer-name">{id}</span>}
            {pending !== id && scenes[id]?.transition ? (
              <span className="e8-scenes-badge">{scenes[id].transition}</span>
            ) : null}
            {pending === id ? (
              <span className="e8-explorer-confirm">
                {`delete scene "${id}"?`}{' '}
                <button
                  type="button"
                  data-testid="confirm-yes"
                  className="e8-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(id);
                  }}
                >
                  yes
                </button>{' '}
                <button
                  type="button"
                  data-testid="confirm-no"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPending(null);
                  }}
                >
                  no
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="e8-explorer-delete"
                aria-label={`delete scene ${id}`}
                title="delete"
                onClick={(event) => {
                  event.stopPropagation();
                  setPending(id);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="e8-scenes-section-title">
        {selected === null ? 'Layers' : `Layers in ${selected}`}
      </div>
      {selected === null ? <p className="e8-empty">select a scene</p> : null}
      <ul className="e8-explorer-tree">
        {byZ.map(({ layer }, position) => (
          <li
            key={layer.id}
            className="e8-explorer-entry e8-scenes-layer"
            data-testid={`layer-${layer.id}`}
          >
            <input
              type="checkbox"
              aria-label={selected === null ? layer.id : `${layer.id} in ${selected}`}
              checked={shown.has(layer.id)}
              disabled={selected === null}
              onChange={() => toggle(layer.id)}
            />
            <span className="e8-explorer-name">{layer.id}</span>
            <span className="e8-scenes-badge">z {layer.z}</span>
            <button
              type="button"
              className="e8-scenes-move"
              aria-label="up"
              title="Draw earlier"
              disabled={position === 0}
              onClick={() => swap(position, position - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="e8-scenes-move"
              aria-label="down"
              title="Draw later"
              disabled={position === byZ.length - 1}
              onClick={() => swap(position, position + 1)}
            >
              ↓
            </button>
          </li>
        ))}
      </ul>

      <label className="e8-explorer-entry e8-scenes-transition">
        <span className="e8-explorer-name">Transition</span>
        <select
          data-testid="scene-transition"
          disabled={selected === null}
          value={scene?.transition ?? ''}
          onChange={(event) => setTransition(event.target.value)}
        >
          <option value="">stage default</option>
          {transitions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      {sceneDiagnostics.map((d, i) => (
        <p key={i} className="e8-explorer-diagnostic" data-severity={d.severity}>
          {d.message}
        </p>
      ))}
    </div>
  );
}
