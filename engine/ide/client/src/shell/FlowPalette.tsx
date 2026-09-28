import type { Context } from 'cordis';
import { useFlow } from '../plugins/flow';
import { KIND_MIME } from './flow-graph';

/**
 * The Flow tab's left sidebar (`shell.sidebar` `flow`): one button per
 * registered kind. Drag sets `KIND_MIME` on the native `dataTransfer` —
 * that crosses to the canvas' `onDrop` on its own, HTML5 drag-and-drop
 * doesn't care that the sidebar and the document are separate React
 * subtrees under `Shell`. A click can't cross that boundary the same way
 * (it needs the canvas' own `screenToFlowPosition` and pane box to centre
 * the new node on the visible view), so it goes through `ctx.flow.requestAdd`
 * instead — the mounted canvas (`FlowDocument`) is the one that registered
 * a handler for it and does the actual add.
 *
 * Nothing to show without a flow.yml — there is no canvas to add into
 * either, the same gate `FlowDocument` applied before the palette moved
 * out of it.
 */
export function FlowPalette({ ctx }: { ctx: Context }) {
  const { doc, kinds } = useFlow(ctx);
  if (doc === null) return null;
  return (
    <div className="e8-explorer e8-flow-palette" data-testid="flow-palette">
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">nodes</span>
      </div>
      {kinds.length === 0 && <p className="e8-empty">no kinds yet — run the game</p>}
      {kinds.map((info) => (
        <button
          key={info.kind}
          type="button"
          className="e8-explorer-entry e8-flow-add"
          data-testid={`flow-add-${info.kind}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(KIND_MIME, info.kind);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => ctx.flow.requestAdd(info.kind)}
        >
          {info.kind}
        </button>
      ))}
    </div>
  );
}
