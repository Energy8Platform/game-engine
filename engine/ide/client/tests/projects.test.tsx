import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { diagnostic, type ServerMessage, type WorkspaceState } from '@energy8engine/contracts';
import { Projects, createIdeClient } from '../src/index';

/**
 * The «Проекты» sidebar (spec §8): the folder's projects by name, the open
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
    active: 'alpha',
    previewUrl: 'http://game.test:5679',
    diagnostics: [],
    ...overrides,
  };
}

async function harness(initial: WorkspaceState | null = workspace()) {
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
      return new Promise<Response>(() => {});
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
  return { ctx, push, opened };
}

const Doc = () => <div />;

describe('Projects', () => {
  it('lists every project by name, with the id beside it when the two differ', async () => {
    const { ctx } = await harness();
    render(<Projects ctx={ctx} />);
    expect(screen.getByText('Проекты')).toBeInTheDocument();
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

  it('an empty folder says so, and shows the workspace’s own diagnostics', async () => {
    const { ctx } = await harness(
      workspace({
        projects: [],
        active: null,
        previewUrl: null,
        diagnostics: [diagnostic('error', 'workspace', 'x', 'manifest.json is not JSON')],
      }),
    );
    render(<Projects ctx={ctx} />);
    expect(screen.getByTestId('projects-empty')).toHaveTextContent('нет проектов в этой папке');
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
    expect(confirm).toHaveTextContent('unsaved changes will be lost — switch?');
    expect(opened()).toEqual([]);
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
});
