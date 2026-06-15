export type * from './types';

// Real implementations land in later tasks. Stubs keep the public surface
// importable and let the build/test wiring be verified first.
export function createGameShell(): never {
  throw new Error('createGameShell not implemented yet');
}

export function removeGameShell(): Promise<void> {
  return Promise.resolve();
}
