import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '@energy8engine/contracts';
import { createDiagnostics, reportAll } from '../src/index';

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

describe('reportAll', () => {
  it('forwards every diagnostic in the list, in order', () => {
    const log = createDiagnostics();
    reportAll(log, [d('first'), d('second')]);
    expect(log.list().map((x) => x.message)).toEqual(['first', 'second']);
  });

  it('a diagnostic that is both returned and forwarded appears once, not twice', () => {
    // The failure mode this whole rule exists to prevent: one event with
    // two writers. A producer's return value goes to exactly one caller,
    // which reports it exactly once — `reportAll` does not itself decide
    // who that caller is, but calling it once must add exactly one entry.
    const log = createDiagnostics();
    const produced = [d('nope')];
    reportAll(log, produced);
    expect(log.list()).toHaveLength(1);
  });

  it('costs nothing against an absent service', () => {
    expect(() => reportAll(undefined, [d('one')])).not.toThrow();
  });

  it('does nothing to an empty list', () => {
    const log = createDiagnostics();
    reportAll(log, []);
    expect(log.list()).toEqual([]);
  });
});

/**
 * The fourth property (see the module doc): the list knows which entries
 * this game produced.
 *
 * `report` is the game's own; `seed` is one it was handed by something that
 * already has a reader of its own at the other end — today, exactly the
 * HOST's project diagnostics, which `createGame` mirrors here so `boot` and
 * the game's page can paint one list. A reader showing the GAME wants both
 * (`list`); a reader FORWARDING to the editor must send only the first
 * (`own`), or one project failure arrives twice and the second copy is
 * attributed to the wrong side.
 */
describe('what this game produced, and what it was handed', () => {
  it('list() holds both, in the order they arrived', () => {
    const log = createDiagnostics();
    log.seed(d('the host said this'));
    log.report(d('the game said this'));
    log.seed(d('the host said this too'));
    expect(log.list().map((x) => x.message)).toEqual([
      'the host said this',
      'the game said this',
      'the host said this too',
    ]);
  });

  it('own() holds only what was reported', () => {
    const log = createDiagnostics();
    log.seed(d('handed over'));
    log.report(d('produced here'));
    expect(log.own().map((x) => x.message)).toEqual(['produced here']);
  });

  it('own() is empty, not everything, when only seeded entries exist', () => {
    // The mistake this catches is the cheap one: an `own()` that forgets to
    // filter reads identically to `list()` on a log where everything was
    // reported anyway.
    const log = createDiagnostics();
    log.seed(d('handed over'));
    expect(log.list()).toHaveLength(1);
    expect(log.own()).toEqual([]);
  });

  it('seed notifies subscribers — it changes what list() shows', () => {
    const log = createDiagnostics();
    let calls = 0;
    log.subscribe(() => {
      calls += 1;
    });
    log.seed(d('handed over'));
    expect(calls).toBe(1);
  });

  it('own() cannot be edited through, the same as list()', () => {
    const log = createDiagnostics();
    log.report(d('original'));
    const taken = log.own() as Diagnostic[];
    taken[0].message = 'rewritten';
    taken.push(d('smuggled in'));
    expect(log.own().map((x) => x.message)).toEqual(['original']);
  });

  it('dropped() counts both kinds, so a forwarder can never understate what was forgotten', () => {
    const log = createDiagnostics({ limit: 2 });
    log.seed(d('first, seeded'));
    log.seed(d('second, seeded'));
    log.report(d('third, reported'));
    expect(log.dropped()).toBe(1);
    expect(log.own().map((x) => x.message)).toEqual(['third, reported']);
    expect(log.list().map((x) => x.message)).toEqual(['second, seeded', 'third, reported']);
  });

  it('seed never throws, the same as report', () => {
    const log = createDiagnostics();
    expect(() => log.seed(null as unknown as Diagnostic)).not.toThrow();
  });
});

/**
 * One composition fact, re-reported on every spin, is one entry.
 *
 * Measured before this: two plugins claiming one step kind, then ten clean
 * successful spins — `executePlan` reads `registry.collisions()` on every
 * call and this service stored the result each time — gave ten identical
 * entries and one distinct message. At the bound the list would have been
 * nothing but that message, every real failure evicted, and every spin
 * forwarded the whole growing list to the IDE.
 *
 * The same identity rule the EDITOR's half of the panel already uses
 * (`ide/client/src/plugins/connection.ts`), because the two halves now sit
 * on one screen.
 */
