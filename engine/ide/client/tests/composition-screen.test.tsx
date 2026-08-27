import { act, fireEvent, render, screen } from '@testing-library/react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { CompositionScreen, createIdeClient } from '../src/index';

const SCHEMA = JSON.parse(
  JSON.stringify(Schema.object({ speed: Schema.number().min(1).max(20).default(8).description('reel speed') }).toJSON()),
);

async function harness() {
  const listeners: ((event: any) => void)[] = [];
  const sent: string[] = [];
  const socket = {
    // OPEN, matching a real WebSocket whose handshake already completed —
    // these tests exercise the screen, not the connection's own
    // not-yet-open handling (that's connection.test.ts's job).
    readyState: 1,
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send(data: string) {
      sent.push(data);
    },
    close() {},
  };
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
  // `act()`: a server push notifies the mounted screen's connection
  // subscription synchronously, outside any testing-library event helper —
  // the same reason the analogous notification in slots.test.tsx's "stale
  // disposer" case is wrapped, and for the same consequence if it isn't:
  // React defers a same-tick, non-`act`-wrapped update, so the assertion
  // right after `push()` would still see the pre-push render.
  const push = (message: ServerMessage) => {
    act(() => {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    });
  };
  return { ctx, push, sent };
}

describe('CompositionScreen', () => {
  it('lists the composition with each plugin as a row', async () => {
    const { ctx, push } = await harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: {
        rows: [{ id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: { speed: 8 }, schema: SCHEMA, hot: true, clientUrl: null }],
        diagnostics: [],
      },
    });
    expect(screen.getByText('probe-plugin')).toBeTruthy();
  });

  it('sends the edited config to the host', async () => {
    const { ctx, push, sent } = await harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: {
        rows: [{ id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: { speed: 8 }, schema: SCHEMA, hot: true, clientUrl: null }],
        diagnostics: [],
      },
    });
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '3' } });
    expect(JSON.parse(sent[0])).toEqual({ type: 'update', id: 'a:probe1', config: { speed: 3 } });
  });

  it('shows diagnostics instead of swallowing them', async () => {
    const { ctx, push } = await harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: { rows: [], diagnostics: [{ severity: 'error', plugin: 'x', where: 'package', message: 'cannot resolve package "x"' }] },
    });
    expect(screen.getByText(/cannot resolve package/)).toBeTruthy();
  });

  it('renders cards plugins contributed to composition.card', async () => {
    const { ctx, push } = await harness();
    ctx.slots.register({ name: 'composition.card', key: 'extra' }, () => <span>extra card</span>);
    render(<CompositionScreen ctx={ctx} />);
    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    expect(screen.getByText('extra card')).toBeTruthy();
  });
});
