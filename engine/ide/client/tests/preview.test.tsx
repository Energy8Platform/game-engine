import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CompositionRow, ServerMessage, WorkspaceState } from '@energy8engine/contracts';
import {
  DEFAULT_PREVIEW_STATE,
  Preview,
  createIdeClient,
  previewAddress,
  readPreviewState,
  type PreviewState,
} from '../src/index';
import { BALANCE_LEVELS } from '../src/screens/balanceLevels';

/**
 * Falling tests for Task 12, step 1: the preview panel draws an iframe at
 * `dev-game`'s address, and reloads it when — and only when — the host's
 * `game-composition` frame says `reload: true` (see the block of four
 * below for what that replaced).
 *
 * Task 6 replaces the wall (§5's device presets, orientations and
 * languages open at once — one whole game per tile) with the one frame
 * the user actually asked for: a harness-like toolbar over a single
 * iframe, 1:1, the stage scrolling rather than fitting. The reload cases
 * below are unchanged from before the wall existed; what is new is
 * `previewAddress`/`readPreviewState` and the toolbar itself.
 */

const PREVIEW_URL = 'http://game.test:5679';

/** What the host sends when nothing is open — see `WorkspaceState.previewUrl`. */
const NO_PROJECT: WorkspaceState = {
  projects: [{ id: 'a', name: 'Game A' }],
  templates: [],
  active: null,
  previewUrl: null,
  diagnostics: [],
};

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    projects: [{ id: 'a', name: 'Game A' }],
    templates: [],
    active: 'a',
    previewUrl: PREVIEW_URL,
    diagnostics: [],
    ...overrides,
  };
}

/**
 * One fake socket shared by every plugin `createIdeClient` composes
 * (`connection`, `workspace`, `game-diagnostics` each open their own; the
 * factory hands them the same one), so `push` reaches all of them. The
 * boot fetches never answer — every workspace state below arrives as a
 * frame, which lands synchronously. `initial` is the first one pushed
 * before returning: a project open on `PREVIEW_URL` by default; `null`
 * pushes nothing, so the workspace has not answered at all yet.
 */
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
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    fetchFn: () => new Promise<Response>(() => {}),
  });
  const push = (message: ServerMessage) => {
    act(() => {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    });
  };
  if (initial) push({ type: 'workspace', workspace: initial });
  return { ctx, push };
}

function row(overrides: Partial<CompositionRow>): CompositionRow {
  return {
    id: 'a:x',
    name: 'x',
    disabled: false,
    state: 2,
    config: {},
    schema: null,
    hot: true,
    clientUrl: null,
    clientInject: [],
    ...overrides,
  };
}

describe('previewAddress', () => {
  const base = 'http://127.0.0.1:5679/';
  it('carries lang, currency, balance and wallet always', () => {
    const url = new URL(previewAddress(base, DEFAULT_PREVIEW_STATE));
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('currency')).toBe('USD');
    expect(url.searchParams.get('balance')).toBe('10000');
    expect(url.searchParams.get('wallet')).toBe('0');

    const picked = new URL(previewAddress(base, { ...DEFAULT_PREVIEW_STATE, balance: 100, wallet: 3 }));
    expect(picked.searchParams.get('balance')).toBe('100');
    expect(picked.searchParams.get('wallet')).toBe('3');
  });
  it('adds social=1 when on, device=mobile for a Mobile preset', () => {
    const url = new URL(
      previewAddress(base, {
        ...DEFAULT_PREVIEW_STATE,
        preset: 'Mobile S',
        social: true,
      }),
    );
    expect(url.searchParams.get('social')).toBe('1');
    expect(url.searchParams.get('device')).toBe('mobile');
    expect(url.searchParams.has('game')).toBe(false);
  });
  it('keeps what the base address already carries', () => {
    expect(new URL(previewAddress('http://h/?x=1', DEFAULT_PREVIEW_STATE)).searchParams.get('x')).toBe(
      '1',
    );
  });
});