describe('a repeat is not a second entry', () => {
  it('stores one entry however many times the same complaint is reported', () => {
    const log = createDiagnostics();
    for (let i = 0; i < 10; i += 1) log.report(d('two handlers claim step kind "reelStep"'));
    expect(log.list()).toHaveLength(1);
  });

  it('does not notify on a repeat, so nothing downstream re-sends the list', () => {
    const log = createDiagnostics();
    let calls = 0;
    log.subscribe(() => {
      calls += 1;
    });
    log.report(d('the same complaint'));
    log.report(d('the same complaint'));
    log.report(d('the same complaint'));
    expect(calls).toBe(1);
  });

  it('a repeat does not consume the bound, so real failures are not evicted', () => {
    // The half that matters most: without this, one repeated message at the
    // limit pushes out every distinct failure underneath it.
    const log = createDiagnostics({ limit: 2 });
    log.report(d('a real failure'));
    for (let i = 0; i < 10; i += 1) log.report(d('the composition fact'));
    expect(log.list().map((x) => x.message)).toEqual(['a real failure', 'the composition fact']);
    expect(log.dropped()).toBe(0);
  });

  it('a different failure from the same producer stands alongside', () => {
    // The mistake the editor's own dedupe already learned to avoid: keying
    // on anything wider than the whole complaint collapses unrelated things.
    const log = createDiagnostics();
    log.report({ severity: 'error', plugin: 'p', where: 'w', message: 'first reason' });
    log.report({ severity: 'error', plugin: 'p', where: 'w', message: 'second reason' });
    log.report({ severity: 'error', plugin: 'p', where: 'other', message: 'first reason' });
    expect(log.list()).toHaveLength(3);
  });

  it('the same complaint with better advice replaces the earlier wording', () => {
    // `fix` is advice about the complaint, not part of what happened.
    const log = createDiagnostics();
    log.report({ severity: 'error', plugin: 'p', where: 'w', message: 'm' });
    log.report({ severity: 'error', plugin: 'p', where: 'w', message: 'm', fix: 'try this' });
    expect(log.list()).toEqual([
      { severity: 'error', plugin: 'p', where: 'w', message: 'm', fix: 'try this' },
    ]);
  });

  it('a seeded repeat collapses the same way', () => {
    const log = createDiagnostics();
    log.seed(d('the host said this'));
    log.seed(d('the host said this'));
    expect(log.list()).toHaveLength(1);
    expect(log.own()).toEqual([]);
  });
});

/**
 * Slice 28 — retraction. A producer that re-validates and finds a complaint
 * gone (the flow's `unknown kind` once the kind registers) takes back its
 * OWN entries by `plugin`/`where`; nothing else moves, and subscribers hear
 * one change when anything was removed and none when nothing was.
 */
describe('retract', () => {
  it('drops every entry with that plugin/where pair — reported or seeded — and nothing else', () => {
    const log = createDiagnostics();
    log.report({ severity: 'error', plugin: 'flow', where: 'x', message: "unknown kind 'sound'" });
    log.report({ severity: 'warning', plugin: 'flow', where: 'x', message: 'another on x' });
    log.report({ severity: 'error', plugin: 'flow', where: 'y', message: 'on y' });
    log.report({ severity: 'error', plugin: 'scenes', where: 'x', message: 'same where, other plugin' });
    log.seed({ severity: 'error', plugin: 'flow', where: 'x', message: 'seeded on x' });
    log.retract('flow', 'x');
    expect(log.list().map((d) => `${d.plugin}/${d.where}`)).toEqual(['flow/y', 'scenes/x']);
  });

  it('notifies once when something was removed, not at all when nothing matched', () => {
    const log = createDiagnostics();
    log.report(d('one'));
    const seen = vi.fn();
    log.subscribe(seen);
    log.retract('p', 'nowhere');
    expect(seen).not.toHaveBeenCalled();
    log.retract('p', 'w');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(log.list()).toEqual([]);
  });

  it('never throws, and does not count a retraction as a drop', () => {
    const log = createDiagnostics();
    log.report(d('one'));
    log.subscribe(() => {
      throw new Error('listener blew up');
    });
    expect(() => log.retract('p', 'w')).not.toThrow();
    expect(log.dropped()).toBe(0);
  });
});
