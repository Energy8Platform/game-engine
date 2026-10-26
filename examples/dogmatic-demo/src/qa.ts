import { Application } from 'pixi.js';
import { createDogmaticShell } from '@energy8platform/dogmatic/shell';

// The provider's own preview config (dogmatic/src/main.ts), to compare overlays 1:1 with their QA
// screenshots: ?open=info|bet|auto|buybonus|modal|replay
const game = document.getElementById('game')!;
const app = new Application();
await app.init({ resizeTo: game, background: '#000000', antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
game.appendChild(app.canvas);
const shell = createDogmaticShell({
  app, language: 'en', version: '0.1.0',
  theme: { scheme: 'dark', accent: '#ff961f' },
  currency: { symbol: '$', position: 'left', minDecimals: 2, maxDecimals: 2 },
  availableBets: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100], defaultBet: 1, currentBet: 1,
  balance: 1000, win: 0, mode: 'base', volumes: { music: 0.6, sfx: 0.8 },
  features: {
    turbo: 2, autoplay: { maxCount: 100 },
    buyBonus: [
      { id: 'demo_bonus', type: 'bonus', title: 'BONUS', description: 'Example card for reviewing the interface.', priceMultiplier: 100, accentColor: '#ff961f' },
      { id: 'demo_feature', type: 'feature', title: 'FEATURE', description: 'Example of an optional base-game modifier.', priceMultiplier: 2, accentColor: '#ff961f' },
    ],
  },
  gameInfo: { sections: [
    { type: 'controls', order: 0 },
    { type: 'hotkeys', order: 1 },
    { type: 'custom', title: 'DOGMATIC', order: 2, html: '<p>This is a provider shell preview. The connected game supplies its rules, payouts and feature descriptions.</p>' },
  ] },
});
(window as unknown as { __shell: unknown }).__shell = shell;
const open = new URLSearchParams(location.search).get('open');
setTimeout(() => {
  if (open === 'info') shell.openInfo();
  else if (open === 'bet') shell.openBetPicker();
  else if (open === 'auto') shell.openAutoplayPicker();
  else if (open === 'buybonus') shell.openBuyBonus();
  else if (open === 'modal') shell.openModal({ availableClose: true, title: 'Insufficient funds', body: 'Top up your balance to keep playing.', actions: [{ title: 'OK', color: '#ff961f' }] });
  else if (open === 'replay') shell.openReplay({ bonusId: 'demo_bonus', bet: 1, payoutMultiplier: 87.5, onReplay: () => {} });
}, 300);
