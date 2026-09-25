import { markModuleCopy } from '@energy8engine/contracts';

export { Tween } from './Tween';
export { Easing } from './Easing';
export type { EasingFunction } from './Easing';

// Holds the tween registry — a second copy is reported at boot (contracts' module-copies.ts).
markModuleCopy('@energy8engine/tween', import.meta.url);
