import { type FormEvent, useState } from 'react';
import type { Context } from 'cordis';
import { type Diagnostic, PROJECT_ID_PATTERN, type Template } from '@energy8engine/contracts';
import { useShell } from '../plugins/shell';
import { useWorkspace } from '../plugins/workspace';
import { activateOnKey } from './activate';

/**
 * The «Projects» sidebar (spec §8): every project the host's folder holds,
 * by name, the open one marked; a click asks the host to open another.
 * Drawn with the Explorer's own rules (`.e8-explorer-*`) — same header,
 * same rows — so the two sidebars read as one family.
 *
 * With something unsaved, the click asks first, inline under the row the
 * way the Explorer asks before a delete — not a shell-level confirm API
 * (there is none, and one caller does not earn one). «No» leaves every
 * tab where it is; «Yes» calls `open()`, and the `workspace` plugin then
 * closes the closable tabs when the new state lands. Nothing here closes a tab.
 *
 * Under the list, when the host offers templates: the «New project» form
 * (spec §5). It sits OUTSIDE the rows, so its keys never reach a row's
 * `activateOnKey`; a native `<form>` makes Enter submit and `disabled`
 * hold the gate. Creating OPENS the new project, which closes every
 * closable tab the way a row click does — so with something unsaved it
 * asks the same inline question first.
 */
export function Projects({ ctx }: { ctx: Context }): JSX.Element {
  const state = useWorkspace(ctx);
  const [asking, setAsking] = useState<string | null>(null);
  const { documents } = useShell(ctx);
  const dirty = documents.filter((doc) => doc.dirty).length;

  function select(id: string) {
    if (id === state?.active) return; // already open: nothing to ask, nothing to do
    if (ctx.shell.hasDirtyDocuments()) {
      setAsking(id);
      return;
    }
    void ctx.workspace.open(id);
  }

  return (
    <div className="e8-explorer">
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">Projects</span>
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
              no projects in this folder
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
                    onKeyDown={activateOnKey(() => select(project.id))}
                  >
                    <span className="e8-explorer-name">
                      {project.name}
                      {project.id !== project.name && (
                        <span className="e8-project-id">{project.id}</span>
                      )}
                    </span>
                    {asking === project.id && (
                      <Confirm
                        dirty={dirty}
                        onYes={() => {
                          setAsking(null);
                          void ctx.workspace.open(project.id);
                        }}
                        onNo={() => setAsking(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {state.templates.length > 0 && (
            <NewProject ctx={ctx} templates={state.templates} dirty={dirty} />
          )}
        </>
      )}
    </div>
  );
}

/** The inline «unsaved changes … — switch?» question, under a row or under the form. */
function Confirm({ dirty, onYes, onNo }: { dirty: number; onYes: () => void; onNo: () => void }) {
  return (
    <span className="e8-explorer-confirm" data-testid="project-confirm">
      {`unsaved changes in ${dirty} document${dirty === 1 ? '' : 's'} will be lost — switch?`}{' '}
      <button
        type="button"
        data-testid="confirm-yes"
        className="e8-primary"
        onClick={(e) => {
          e.stopPropagation();
          onYes();
        }}
      >
        Yes
      </button>{' '}
      <button
        type="button"
        data-testid="confirm-no"
        onClick={(e) => {
          e.stopPropagation();
          onNo();
        }}
      >
        No
      </button>
    </span>
  );
}

function NewProject({
  ctx,
  templates,
  dirty,
}: {
  ctx: Context;
  templates: Template[];
  dirty: number;
}): JSX.Element {
  const [template, setTemplate] = useState(templates[0].id);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [refusals, setRefusals] = useState<Diagnostic[]>([]);
  const valid = PROJECT_ID_PATTERN.test(id);
  // The chosen template may have left the list with a newer state; fall back to the first.
  const chosen = templates.find((t) => t.id === template) ?? templates[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    if (ctx.shell.hasDirtyDocuments()) {
      setAsking(true);
      return;
    }
    void create();
  }

  async function create() {
    setAsking(false);
    setBusy(true);
    const said = await ctx.workspace.create({ template: chosen.id, id });
    setBusy(false);
    setRefusals(said);
    if (said.length === 0) setId('');
  }

  return (
    <>
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">New project</span>
      </div>
      <form className="e8-new-project" onSubmit={submit}>
        <label>
          Template
          <select
            data-testid="new-project-template"
            value={chosen.id}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {chosen.description && (
            <span className="e8-template-description">{chosen.description}</span>
          )}
        </label>
        <label>
          Id
          <input
            data-testid="new-project-id"
            placeholder="my-slot"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <button type="submit" data-testid="new-project-create" disabled={!valid || busy}>
          Create
        </button>
        {asking && (
          <Confirm dirty={dirty} onYes={() => void create()} onNo={() => setAsking(false)} />
        )}
        {refusals.map((diag, i) => (
          <p className="e8-explorer-diagnostic" data-testid="new-project-refusal" key={i}>
            {diag.message}
          </p>
        ))}
      </form>
    </>
  );
}
