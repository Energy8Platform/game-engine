import { createContext, useContext } from 'react';
import type { GameApplication } from '../core/GameApplication';
import type { AudioManager } from '../audio/AudioManager';
import type { InputManager } from '../input/InputManager';
import type { ViewportManager } from '../viewport/ViewportManager';
import type { CasinoGameSDK } from '@energy8platform/game-sdk';
import type { GameConfigData } from '@energy8platform/game-sdk';

export interface EngineContextValue {
  app: GameApplication;
  sdk: CasinoGameSDK | null;
  audio: AudioManager;
  input: InputManager;
  viewport: ViewportManager;
  gameConfig: GameConfigData | null;
  screen: { width: number; height: number; scale: number };
  isPortrait: boolean;
}

export const EngineContext = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine() must be used inside a ReactScene');
  return ctx;
}
