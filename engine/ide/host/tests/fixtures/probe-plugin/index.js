// This fixture's package.json name, "probe-plugin", must stay unique across the
// whole monorepo: the host tests in ../../ resolve it by that npm name through
// @cordisjs/plugin-loader, which only works if it hoists to the repo's root
// node_modules (see composition.ts's schemaOf()). A second workspace package
// sharing this name silently breaks that hoist — no diagnostic, just this
// fixture's fiber state and schema going null wherever it's read.
import Schema from 'schemastery';

export const name = 'probe';
export const Config = Schema.object({
  speed: Schema.number().min(1).max(20).default(8).description('reel speed'),
});

export function apply(ctx, config) {
  globalThis.__probeApplied ??= [];
  globalThis.__probeApplied.push(config.speed);
  ctx.effect(() => () => globalThis.__probeApplied.push('off'), 'probe-effect');
}
