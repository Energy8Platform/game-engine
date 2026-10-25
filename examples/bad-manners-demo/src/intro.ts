import { createBadMannersPreloader } from '@energy8platform/bad-manners/preloader';
import { createCSSPreloader, setCSSPreloaderProgress } from '@energy8platform/platform-core/loading';

// Intro-only page (no Pixi): ?p=<0..1> sets the load progress, ?accent=<hex> the accent.
const game = document.getElementById('game')!;
const accent = new URLSearchParams(location.search).get('accent');
createCSSPreloader(game, { preloaderVariant: createBadMannersPreloader({ accent: accent ? `#${accent}` : undefined }) });
const p = Number(new URLSearchParams(location.search).get('p') ?? '0.3');
setCSSPreloaderProgress(p);
