// Re-export the renderer-agnostic branded game shell from platform-core so
// game-engine consumers can import it via @energy8platform/game-engine/shell.
export {
  createGameShell,
  removeGameShell,
  GameShell,
} from '@energy8platform/platform-core/shell';
export type {
  ShellConfig,
  ShellMode,
  ShellFeatures,
  ShellState,
  ShellEvents,
  BonusOption,
  CurrencyConfig,
  ThemeConfig,
  GameInfoContent,
  AutoplayOptions,
  FreeSpinsState,
} from '@energy8platform/platform-core/shell';
