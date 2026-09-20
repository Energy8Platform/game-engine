/**
 * Shell → flow, mechanically: each `ShellEvents` entry re-emitted as
 * `shell.<name>` with the payload as an object, so a flow's `on { event:
 * shell.spin }` / `wait { event: shell.settingChange }` read it like any
 * other bus event. The row decides nothing here — no filtering, no
 * renaming, no state.
 */
import type { Shell, ShellEvents } from '@energy8platform/shell/pixi';

/** Every event the shell emits (`ShellEvents` in `@energy8platform/shell`), in declaration order. */
export const SHELL_EVENTS = [
  'spin',
  'betChange',
  'autoplayStart',
  'autoplayStop',
  'turboChange',
  'buyBonusSelect',
  'featureActivate',
  'featureDeactivate',
  'menuOpen',
  'settingsOpen',
  'infoOpen',
  'settingChange',
] as const satisfies readonly (keyof ShellEvents)[];

/** Exhaustive, at the type level: a thirteenth `ShellEvents` entry fails typecheck here until it is listed above. */
type Assert<T extends true> = T;
export type ShellEventsAllListed = Assert<
  [Exclude<keyof ShellEvents, (typeof SHELL_EVENTS)[number]>] extends [never] ? true : false
>;

/** An object passes as is, `void` becomes `{}`, a scalar becomes `{ value }` — so `$event.value` always names a scalar. */
export function toObject(payload: unknown): Record<string, unknown> {
  if (payload === undefined) return {};
  if (typeof payload === 'object' && payload !== null) return payload as Record<string, unknown>;
  return { value: payload };
}

/** Subscribes every `SHELL_EVENTS` entry; the returned function unsubscribes them all. */
export function relay(
  shell: Pick<Shell, 'on' | 'off'>,
  emit: (name: string, payload: Record<string, unknown>) => void,
): () => void {
  const offs = SHELL_EVENTS.map((name) => {
    const fn = (payload: unknown) => emit(`shell.${name}`, toObject(payload));
    shell.on(name, fn);
    return () => void shell.off(name, fn);
  });
  return () => offs.forEach((off) => off());
}
