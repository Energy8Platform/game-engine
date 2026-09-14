import type { Context } from 'cordis';
import Schema from 'schemastery';

export interface Config {
  speed: number;
  direction: 'up' | 'down';
  holdSpins: number;
}

export const name = 'probe';

export const Config: Schema<Config> = Schema.object({
  speed: Schema.number().min(1).max(20).step(1).default(8).description('reel speed'),
  direction: Schema.union(['up', 'down'] as const)
    .default('up')
    .description('fill direction'),
  holdSpins: Schema.number()
    .min(0)
    .max(10)
    .default(1)
    .description('holds')
    .extra('extra', { applies: 'restart' }),
});

export interface ProbeService {
  describe(): string;
}

export function apply(ctx: Context, config: Config) {
  ctx.effect(() => {
    console.info(`probe up at speed ${config.speed}`);
    return () => console.info('probe down');
  }, 'probe-effect');

  ctx.provide('probe', {
    describe: () => `${config.direction} @ ${config.speed}`,
  } satisfies ProbeService);
}
