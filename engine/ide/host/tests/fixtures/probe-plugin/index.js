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
