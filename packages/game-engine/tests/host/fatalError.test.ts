// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { showFatalError } from '../../src/host/fatalError';

describe('showFatalError', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="game"></div>'; });
  it('appends an overlay carrying the message into the container selector', () => {
    showFatalError('#game', 'Boom happened');
    const host = document.querySelector('#game')!;
    expect(host.textContent).toContain('Boom happened');
    expect(host.querySelector('div')).not.toBeNull();
  });
  it('accepts an element container', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    showFatalError(el, 'Direct element');
    expect(el.textContent).toContain('Direct element');
  });
});
