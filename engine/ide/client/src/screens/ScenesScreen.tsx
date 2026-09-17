import { useState } from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';

/**
 * Which layers each scene shows, in what z-order, with what transition —
 * a view over the STAGE row's config (`@energy8engine/stage/schema`), not
 * a store of its own. Every edit builds the whole next config from
 * `stageRow.config` and `PUT`s it through `ctx.gameComposition.update`,
 * exactly as the Composition screen's form would; the host's frame brings
 * the rows back and this screen re-renders from them. The stage row is
 * found by its schema (the one whose `dict` has `scenes`), not by name —
 * a fork of the stage package keeps its screen.
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

export function ScenesScreen({ ctx }: { ctx: Context }) {
  const { rows, diagnostics, stages, transitions } = useGameComposition(ctx);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [previewDiagnostics, setPreviewDiagnostics] = useState<Diagnostic[]>([]);

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

  const config = (stageRow.config ?? {}) as StageConfig;
  const layers: Layer[] = Array.isArray(config.layers) ? config.layers : [];
  const scenes: Record<string, SceneConfig> = config.scenes ?? {};
  const sceneIds = Object.keys(scenes);
  const selected = picked !== null && picked in scenes ? picked : (sceneIds[0] ?? null);
  const scene = selected === null ? null : scenes[selected];
  const shown = new Set(scene?.layers ?? []);
  const byZ = layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.z - b.layer.z);
  const unused = stages.filter((stage) => !(stage in scenes));

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
    if (!id || id in scenes) return;
    put({ ...config, scenes: { ...scenes, [id]: { layers: layers.map((l) => l.id) } } });
    setPicked(id);
    setDraft('');
  };

  const show = async () => {
    if (selected === null) return;
    setPreviewDiagnostics(await ctx.gameComposition.previewScene(selected));
  };

  const sceneDiagnostics = [
    ...diagnostics.filter((d) => d.plugin === 'scenes' && d.where === selected),
    ...previewDiagnostics,
  ];

  return (
    <main className="e8-scenes" data-testid="scenes-screen">
      <ul className="e8-scenes-list">
        {sceneIds.map((id) => (
          <li
            key={id}
            className={`e8-explorer-entry${id === selected ? ' e8-scenes-selected' : ''}`}
            data-testid={`scene-${id}`}
            onClick={() => {
              setPicked(id);
              setPreviewDiagnostics([]);
            }}
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
