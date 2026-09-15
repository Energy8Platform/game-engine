import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  diagnostic,
  type ServerMessage,
  type Template,
  type WorkspaceState,
} from '@energy8engine/contracts';
import { Projects, createIdeClient } from '../src/index';

/**
 * The «Projects» sidebar (spec §8): the folder's projects by name, the open
 * one marked, a click asking the host to open another — but only after a
 * person has agreed to lose whatever is unsaved, when something is.
 *
 * Same harness shape as `preview.test.tsx`: the real `createIdeClient`,
 * one fake socket every plugin shares, workspace states pushed as frames.
 * `open(id)` is observed as the POST it makes — the fake `fetchFn` records
 * every call and never answers.
 */

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    projects: [
      { id: 'alpha', name: 'alpha' },
      { id: 'beta', name: 'Beta Slot' },
    ],
    templates: [],
    active: 'alpha',
    previewUrl: 'http://game.test:5679',
    diagnostics: [],
    ...overrides,
  };
}

/**
 * `respond` answers every call after the boot GET; the default never
 * answers, which is all the `open()` tests need — they watch the POST.
 */
async function harness(
  initial: WorkspaceState | null = workspace(),
  respond: (url: string, init?: RequestInit) => Promise<Response> = () =>
    new Promise<Response>(() => {}),
) {
  const listeners: ((event: { data: string }) => void)[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const calls: { url: string; init?: RequestInit }[] = [];
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    fetchFn: ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return calls.length === 1 ? new Promise<Response>(() => {}) : respond(url, init);
    }) as unknown as typeof fetch,
  });
  const push = (message: ServerMessage) => {
    act(() => {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    });
  };
  if (initial) push({ type: 'workspace', workspace: initial });
  /** The ids `open()` was asked for, in order. */
  const opened = () =>
    calls
      .filter((call) => call.url === '/api/workspace/open')
      .map((call) => (JSON.parse(call.init?.body as string) as { id: string }).id);
  /** The bodies `create()` POSTed, in order. */
  const created = () =>
    calls
      .filter((call) => call.url === '/api/workspace/create')
      .map((call) => JSON.parse(call.init?.body as string) as { template: string; id: string });
  return { ctx, push, opened, created };
}

