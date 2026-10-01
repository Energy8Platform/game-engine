// Declaration smoke check, run after every build (`postbuild`): the built `.d.ts` of every Pixi
// entry must hand back the SAME Shell type. game-engine's `ShellFactory` is typed against
// `/pixi`'s Shell; when each entry inlined its own copy of the class (it has private members, so TS
// compares it nominally), `shellFactory: createPixiHbShell` stopped type-checking in games.
import type { Shell, PixiShellConfig } from '@energy8platform/shell/pixi';
import { createPixiShell } from '@energy8platform/shell/pixi';
import { createPixiHbShell } from '@energy8platform/shell/pixi-hb';
import { createPixiSShell } from '@energy8platform/shell/pixi-s';
import type { Shell as CoreShell } from '@energy8platform/shell';

type ShellFactory = (config: PixiShellConfig) => Shell;

export const factories: ShellFactory[] = [createPixiShell, createPixiHbShell, createPixiSShell];
export const sameAsCore: CoreShell | null = null as Shell | null;
