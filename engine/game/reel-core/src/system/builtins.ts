// engine/game/reel-core/src/system/builtins.ts
//
// The built-in pieces the rows register: the three motion styles (all the forked `SpinEngine`,
// told which style to run), the config-driven anticipator and the `tumble` board controller.

import { SpinEngine } from '../motion/SpinEngine';
import { AnticipationController } from '../motion/AnticipationController';
import { TumbleController, type TumbleStep } from '../cascade/TumbleController';
import type { AnticipationConfig, CascadeConfig } from '../config/ReelSystemConfig';
import type { Anticipator, BoardController, MotionStyle } from './contracts';

function spinEngineStyle(key: string): MotionStyle {
  return {
    key,
    create(kit, config) {
      const engine = new SpinEngine(kit.grid, kit.resolve, { ...config, style: key }, kit.win);
      return {
        plan: (target, opts) => engine.plan({ targetGrid: target }, opts),
        run: (target, opts) => engine.run({ targetGrid: target }, opts),
        skip: () => engine.skip(),
      };
    },
  };
}

export const BUILTIN_MOTION_STYLES: MotionStyle[] = ['swap', 'strip', 'cascade-drop'].map(
  spinEngineStyle,
);

export function createAnticipator(config: AnticipationConfig): Anticipator {
  const ctl = new AnticipationController(config);
  return {
    config,
    decide: (target) => ctl.decide(target),
    zoomIn: (grid) => ctl.zoomIn(grid),
  };
}

export function tumbleController(config: CascadeConfig): BoardController<TumbleStep> {
  return {
    kind: 'tumble',
    create(kit) {
      const ctl = new TumbleController(kit.grid, config, kit.win);
      return {
        run(step, opts) {
          // The core plays ONE tumble step per `cascade` call and never carries `freeSpins`, so
          // the legacy per-call reset (`!persistInFreeSpins || !freeSpins`) always resets here.
          ctl.resetMultiplier();
          return ctl.step(step, 0, opts);
        },
        skip: () => ctl.skip(),
      };
    },
  };
}