const templates = (): Template[] => [
  { id: 'slot-basic', name: 'Basic slot', description: 'Five reels, three rows, lines.' },
  { id: 'slot-cluster', name: 'Cluster slot', description: 'Seven by seven, tumbling.' },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const Doc = () => <div />;

describe('Projects', () => {
  it('lists every project by name, with the id beside it when the two differ', async () => {
    const { ctx } = await harness();
    render(<Projects ctx={ctx} />);
    expect(screen.getByText('Projects')).toBeInTheDocument();
    const beta = screen.getByTestId('project-beta');
    expect(beta).toHaveTextContent('Beta Slot');
    expect(within(beta).getByText('beta')).toHaveClass('e8-project-id');
    const alpha = screen.getByTestId('project-alpha');
    expect(alpha).toHaveTextContent('alpha');
    expect(within(alpha).queryByText('alpha')).not.toHaveClass('e8-project-id');
  });

  it('marks the open project and no other', async () => {
    const { ctx } = await harness();
    render(<Projects ctx={ctx} />);
    const alpha = screen.getByTestId('project-alpha');
    expect(alpha).toHaveAttribute('aria-current', 'true');
    expect(alpha).toHaveClass('e8-project-active');
    const beta = screen.getByTestId('project-beta');
    expect(beta).not.toHaveAttribute('aria-current');
    expect(beta).not.toHaveClass('e8-project-active');
  });

  it('a click with nothing unsaved asks the host to open that project', async () => {
    const { ctx, opened } = await harness();
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-beta'));
    expect(opened()).toEqual(['beta']);
    expect(screen.queryByTestId('project-confirm')).toBeNull();
  });

  it('a click on the OPEN project does nothing — no request, no question, even with unsaved work', async () => {
    const { ctx, opened } = await harness();
    ctx.shell.open({
      key: 'f:game/script.spin',
      title: 'script.spin',
      component: Doc,
      closable: true,
    });
    ctx.shell.markDirty('f:game/script.spin', true);
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-alpha'));
    expect(opened()).toEqual([]);
    expect(screen.queryByTestId('project-confirm')).toBeNull();
  });

  it('an empty folder says so, and shows the workspace’s own diagnostics', async () => {
    const { ctx } = await harness(
      workspace({
        projects: [],
        templates: [],
        active: null,
        previewUrl: null,
        diagnostics: [diagnostic('error', 'workspace', 'x', 'manifest.json is not JSON')],
      }),
    );
    render(<Projects ctx={ctx} />);
    expect(screen.getByTestId('projects-empty')).toHaveTextContent('no projects in this folder');
    expect(screen.getByText('manifest.json is not JSON')).toHaveClass('e8-explorer-diagnostic');
  });

  it('before the workspace has answered it is loading, not empty', async () => {
    const { ctx } = await harness(null);
    render(<Projects ctx={ctx} />);
    expect(screen.getByText('loading…')).toHaveClass('e8-empty');
    expect(screen.queryByTestId('projects-empty')).toBeNull();
  });

  it('a click with unsaved work asks first, under that project', async () => {
    const { ctx, opened } = await harness();
    ctx.shell.open({
      key: 'f:game/script.spin',
      title: 'script.spin',
      component: Doc,
      closable: true,
    });
    ctx.shell.markDirty('f:game/script.spin', true);
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-beta'));
    const confirm = within(screen.getByTestId('project-beta')).getByTestId('project-confirm');
    expect(confirm).toHaveTextContent('unsaved changes in 1 document will be lost — switch?');
    expect(opened()).toEqual([]);
  });

  it('the question counts the dirty documents, not the open ones', async () => {
    const { ctx } = await harness();
    ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
    ctx.shell.open({ key: 'f:b.ts', title: 'b.ts', component: Doc, closable: true });
    ctx.shell.open({ key: 'f:c.ts', title: 'c.ts', component: Doc, closable: true });
    ctx.shell.markDirty('f:a.ts', true);
    ctx.shell.markDirty('f:b.ts', true);
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-beta'));
    expect(screen.getByTestId('project-confirm')).toHaveTextContent(
      'unsaved changes in 2 documents will be lost — switch?',
    );
  });

  it('Enter on the inline «No» answers the question, and does not re-ask it as a row click', async () => {
    // The buttons sit inside the row; their keydown bubbles up to it.
    const { ctx, opened } = await harness();
    ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
    ctx.shell.markDirty('f:a.ts', true);
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-beta'));
    screen.getByTestId('confirm-no').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByTestId('project-confirm')).toBeNull();
    expect(opened()).toEqual([]);
  });

  it('Enter and Space on a row open the project, the way a click does; other keys do not', async () => {
    // A5: the rows are `role=button` with a tabindex, and the keyboard
    // used to reach them and do nothing.
    const { opened, ctx } = await harness();
    render(<Projects ctx={ctx} />);
    screen.getByTestId('project-beta').focus();
    await userEvent.keyboard('a');
    expect(opened()).toEqual([]);
    await userEvent.keyboard('{Enter}');
    expect(opened()).toEqual(['beta']);
    await userEvent.keyboard(' ');
    expect(opened()).toEqual(['beta', 'beta']);
  });

  it('«No» keeps the current project and asks nothing of the host', async () => {
    const { ctx, opened } = await harness();
    ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
    ctx.shell.markDirty('f:a.ts', true);
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-beta'));
    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.queryByTestId('project-confirm')).toBeNull();
    expect(opened()).toEqual([]);
    expect(ctx.shell.documents().map((doc) => doc.key)).toEqual(['f:a.ts']);
  });

  it('«Yes» asks the host to open the project', async () => {
    const { ctx, opened } = await harness();
    ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
    ctx.shell.markDirty('f:a.ts', true);
    render(<Projects ctx={ctx} />);
    await userEvent.click(screen.getByTestId('project-beta'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    expect(screen.queryByTestId('project-confirm')).toBeNull();
    expect(opened()).toEqual(['beta']);
  });

  describe('New project', () => {
    it('is offered only when the host has templates', async () => {
      const { ctx } = await harness(workspace({ templates: templates() }));
      const { unmount } = render(<Projects ctx={ctx} />);
      expect(screen.getByText('New project')).toHaveClass('e8-explorer-title');
      expect(screen.getByTestId('new-project-template')).toBeInTheDocument();
      expect(screen.getByTestId('new-project-id')).toHaveAttribute('placeholder', 'my-slot');
      expect(screen.getByTestId('new-project-create')).toHaveTextContent('Create');
      unmount();
      const bare = await harness(workspace({ templates: [] }));
      render(<Projects ctx={bare.ctx} />);
      expect(screen.queryByText('New project')).toBeNull();
      expect(screen.queryByTestId('new-project-create')).toBeNull();
    });

    it('lists the templates by name and describes the chosen one', async () => {
      const { ctx } = await harness(workspace({ templates: templates() }));
      render(<Projects ctx={ctx} />);
      const select = screen.getByTestId('new-project-template') as HTMLSelectElement;
      expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
        ['slot-basic', 'Basic slot'],
        ['slot-cluster', 'Cluster slot'],
      ]);
      expect(screen.getByText('Five reels, three rows, lines.')).toHaveClass(
        'e8-template-description',
      );
      await userEvent.selectOptions(select, 'slot-cluster');
      expect(screen.getByText('Seven by seven, tumbling.')).toBeInTheDocument();
      expect(screen.queryByText('Five reels, three rows, lines.')).toBeNull();
    });

    it('Create is disabled until the id matches the pattern', async () => {
      const { ctx } = await harness(workspace({ templates: templates() }));
      render(<Projects ctx={ctx} />);
      const create = screen.getByTestId('new-project-create');
      const input = screen.getByTestId('new-project-id');
      expect(create).toBeDisabled();
      await userEvent.type(input, 'A');
      expect(create).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, 'my-slot');
      expect(create).toBeEnabled();
      await userEvent.clear(input);
      await userEvent.type(input, '-my-slot');
      expect(create).toBeDisabled();
    });

    it('a click on Create asks the host for that template under that id, and disables the button while it waits', async () => {
      const { ctx, created } = await harness(workspace({ templates: templates() }));
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot');
      await userEvent.click(screen.getByTestId('new-project-create'));
      expect(created()).toEqual([{ template: 'slot-basic', id: 'my-slot' }]);
      expect(screen.getByTestId('new-project-create')).toBeDisabled();
    });

    it('Enter in the id field submits the same way, and does not reach the rows', async () => {
      const { ctx, created, opened } = await harness(workspace({ templates: templates() }));
      render(<Projects ctx={ctx} />);
      await userEvent.selectOptions(screen.getByTestId('new-project-template'), 'slot-cluster');
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot{Enter}');
      expect(created()).toEqual([{ template: 'slot-cluster', id: 'my-slot' }]);
      expect(opened()).toEqual([]);
    });

    it('Enter with an id that does not match submits nothing', async () => {
      const { ctx, created } = await harness(workspace({ templates: templates() }));
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'A{Enter}');
      expect(created()).toEqual([]);
    });

    it('with unsaved work Create asks first, under the form; No creates nothing, Yes creates once', async () => {
      // Creating opens the new project, and that force-closes every
      // closable tab — the same loss a row click risks, so the same question.
      const { ctx, created } = await harness(workspace({ templates: templates() }));
      ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
      ctx.shell.markDirty('f:a.ts', true);
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot{Enter}');
      const form = screen.getByTestId('new-project-create').closest('form')!;
      expect(within(form).getByTestId('project-confirm')).toHaveTextContent(
        'unsaved changes in 1 document will be lost — switch?',
      );
      expect(created()).toEqual([]);
      await userEvent.click(screen.getByTestId('confirm-no'));
      expect(screen.queryByTestId('project-confirm')).toBeNull();
      expect(created()).toEqual([]);
      await userEvent.click(screen.getByTestId('new-project-create'));
      await userEvent.click(screen.getByTestId('confirm-yes'));
      expect(screen.queryByTestId('project-confirm')).toBeNull();
      expect(created()).toEqual([{ template: 'slot-basic', id: 'my-slot' }]);
    });

    it('one question at a time: the form’s replaces a pending row’s, and Yes answers the form', async () => {
      const { ctx, created, opened } = await harness(workspace({ templates: templates() }));
      ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
      ctx.shell.markDirty('f:a.ts', true);
      render(<Projects ctx={ctx} />);
      await userEvent.click(screen.getByTestId('project-beta'));
      expect(
        within(screen.getByTestId('project-beta')).getByTestId('project-confirm'),
      ).toBeVisible();
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot{Enter}');
      const confirms = screen.getAllByTestId('project-confirm');
      expect(confirms).toHaveLength(1);
      expect(confirms[0].closest('form')).not.toBeNull();
      await userEvent.click(screen.getByTestId('confirm-yes'));
      expect(created()).toEqual([{ template: 'slot-basic', id: 'my-slot' }]);
      expect(opened()).toEqual([]);
    });

    it('one question at a time: a row’s replaces the form’s, and Yes opens the row', async () => {
      const { ctx, created, opened } = await harness(workspace({ templates: templates() }));
      ctx.shell.open({ key: 'f:a.ts', title: 'a.ts', component: Doc, closable: true });
      ctx.shell.markDirty('f:a.ts', true);
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot{Enter}');
      expect(screen.getByTestId('project-confirm').closest('form')).not.toBeNull();
      await userEvent.click(screen.getByTestId('project-beta'));
      const confirms = screen.getAllByTestId('project-confirm');
      expect(confirms).toHaveLength(1);
      expect(confirms[0].closest('[data-testid="project-beta"]')).not.toBeNull();
      await userEvent.click(screen.getByTestId('confirm-yes'));
      expect(opened()).toEqual(['beta']);
      expect(created()).toEqual([]);
    });

    it('a new request clears the last refusal at once, and holds the fields while it waits', async () => {
      // Other plugins fetch too: count only the form's own POSTs.
      let posts = 0;
      const { ctx } = await harness(workspace({ templates: templates() }), async (url) =>
        url !== '/api/workspace/create' || ++posts > 1
          ? new Promise<Response>(() => {})
          : json({ diagnostics: [diagnostic('error', 'workspace', 'x', 'nope')] }, 400),
      );
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot{Enter}');
      await screen.findByTestId('new-project-refusal');
      await userEvent.click(screen.getByTestId('new-project-create'));
      expect(screen.queryByTestId('new-project-refusal')).toBeNull();
      expect(screen.getByTestId('new-project-id')).toBeDisabled();
      expect(screen.getByTestId('new-project-template')).toBeDisabled();
      expect(screen.getByTestId('new-project-create')).toBeDisabled();
    });

    it('a refusal is shown under the form, and the id stays for a fix', async () => {
      const { ctx } = await harness(workspace({ templates: templates() }), async () =>
        json(
          {
            diagnostics: [
              diagnostic('error', 'workspace', 'my-slot', 'project "my-slot" already exists'),
            ],
          },
          400,
        ),
      );
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'my-slot{Enter}');
      const refusal = await screen.findByTestId('new-project-refusal');
      expect(refusal).toHaveTextContent('project "my-slot" already exists');
      expect(refusal).toHaveClass('e8-explorer-diagnostic');
      expect(screen.getByTestId('new-project-id')).toHaveValue('my-slot');
      expect(screen.getByTestId('new-project-create')).toBeEnabled();
    });

    it('success clears the id and any earlier refusal', async () => {
      let status = 400;
      const { ctx } = await harness(workspace({ templates: templates() }), async () =>
        status === 400
          ? json({ diagnostics: [diagnostic('error', 'workspace', 'x', 'nope')] }, 400)
          : json(
              workspace({
                templates: templates(),
                projects: [...workspace().projects, { id: 'x', name: 'x' }],
                active: 'x',
              }),
            ),
      );
      render(<Projects ctx={ctx} />);
      await userEvent.type(screen.getByTestId('new-project-id'), 'x{Enter}');
      await screen.findByTestId('new-project-refusal');
      status = 200;
      await userEvent.click(screen.getByTestId('new-project-create'));
      await waitFor(() => expect(screen.getByTestId('new-project-id')).toHaveValue(''));
      expect(screen.queryByTestId('new-project-refusal')).toBeNull();
      expect(screen.getByTestId('project-x')).toHaveAttribute('aria-current', 'true');
    });
  });
});
