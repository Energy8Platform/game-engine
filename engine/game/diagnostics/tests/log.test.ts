import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '@energy8engine/contracts';
import { createDiagnostics } from '../src/index';

const d = (message: string) => ({ severity: 'error' as const, plugin: 'p', where: 'w', message });

describe('createDiagnostics', () => {
  it('keeps what was reported, oldest first', () => {
    const log = createDiagnostics();
    log.report(d('first'));
    log.report(d('second'));
    expect(log.list().map((x) => x.message)).toEqual(['first', 'second']);
  });

  it('a caller cannot edit the service through what list() returns', () => {
    const log = createDiagnostics();
    log.report(d('kept'));
    (log.list() as Diagnostic[]).push(d('smuggled'));
    expect(log.list()).toHaveLength(1);
  });

  it('notifies subscribers once per report', () => {
    const log = createDiagnostics();
    const seen = vi.fn();
    log.subscribe(seen);
    log.report(d('one'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a disposed subscriber stops hearing', () => {
    const log = createDiagnostics();
    const seen = vi.fn();
    log.subscribe(seen)();
    log.report(d('one'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('a subscriber that throws does not stop the others, and does not stop the report', () => {
    // A panel that blows up while rendering must not cost the next listener
    // its notification, nor lose the diagnostic that triggered it.
    const log = createDiagnostics();
    const after = vi.fn();
    log.subscribe(() => {
      throw new Error('listener blew up');
    });
    log.subscribe(after);
    expect(() => log.report(d('one'))).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(log.list()).toHaveLength(1);
  });

  it('is bounded, and says how many it forgot', () => {
    const log = createDiagnostics({ limit: 2 });
    log.report(d('a'));
    log.report(d('b'));
    log.report(d('c'));
    expect(log.list().map((x) => x.message)).toEqual(['b', 'c']);
    expect(log.dropped()).toBe(1);
  });
});
