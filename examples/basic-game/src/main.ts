import {
  GameApplication,
  ScaleMode,
} from '@energy8platform/game-engine';
import { GameScene } from './scenes/GameScene';

/**
 * Basic game example demonstrating the engine's core features:
 * - CSS preloader → Canvas loading screen → Game scene
 * - SDK integration via DevBridge (mock)
 * - Responsive viewport scaling
 * - UI components (Button, Label, BalanceDisplay)
 */
async function bootstrap() {
  const game = new GameApplication({
    container: '#game',
    designWidth: 1920,
    designHeight: 1080,
    scaleMode: ScaleMode.FIT,
    loading: {
      backgroundColor: 0x0a0a1a,
      backgroundGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a0a1a 100%)',
      showPercentage: true,
      tapToStart: true,
      tapToStartText: 'TAP TO PLAY',
      minDisplayTime: 2000,
    },
    manifest: {
      bundles: [
        {
          name: 'preload',
          assets: [
            // Preload bundle is loaded first — put logo and minimal assets here
            // { alias: 'logo', src: 'logo.png' },
          ],
        },
        {
          name: 'game',
          assets: [
            // Main game assets loaded with progress bar
            // { alias: 'background', src: 'background.png' },
            // { alias: 'symbols', src: 'symbols.json' },
          ],
        },
      ],
    },
    audio: {
      music: 0.5,
      sfx: 1.0,
      persist: true,
    },
    sdk: {
      debug: true,
      devMode: true
    },
    debug: true,
  });

  // Register scenes
  game.scenes.register('game', GameScene);

  // Listen for events
  game.on('initialized', () => console.log('✅ Engine initialized'));
  game.on('loaded', () => console.log('✅ Assets loaded'));
  game.on('started', () => console.log('✅ Game started'));
  game.on('resize', ({ width, height }) =>
    console.log(`📐 Resize: ${Math.round(width)}×${Math.round(height)}`),
  );
  game.on('error', (err) => console.error('❌ Error:', err));

  // Start!
  try {
    await game.start('game');
  } catch (err) {
    console.error('Failed to start game:', err);
  }
}

bootstrap();
