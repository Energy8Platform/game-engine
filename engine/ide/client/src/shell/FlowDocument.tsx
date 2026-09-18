import type { Context } from 'cordis';
import { useFlow } from '../plugins/flow';

/**
 * The Flow document — registered under `shell.document` key `flow`. This
 * task ships the shell around the canvas: no `flow.yml` yet is
 * `flow-empty`, one button away from the smallest doc that parses (a
 * single `boot` node); a `flow.yml` present is an (still empty)
 * `flow-canvas` pane — Task 8 draws the graph into it — with the
 * document's own diagnostics listed underneath, same row shape
 * `ScenesSidebar` already uses for its own.
 */
const NEW_FLOW = {
  version: 1 as const,
  nodes: [{ id: 'start', kind: 'boot', ui: { x: 40, y: 80 } }],
  edges: [],
};

export function FlowDocument({ ctx }: { ctx: Context }) {
  const { doc, diagnostics } = useFlow(ctx);

  return (
    <div className="e8-explorer e8-flow-doc" data-testid="flow-screen">
      {doc === null ? (
        <div className="e8-empty" data-testid="flow-empty">
          <p>no flow.yml — create one</p>
          <button
            type="button"
            className="e8-primary"
            data-testid="flow-create"
            onClick={() => void ctx.flow.update(NEW_FLOW)}
          >
            create flow.yml
          </button>
        </div>
      ) : (
        <>
          <div className="e8-flow-canvas" data-testid="flow-canvas" />
          <ul className="e8-explorer-tree" data-testid="flow-diagnostics">
            {diagnostics.map((d, i) => (
              <li key={i} className="e8-explorer-diagnostic" data-severity={d.severity}>
                {`${d.severity}: ${d.where} — ${d.message}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