describe('readPreviewState', () => {
  it('nothing stored: defaults', () => {
    localStorage.clear();
    expect(readPreviewState()).toEqual(DEFAULT_PREVIEW_STATE);
  });

  it('junk JSON: defaults', () => {
    localStorage.setItem('e8.preview', 'not json{{{');
    expect(readPreviewState()).toEqual(DEFAULT_PREVIEW_STATE);
  });

  it('an unknown preset/currency/lang, a non-numeric balance and a non-boolean rotated each fall back to their own default', () => {
    localStorage.setItem(
      'e8.preview',
      JSON.stringify({ preset: 'Gone', currency: 'XXX', lang: 'zz', balance: 'abc', rotated: 'yes' }),
    );
    expect(readPreviewState()).toEqual(DEFAULT_PREVIEW_STATE);
  });

  it('a localStorage that throws: defaults', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    try {
      expect(readPreviewState()).toEqual(DEFAULT_PREVIEW_STATE);
    } finally {
      spy.mockRestore();
    }
  });

  it('a stored balance level as a string loads as a number (old e8.preview shape: no wallet stored, so wallet defaults to 0)', () => {
    localStorage.setItem('e8.preview', JSON.stringify({ balance: '1000' }));
    const state = readPreviewState();
    expect(state.balance).toBe(1000);
    expect(state.wallet).toBe(0);
  });

  it('a stored balance that is not one of the levels falls back to the default (old shape: wallet defaults to 0)', () => {
    localStorage.setItem('e8.preview', JSON.stringify({ balance: '250' }));
    const state = readPreviewState();
    expect(state.balance).toBe(10_000);
    expect(state.wallet).toBe(0);
  });

  it('a stored empty-string balance falls back to the default (old shape: wallet defaults to 0)', () => {
    localStorage.setItem('e8.preview', JSON.stringify({ balance: '' }));
    const state = readPreviewState();
    expect(state.balance).toBe(10_000);
    expect(state.wallet).toBe(0);
  });

  it('a stored balance already a number loads as-is', () => {
    localStorage.setItem('e8.preview', JSON.stringify({ balance: 100 }));
    expect(readPreviewState().balance).toBe(100);
  });

  it('a stored wallet that is a non-negative integer loads as-is', () => {
    localStorage.setItem('e8.preview', JSON.stringify({ wallet: 5 }));
    expect(readPreviewState().wallet).toBe(5);
  });

  it.each([-1, 1.5, 'x', 1e21])('a stored wallet of %p falls back to 0', (wallet) => {
    localStorage.setItem('e8.preview', JSON.stringify({ wallet }));
    expect(readPreviewState().wallet).toBe(0);
  });
});

