import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createIdeClient, type ActivityMeta, type SlotMeta } from '@energy8engine/ide-client';
import { App } from '../src/App';

/**
 * Every button on the activity bar — the four `App` registers and the
 * `scenes` plugin's own, which `createIdeClient` applies — has an icon of
 * its own. Two buttons sharing one shape read as one thing twice
 * (Composition and Scenes both drew `layers` for a slice); and a name the
 * shell's map does not know falls back to a letter, which is what a
 * plugin with no icon gets, not what a shipped one should.
 */
describe('activity icons', () => {
  it('are pairwise distinct, and every one resolves to a drawn shape', async () => {
    const ctx = await createIdeClient({
      url: 'ws://x/ide',
      socketFactory: () => ({ readyState: 1, addEventListener() {}, send() {}, close() {} }),
      importModule: async () => ({}),
      fetchFn: (async () =>
        new Response(JSON.stringify({ rows: [], diagnostics: [], entries: [] }), {
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    render(<App ctx={ctx} />);
    const activities = ctx.slots.list<SlotMeta & ActivityMeta>('shell.activity');
    expect(activities.map((a) => a.key)).toEqual(
      expect.arrayContaining(['workspace', 'explorer', 'composition', 'preview', 'scenes']),
    );
    const icons = activities.map((a) => a.icon);
    expect(new Set(icons).size).toBe(icons.length);
    for (const button of within(screen.getByTestId('activity-bar')).getAllByRole('button')) {
      expect(button.querySelector('svg path')).not.toBeNull();
      expect(button.querySelector('.e8-activity-letter')).toBeNull();
    }
  });
});
