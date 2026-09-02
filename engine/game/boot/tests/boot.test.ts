import { describe, expect, it } from 'vitest';
import { renderBootFailure } from '../src/index';

describe('the boot failure screen', () => {
  it('renders every diagnostic it was given', () => {
    const root = document.createElement('div');
    renderBootFailure(root, [
      { severity: 'error', plugin: 'reels', where: 'config', message: 'speed must be a number' },
      { severity: 'error', plugin: 'session', where: 'binary', message: 'e8-server not found' },
    ]);
    expect(root.textContent).toContain('speed must be a number');
    expect(root.textContent).toContain('e8-server not found');
  });

  it('shows the fix hint when there is one', () => {
    const root = document.createElement('div');
    renderBootFailure(root, [
      { severity: 'error', plugin: 'p', where: 'w', message: 'm', fix: 'install it' },
    ]);
    expect(root.textContent).toContain('install it');
  });

  it('needs no renderer — it is DOM, so a broken renderer can still be reported', () => {
    const root = document.createElement('div');
    expect(() => renderBootFailure(root, [])).not.toThrow();
  });

  it('says something even when handed an empty list', () => {
    const root = document.createElement('div');
    renderBootFailure(root, []);
    expect(root.textContent?.length).toBeGreaterThan(0);
  });

  it('replaces whatever was already in root, rather than appending to it', () => {
    const root = document.createElement('div');
    root.textContent = 'stale content from a previous attempt';
    renderBootFailure(root, [
      { severity: 'error', plugin: 'p', where: 'w', message: 'fresh message' },
    ]);
    expect(root.textContent).not.toContain('stale content');
    expect(root.textContent).toContain('fresh message');
  });
});
