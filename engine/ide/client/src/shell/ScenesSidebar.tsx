import { useState } from 'react';
import type { Context } from 'cordis';
import { useScenes } from '../plugins/scenes';
import { activateOnKey } from './activate';
import { InlineInput } from './Explorer';

/**
 * The scene list, in the Explorer's own idiom: a header with the one
 * action (`+`), rows, a hover `×` with the Explorer's confirm pattern.
 * Clicking a row selects it AND pushes it into the preview — what "click
 * a scene" means to a person looking at a game; double-clicking opens its
 * `scenes/<id>.scene.yml` tab. No row is marked "showing": which scene the
 * preview is actually in right now is not a fact the IDE holds (see
 * `plugins/scenes.tsx`), only which one this list's own cursor is on.
 *
 * This view draws the flat list `ctx.scenes` already keeps — the layers/
 * transitions editor the old `ScenesSidebar` drew over the stage row's
 * composition config is gone with it (Tasks 12–13 add a viewer and an
 * inspector over one scene's own nodes; this is only the list).
 */
export function ScenesSidebar({ ctx }: { ctx: Context }) {
  const { docs, diagnostics, selected } = useScenes(ctx);
  const [adding, setAdding] = useState(false);
  // This view's own refusal of a new id — cleared by the next attempt or a cancel.
  const [addError, setAddError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const open = (id: string) => ctx.scenes.open(id);

  const pick = (id: string) => {
    ctx.scenes.select({ scene: id, node: null });
    void ctx.scenes.preview(id);
  };

  /** Enter in the new-scene row. Returns false so the input stays up — the create's answer decides whether it closes. */
  const add = (id: string): boolean => {
    if (!id) return false;
    setAddError(null);
    void ctx.scenes.create(id).then((refused) => {
      if (refused.length > 0) setAddError(refused[0].message);
      else setAdding(false);
    });
    return false;
  };

  const remove = (id: string) => {
    setPending(null);
    void ctx.scenes.remove(id);
  };

  return (
    <div className="e8-explorer e8-scenes" data-testid="scenes-screen">
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">Scenes</span>
        <span className="e8-explorer-actions">
          <button
            type="button"
            className="e8-explorer-action"
            data-testid="scene-add"
            title="new scene"
            aria-label="new scene"
            onClick={() => {
              setAddError(null);
              setAdding(true);
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </span>
      </div>

      {addError !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="scene-add-error">
          {addError}
        </p>
      ) : null}

      <ul className="e8-explorer-tree">
        {adding ? (
          <li className="e8-explorer-entry">
            <InlineInput
              initial=""
              testId="scene-add-input"
              placeholder="scene id"
              onSubmit={add}
              onCancel={() => {
                setAdding(false);
                setAddError(null);
              }}
            />
          </li>
        ) : null}
        {docs.length === 0 && !adding ? (
          <li className="e8-empty" data-testid="scenes-empty">
            no scenes yet — press + to add one
          </li>
        ) : null}
        {docs.map((doc) => (
          <li
            key={doc.id}
            role="button"
            tabIndex={0}
            className={`e8-explorer-entry${doc.id === selected?.scene ? ' e8-explorer-selected' : ''}`}
            data-testid={`scene-${doc.id}`}
            title="click: show in preview · double-click: open"
            onClick={() => pick(doc.id)}
            onDoubleClick={() => open(doc.id)}
            onKeyDown={activateOnKey(() => pick(doc.id))}
          >
            {pending === doc.id ? null : <span className="e8-explorer-name">{doc.id}</span>}
            {pending === doc.id ? (
              <span className="e8-explorer-confirm">
                {`delete scene "${doc.id}"?`}{' '}
                <button
                  type="button"
                  data-testid="confirm-yes"
                  className="e8-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(doc.id);
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
                data-testid={`scene-remove-${doc.id}`}
                aria-label={`delete scene ${doc.id}`}
                title="delete"
                onClick={(event) => {
                  event.stopPropagation();
                  setPending(doc.id);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {diagnostics.length > 0 ? (
        <ul className="e8-explorer-tree" data-testid="scenes-diagnostics">
          {diagnostics.map((d, i) => (
            <li key={i} className="e8-explorer-diagnostic" data-severity={d.severity}>
              {`${d.severity}: ${d.where} — ${d.message}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
