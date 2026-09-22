/**
 * `count`: runs a text node's `text` prop from one number up to another —
 * the win counter every slot has — writing a formatted value on each
 * frame and the EXACT end value last, so what the player is left reading
 * is the real number rather than wherever the interpolation happened to
 * land on its final frame.
 *
 * It is a ramp, not a `Tween`. `Tween.to` has no per-tick hook, so
 * counting through it would mean tweening a throwaway `{ n }` object and
 * polling it from a SECOND loop — two clocks (the pixi ticker and
 * whatever polls) racing over one text field. One loop reading
 * `Easing[...]` itself is the same arithmetic with half the moving parts,
 * and it is exactly what this package's audio ramps already do
 * (`./audio-state.ts`), down to the injectable `Clock` the tests step by
 * hand.
 *
 * `target` is `<scene>/<node>` (`parseTarget`, shared with `prop` and
 * `tween`), and the node must have a `text` prop — a node that does not,
 * or a ref nothing is mounted at, is a diagnostic on the flow node
 * (`report`) and an exit by `next`, never a thrown branch.
 *
 * Leaving: `wait: true` (the default) waits for the count, `wait: false`
 * leaves at once and lets it finish in the background. Either way a
 * `ui.skip` on the flow bus jumps straight to the end value, and the
 * abort signal (`stop()`/`replace()`) stops the loop where it is without
 * writing anything further.
 */
import { Easing } from '@energy8platform/game-engine/animation';
import Schema from 'schemastery';
import type { ScenesService } from '@energy8engine/scenes';
import {
  formatValue,
  parseTarget,
  resolveValue,
  type EventsService,
  type FlowNodeKind,
} from '@energy8engine/flow';
import { rafClock, type Clock } from './audio-state';
import { EASINGS } from './tween';

export interface CountProps {
  /** `<scene>/<node>` — the text node whose `text` counts. */
  target: string;
  /** Start value: a number, `$expr`, or a `{…}` template. */
  from: string;
  /** End value: a number, `$expr`, or a `{…}` template. */
  to: string;
  ms: number;
  easing: string;
  /** How each value is written; `''` is `String(n)`. */
  format: string;
  /** `false`: leave by `next` at once and let the count finish on its own. */
  wait: boolean;
}

export interface CountDeps {
  clock?: Clock;
}

/**
 * The formats this prop offers, as a dropdown. `fixed:1`/`fixed:2` are the
 * two a slot counter needs; the expression pipe's own `| fixed:N` stays
 * general.
 */
const FORMATS = ['', 'currency', 'int', 'fixed:1', 'fixed:2', 'multiplier'];

export function createCount(deps: CountDeps = {}): FlowNodeKind<CountProps> {
  const clock = deps.clock ?? rafClock;
  /**
   * The count running on each `<scene>/<node>`, so a second one takes the
   * node over instead of racing the first for its `text`. One node holds
   * one value: two ramps writing it interleave, and the loser's last frame
   * can land after the winner's end value — a flow that counts once per
   * tumble segment under `wait: false` (the example's own `show_win`) is
   * the ordinary case, not an edge one. The incumbent is finished as if it
   * had been skipped: it writes its own end value and settles, so a branch
   * awaiting it is released rather than abandoned.
   */
  const running = new Map<string, () => void>();
  return {
    kind: 'count',
    schema: Schema.object({
      target: Schema.string()
        .required()
        .extra('pick', 'node')
        .description('<scene>/<node> whose `text` counts'),
      from: Schema.string()
        .default('0')
        .description('start value: a number, `$expr`, or a `{…}` template'),
      to: Schema.string()
        .required()
        .description('end value: a number, `$expr`, or a `{…}` template'),
      ms: Schema.number().default(600).description('duration, milliseconds'),
      easing: Schema.union(EASINGS).default('easeOutQuad'),
      format: Schema.union(FORMATS)
        .default('')
        .description('how each value is written; `fixed:N` in an `$expr` pipe stays general'),
      wait: Schema.boolean()
        .default(true)
        .description('wait for the count to finish before leaving by `next`'),
    }) as Schema<CountProps>,
    outs: ['next'],
    // A count is as long as its `ms`, and a skipped one ends early — but a
    // slow one is not a hung flow, so the interpreter's 30 s cap is off,
    // same as `tween`'s siblings in `@energy8engine/flow`.
    timeout: false,
    async run(p, { ctx, vars, signal, report }) {
      if (signal.aborted) throw signal.reason;
      const scenes = ctx.reflect.get('scenes', false) as ScenesService | undefined;
      if (!scenes) {
        report(`no 'scenes' service in this composition`);
        return { out: 'next' };
      }
      const ref = parseTarget(String(resolveValue(p.target, vars, report) ?? ''));
      if (!ref) {
        report('target must be <scene>/<node>');
        return { out: 'next' };
      }
      // `hasOwn`, not `in`, for the same reason `prop` uses it: `toString`
      // and friends are on every object's prototype.
      const dict = scenes.nodeSchema(ref)?.dict;
      if (dict && !Object.hasOwn(dict, 'text')) {
        report(`node "${ref.scene}/${ref.node}" has no prop "text"`);
        return { out: 'next' };
      }

      const ends = (['from', 'to'] as const).map((k) => {
        const n = Number(resolveValue(p[k], vars, report));
        if (Number.isNaN(n)) report(`${k} "${p[k]}" is not a number`);
        return n;
      });
      const [from, to] = ends;
      if (ends.some(Number.isNaN)) return { out: 'next' };

      // `''.split(':')` is `['']`, so no format at all writes the plain number.
      const [name, arg] = p.format.split(':');
      const write = (n: number): boolean =>
        scenes.setProps(ref, { text: name ? formatValue(name, n, arg, vars) : String(n) });

      // Whatever was counting this node stops here, at its own end value.
      const where = `${ref.scene}/${ref.node}`;
      running.get(where)?.();

      // The first value goes down before any frame passes, and its refusal
      // is the one diagnostic worth raising: a per-tick report would spam
      // the node with one copy per frame for the whole count.
      if (!write(from)) {
        report(`could not set 'text' on "${ref.scene}/${ref.node}"`);
        return { out: 'next' };
      }
      if (p.ms <= 0) {
        write(to);
        return { out: 'next' };
      }

      const ease = Easing[p.easing] ?? Easing.linear;
      const offs: (() => void)[] = [];
      let settle!: (aborted: boolean) => void;
      const done = new Promise<boolean>((resolve) => (settle = resolve));
      /**
       * The single exit: unhooks the clock, the bus and the signal (leaving
       * any of them registered would keep writing to a node this run is
       * done with), writes the exact end value unless the run was cut
       * short, and releases whoever waits.
       */
      const finish = (aborted: boolean): void => {
        for (const off of offs.splice(0)) off();
        if (running.get(where) === superseded) running.delete(where);
        if (!aborted) write(to);
        settle(aborted);
      };
      const superseded = () => finish(false);
      running.set(where, superseded);

      const started = clock.now();
      offs.push(
        clock.tick(() => {
          const t = (clock.now() - started) / p.ms;
          if (t >= 1) return finish(false);
          write(from + (to - from) * ease(t));
        }),
      );
      const bus = ctx.reflect.get('events', false) as EventsService | undefined;
      if (bus) offs.push(bus.on('ui.skip', () => finish(false)));
      const onAbort = () => finish(true);
      signal.addEventListener('abort', onAbort, { once: true });
      offs.push(() => signal.removeEventListener('abort', onAbort));

      if (p.wait === false) return { out: 'next' };
      if (await done) throw signal.reason;
      return { out: 'next' };
    },
  };
}
