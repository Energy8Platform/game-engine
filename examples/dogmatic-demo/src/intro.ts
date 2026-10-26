import { dogmaticPreloader } from '@energy8platform/dogmatic/preloader';
import { createCSSPreloader, setCSSPreloaderProgress } from '@energy8platform/platform-core/loading';

// Loader-only page (no Pixi): ?p=<0..1> sets the load progress.
const game = document.getElementById('game')!;
createCSSPreloader(game, { preloaderVariant: dogmaticPreloader });
setCSSPreloaderProgress(Number(new URLSearchParams(location.search).get('p') ?? '0.3'));
