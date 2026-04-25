import { useState, useEffect } from 'react';
import { useEngine } from './EngineContext';
import type { CasinoGameSDK, SessionData, GameConfigData } from '@energy8platform/game-sdk';
import type { AudioManager } from '../audio/AudioManager';
import type { InputManager } from '../input/InputManager';

export function useSDK(): CasinoGameSDK | null {
  return useEngine().sdk;
}

export function useAudio(): AudioManager {
  return useEngine().audio;
}

export function useInput(): InputManager {
  return useEngine().input;
}

export function useViewport(): { width: number; height: number; scale: number; isPortrait: boolean } {
  const { screen, isPortrait } = useEngine();
  return { ...screen, isPortrait };
}

export function useBalance(): number {
  const { sdk } = useEngine();
  const [balance, setBalance] = useState(sdk?.balance ?? 0);

  useEffect(() => {
    if (!sdk) return;
    const handler = (data: { balance: number }) => setBalance(data.balance);
    sdk.on('balanceUpdate', handler);
    return () => {
      sdk.off('balanceUpdate', handler);
    };
  }, [sdk]);

  return balance;
}

export function useSession(): SessionData | null {
  return useEngine().app.session;
}

export function useGameConfig<T = GameConfigData>(): T | null {
  return useEngine().gameConfig as T | null;
}
