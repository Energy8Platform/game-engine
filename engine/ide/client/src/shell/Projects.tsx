import { useState } from 'react';
import type { Context } from 'cordis';
import { useWorkspace } from '../plugins/workspace';

/**
 * The «Проекты» sidebar (spec §8): every project the host's folder holds,
 * by name, the open one marked; a click asks the host to open another.
 * Drawn with the Explorer's own rules (`.e8-explorer-*`) — same header,
 * same rows — so the two sidebars read as one family.
 *
 * With something unsaved, the click asks first, inline under the row the
 * way the Explorer asks before a delete — not a shell-level confirm API
 * (there is none, and one caller does not earn one). «No» leaves every
 * tab where it is; «Yes» calls `open()`, and the `workspace` plugin then
 * closes the `f:` tabs when the new state lands. Nothing here closes a tab.
 */
export function Projects({ ctx }: { ctx: Context }): JSX.Element {
  const state = useWorkspace(ctx);
  const [asking, setAsking] = useState<string | null>(null);

  function select(id: string) {
    if (ctx.shell.hasDirtyDocuments()) {
      setAsking(id);
      return;
    }
    void ctx.workspace.open(id);
  }

  return (
    <div className="e8-explorer">
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">Проекты</span>
      </div>

      {state === null ? (
        <p className="e8-empty">loading…</p>
      ) : (
        <>
          {state.diagnostics.map((diag, i) => (
            <p className="e8-explorer-diagnostic" key={i}>
              {diag.message}
            </p>
          ))}
          {state.projects.length === 0 ? (
            <p className="e8-empty" data-testid="projects-empty">
              нет проектов в этой папке
            </p>
          ) : (
            <ul className="e8-explorer-tree">
              {state.projects.map((project) => {
                const active = project.id === state.active;
                return (
                  <li
                    key={project.id}
                    data-testid={`project-${project.id}`}
                    role="button"
                    tabIndex={0}
                    aria-current={active ? 'true' : undefined}
                    className={active ? 'e8-explorer-entry e8-project-active' : 'e8-explorer-entry'}
                    style={{ paddingLeft: 12 }}
                    onClick={() => select(project.id)}
                  >
                    <span className="e8-explorer-name">
                      {project.name}
                      {project.id !== project.name && (
                        <span className="e8-project-id">{project.id}</span>
                      )}
                    </span>
                    {asking === project.id && (
                      <span className="e8-explorer-confirm" data-testid="project-confirm">
                        unsaved changes will be lost — switch?{' '}
                        <button
                          type="button"
                          data-testid="confirm-yes"
                          className="e8-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAsking(null);
                            void ctx.workspace.open(project.id);
                          }}
                        >
                          Yes
                        </button>{' '}
                        <button
                          type="button"
                          data-testid="confirm-no"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAsking(null);
                          }}
                        >
                          No
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