describe('Preview', () => {
  it('renders an iframe pointed where the host says the game is served, addressed with the default toolbar state', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const iframe = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe(previewAddress(PREVIEW_URL, DEFAULT_PREVIEW_STATE));
    expect(iframe.width).toBe('1200');
    expect(iframe.height).toBe('675');
  });

  it('with no project open there is no iframe, only the note', async () => {
    const { ctx } = await harness(NO_PROJECT);
    render(<Preview ctx={ctx} />);
    expect(screen.queryByTitle('game preview')).toBeNull();
    expect(screen.getByTestId('preview-unavailable')).toHaveTextContent(/no project open/);
  });

  it('before the workspace has answered at all there is no iframe either — it is loading, not unavailable', async () => {
    const { ctx } = await harness(null);
    render(<Preview ctx={ctx} />);
    expect(screen.queryByTitle('game preview')).toBeNull();
    expect(screen.getByTestId('preview-loading')).toHaveTextContent('loading…');
    expect(screen.queryByTestId('preview-unavailable')).toBeNull();
  });

  it('a workspace change to a different previewUrl remounts the iframe — a real navigation', async () => {
    localStorage.clear();
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({
      type: 'workspace',
      workspace: workspace({ active: 'b', previewUrl: 'http://other.test:5679' }),
    });
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(previewAddress('http://other.test:5679', DEFAULT_PREVIEW_STATE));
  });

  it('a different active project on the SAME previewUrl remounts the iframe — same port, different game', async () => {
    localStorage.clear();
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({ type: 'workspace', workspace: workspace({ active: 'b' }) });
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(previewAddress(PREVIEW_URL, DEFAULT_PREVIEW_STATE));
  });

  it('a workspace change that keeps the same previewUrl does not reload', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({ type: 'workspace', workspace: workspace({ diagnostics: [] }) });
    expect(screen.getByTitle('game preview')).toBe(before);
  });

  /**
   * Whether an edit needs the game reloaded is the HOST's verdict now —
   * `GameCompositionMessage.reload`, decided from the row's `hot` and the
   * changed keys' `applies: 'restart'` (hot-fork slice, spec §2 "Клиент").
   * The four cases that used to sit here fingerprinted the EDITOR's own
   * `hot: false` rows out of `snapshot` frames (`coldSignature`); no editor
   * row of the reference project is cold (`bridge1`, `screendemo1`, `probe1`
   * all declare `hot: true`), so that property guarded nothing a person
   * could reach, and the one it stood for — "a cold change reloads" — is
   * the host's `reload` now, pinned host-side. What the client pins is:
   * it follows `reload`.
   */
  it('a game-composition frame with reload: true remounts the iframe — a real navigation', async () => {
    localStorage.clear();
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');

    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });

    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(previewAddress(PREVIEW_URL, DEFAULT_PREVIEW_STATE));
  });

  it('a game-composition frame with reload: false keeps the same iframe — the game re-applied the row itself', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');

    push({ type: 'game-composition', rows: [], reload: false, changed: ['reels1'] });

    expect(screen.getByTitle('game preview')).toBe(before);
  });

  it('every reload: true frame remounts again — two edits, two navigations', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });
    const first = screen.getByTitle('game preview');
    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });
    expect(screen.getByTitle('game preview')).not.toBe(first);
  });

  it('a snapshot of the EDITOR’s rows, cold or not, never reloads on its own', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '720p' } })],
        diagnostics: [],
      },
    });
    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '1080p' } })],
        diagnostics: [],
      },
    });
    expect(screen.getByTitle('game preview')).toBe(before);
  });

  /**
   * Ruling: a screen/rotate change is a live RESIZE of the running game —
   * the legacy harness's `applyScreen` only ever sets the iframe's own
   * width/height — so it must NOT relaunch. Only a change to what the
   * game is actually TOLD (lang/currency/balance/social/device, i.e. the
   * address `previewAddress` builds) is a relaunch. Rotate and a
   * same-device-class preset switch (Desktop→Laptop: neither name starts
   * with `Mobile`) leave the address, and so the iframe's key, untouched
   * — same element, new `width`/`height` props. Desktop→Mobile S changes
   * `device` in the address, so it IS a relaunch — a new element.
   */
  it('Rotate keeps the same iframe element (a resize, not a relaunch) and swaps width/height', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview') as HTMLIFrameElement;
    await userEvent.click(screen.getByTestId('preview-rotate'));
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).toBe(before);
    expect(after.width).toBe('675');
    expect(after.height).toBe('1200');
  });

  it('Desktop→Laptop keeps the same iframe element (same device class, address unchanged) and resizes to 1024×576', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview') as HTMLIFrameElement;
    await userEvent.selectOptions(screen.getByTestId('preview-preset'), 'Laptop');
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).toBe(before);
    expect(after.width).toBe('1024');
    expect(after.height).toBe('576');
  });

  it('choosing Mobile S is a relaunch (device=mobile changes the address) with a NEW element, sized 320×568', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview') as HTMLIFrameElement;
    await userEvent.selectOptions(screen.getByTestId('preview-preset'), 'Mobile S');
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.width).toBe('320');
    expect(after.height).toBe('568');
    expect(new URL(after.src).searchParams.get('device')).toBe('mobile');
  });

  it('changing currency remounts the iframe (a new element) with the new currency in its address', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    await userEvent.selectOptions(screen.getByTestId('preview-currency'), 'EUR');
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(new URL(after.src).searchParams.get('currency')).toBe('EUR');
  });

  it('the balance select lists the eleven harness levels in order, 10K selected by default', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const select = screen.getByTestId('preview-balance') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      BALANCE_LEVELS.map((l) => l.label),
    );
    expect(select.value).toBe('10000');
  });

  it('choosing a balance level relaunches (a new iframe element) with that balance and a bumped wallet', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    await userEvent.selectOptions(screen.getByTestId('preview-balance'), '1000');
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(new URL(after.src).searchParams.get('balance')).toBe('1000');
    expect(new URL(after.src).searchParams.get('wallet')).toBe('1');
  });

  it('↺ (reset balance) relaunches with the same balance and wallet + 1', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    await userEvent.click(screen.getByTestId('preview-balance-reset'));
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(new URL(after.src).searchParams.get('balance')).toBe(String(DEFAULT_PREVIEW_STATE.balance));
    expect(new URL(after.src).searchParams.get('wallet')).toBe('1');
  });

  it('↻ (refresh) remounts the iframe with a byte-identical src; a second click remounts again', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview') as HTMLIFrameElement;
    await userEvent.click(screen.getByTestId('preview-refresh'));
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(before.src);
    await userEvent.click(screen.getByTestId('preview-refresh'));
    const third = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(third).not.toBe(after);
    expect(third.src).toBe(after.src);
  });

  it('the social checkbox toggles social=1 in the address', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    await userEvent.click(screen.getByTestId('preview-social'));
    const iframe = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('social')).toBe('1');
  });

  it('the toolbar choice is remembered across a remount', async () => {
    localStorage.clear();
    const { ctx } = await harness();
    const { unmount } = render(<Preview ctx={ctx} />);
    await userEvent.selectOptions(screen.getByTestId('preview-balance'), '1000');
    unmount();

    const stored: PreviewState = JSON.parse(localStorage.getItem('e8.preview')!);
    expect(stored.balance).toBe(1000);

    render(<Preview ctx={ctx} />);
    const select = screen.getByTestId('preview-balance') as HTMLSelectElement;
    expect(select.value).toBe('1000');
    // …and the wallet that pick started, so the remounted game finds its key.
    const iframe = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('wallet')).toBe('1');
  });

  it('the preset, language, currency and balance controls each have an accessible name', async () => {
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    expect(screen.getByLabelText('screen')).toBe(screen.getByTestId('preview-preset'));
    expect(screen.getByLabelText('language')).toBe(screen.getByTestId('preview-lang'));
    expect(screen.getByLabelText('currency')).toBe(screen.getByTestId('preview-currency'));
    expect(screen.getByLabelText('balance')).toBe(screen.getByTestId('preview-balance'));
    expect(screen.getByRole('button', { name: 'refresh' })).toBe(screen.getByTestId('preview-refresh'));
    expect(screen.getByRole('button', { name: 'reset balance' })).toBe(
      screen.getByTestId('preview-balance-reset'),
    );
  });
});
