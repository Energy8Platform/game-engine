import type { Context } from 'cordis';
import { useFlow } from '../plugins/flow';

/**
 * The Flow document — registered under `shell.document` key `flow`. This
 * task ships the shell around the canvas: a `flow.yml` present is an
 * (still empty) `flow-canvas` pane — Task 8 draws the graph into it —
 * with the document's own diagnostics listed underneath, same row shape
 * `ScenesSidebar` already uses for its own.
 *
 * `doc() === null` is two different situations the host answers the same
 * shape for (`GET`/`PUT /api/flow`'s `FlowResponse`) and this view must
 * not conflate: no `flow.yml` at all (`diagnostics: []`) is `flow-empty`,
 * one button away from the smallest doc that parses; an EXISTING but
 * unparseable `flow.yml` (`engine/ide/host`'s flow route answers `doc:
 * null` with one error `where: 'flow.yml'`, see its own
 * `flow.test.ts:174-190`) is `flow-broken` — no create button, because
 * clicking it would silently overwrite whatever the user has half-written
 * in the file with the one-boot starter doc.
 */
const NEW_FLOW = {
  version: 1 as const,
  nodes: [{ id: 'start', kind: 'boot', ui: { x: 40, y: 80 } }],
  edges: [],
};

export function FlowDocument({ ctx }: { ctx: Context }) {
  const { doc, diagnostics } = useFlow(ctx);
  const broken = doc === null ? diagnostics.find((d) => d.where === 'flow.yml') : undefined;

  return (
    <div className="e8-explorer e8-flow-doc" data-testid="flow-screen">
      {doc === null && broken ? (
        <div className="e8-empty" data-testid="flow-broken">
          <p>{broken.message}</p>
          <p>fix flow.yml in the editor or delete it</p>
        </div>
      ) : doc === null ? (
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
