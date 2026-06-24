// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  showFatalError, buildFatalErrorModal, fatalMessage, installGlobalErrorHandlers,
} from '../../src/host/fatalError';

describe('fatalMessage', () => {
  it('extracts a message from string / Error / {message} / {reason}', () => {
    expect(fatalMessage('boom')).toBe('boom');
    expect(fatalMessage(new Error('exploded'))).toBe('exploded');
    expect(fatalMessage({ message: 'msg' })).toBe('msg');
    expect(fatalMessage({ reason: new Error('rejected') })).toBe('rejected');
  });
  it('falls back for null/undefined', () => {
    expect(fatalMessage(null)).toBe('Something went wrong.');
    expect(fatalMessage(undefined)).toBe('Something went wrong.');
  });
});

describe('buildFatalErrorModal', () => {
  it('renders the message and a Reload button that runs onReload', () => {
    const onReload = vi.fn();
    const el = buildFatalErrorModal('Kaput', onReload);
    expect(el.querySelector('.e8-fatal-message')!.textContent).toBe('Kaput');
    const btn = el.querySelector<HTMLButtonElement>('.e8-fatal-reload')!;
    expect(btn.textContent).toBe('Reload');
    btn.click();
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('showFatalError', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="game"></div>'; });

  it('appends a modal carrying the message into the container selector', () => {
    showFatalError('#game', 'Boom happened');
    const host = document.querySelector('#game')!;
    expect(host.textContent).toContain('Boom happened');
    expect(host.querySelector('.e8-fatal-reload')).not.toBeNull();
  });

  it('accepts an element container', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    showFatalError(el, 'Direct element');
    expect(el.textContent).toContain('Direct element');
  });

  it('is idempotent — replaces the message instead of stacking modals', () => {
    showFatalError('#game', 'first');
    showFatalError('#game', 'second');
    const modals = document.querySelectorAll('#e8-fatal-error');
    expect(modals.length).toBe(1);
    expect(modals[0].textContent).toContain('second');
    expect(modals[0].textContent).not.toContain('first');
  });
});

describe('installGlobalErrorHandlers', () => {
  it('surfaces uncaught errors and unhandled rejections through fatal, and disposes', () => {
    const fatal = vi.fn();
    const dispose = installGlobalErrorHandlers('#game', fatal);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught') }));
    expect(fatal).toHaveBeenCalledWith('uncaught');

    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('SDKError: nope') });
    window.dispatchEvent(rejection);
    expect(fatal).toHaveBeenCalledWith('SDKError: nope');

    dispose();
    fatal.mockClear();
    // No `error` field → jsdom won't rethrow; the listener (if still attached) would fire on `message`.
    window.dispatchEvent(new ErrorEvent('error', { message: 'after dispose' }));
    expect(fatal).not.toHaveBeenCalled();
  });
});
