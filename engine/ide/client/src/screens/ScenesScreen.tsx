import { useState } from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useGameDiagnostics } from '../plugins/diagnostics';

/**
 * Which layers each scene shows, in what z-order, with what transition —
 * a view over the STAGE row's config (`@energy8engine/stage/schema`), not
 * a store of its own. Every edit builds the whole next config from the
 * stage row's EFFECTIVE config — the raw patch run through the row's own
 * schema, so `layers: [{id:'reels',z:0}]` and `scenes: {}` exist here even
 * when `e8.patch.yml` only says `{ design }` — and `PUT`s it through
 * `ctx.gameComposition.update`, exactly as the Composition screen's form
 * would; the host's frame brings the rows back and this screen re-renders
 * from them. The first edit therefore makes every schema default explicit
 * in the patch (`transition: cut`, `transitionMs: 300`, …): acceptable,
 * and what the form's own PUT already does. The stage row is found by its
 * schema (the one whose `dict` has `scenes`), not by name — a fork of the
 * stage package keeps its screen.
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
 * screen's own — editing on top of a config the host itself would refuse
 * is not this screen's call to make quietly.
 */
function materialise(row: GameCompositionRow): { config: StageConfig; warning: string | null } {
  const raw = (row.config ?? {}) as StageConfig;
  try {
    return { config: new Schema(row.schema as never)(raw) as StageConfig, warning: null };
  } catch (error) {
    return { config: raw, warning: error instanceof Error ? error.message : String(error) };
  }
}

export function ScenesScreen({ ctx }: { ctx: Context }) {
  const { rows, diagnostics, stages, transitions } = useGameComposition(ctx);
  const { groups } = useGameDiagnostics(ctx);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Pinned to the scene it was asked for: a frame that drops the picked
  // scene moves `selected` on, and the old answer must not follow it.
  const [preview, setPreview] = useState<{ scene: string; diagnostics: Diagnostic[] } | null>(null);

  if (rows === null) {
    return (
      <main className="e8-scenes" data-testid="scenes-screen">
        <p className="e8-empty">connecting…</p>
      </main>
    );
  }
  const stageRow = findStageRow(rows);
  if (!stageRow) {
    return (
      <main className="e8-scenes" data-testid="scenes-screen">
        <p className="e8-empty" data-testid="scenes-empty">
          No stage row in this composition — add @energy8engine/stage to give the game scenes.
        </p>
      </main>
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

  const add = () => {
    const id = draft.trim();
    if (!id || Object.hasOwn(scenes, id)) return;
    put({ ...config, scenes: { ...scenes, [id]: { layers: layers.map((l) => l.id) } } });
    setPicked(id);
    setDraft('');
  };

  const show = async () => {
    if (selected === null) return;
    setPreview({ scene: selected, diagnostics: await ctx.gameComposition.previewScene(selected) });
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
    <main className="e8-scenes" data-testid="scenes-screen">
      {warning !== null ? (
        <p className="e8-diagnostic-row" data-severity="warning" data-testid="scenes-warning">
          <span className="e8-severity">warning</span> stage config does not match its schema —
          shown as written: {warning}
        </p>
      ) : null}
      <ul className="e8-scenes-list">
        {sceneIds.map((id) => (
          <li
            key={id}
            className={`e8-explorer-entry${id === selected ? ' e8-scenes-selected' : ''}`}
            data-testid={`scene-${id}`}
            onClick={() => setPicked(id)}
          >
            <span className="e8-explorer-name">{id}</span>
          </li>
        ))}
        <li className="e8-scenes-add" data-testid="scene-add">
          <input
            data-testid="scene-add-input"
            list="e8-scene-add-stages"
            placeholder="new scene…"
            aria-label="new scene id"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <datalist id="e8-scene-add-stages">
            {unused.map((stage) => (
              <option key={stage} value={stage} />
            ))}
          </datalist>
        </li>
      </ul>

      {selected === null ? (
        <p className="e8-empty">No scenes yet — add one from the list.</p>
      ) : (
        <section className="e8-scenes-detail">
          <header>
            <strong>{selected}</strong>
            <label>
              Transition
              <select
                data-testid="scene-transition"
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
            <button type="button" data-testid="scene-show" onClick={() => void show()}>
              Show in preview
            </button>
          </header>
          <ul className="e8-scenes-layers">
            {byZ.map(({ layer }, position) => (
              <li key={layer.id} className="e8-explorer-entry" data-testid={`layer-${layer.id}`}>
                <input
                  type="checkbox"
                  aria-label={`${layer.id} in ${selected}`}
                  checked={shown.has(layer.id)}
                  onChange={() => toggle(layer.id)}
                />
                <span className="e8-explorer-name">{layer.id}</span>
                <span className="e8-scenes-z">z {layer.z}</span>
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
          {sceneDiagnostics.length > 0 ? (
            <ul className="e8-diagnostics-panel-list">
              {sceneDiagnostics.map((d, i) => (
                <li key={i} className="e8-diagnostic-row" data-severity={d.severity}>
                  <span className="e8-severity">{d.severity}</span> <span>{d.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </main>
  );
}
