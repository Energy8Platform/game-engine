import { createRoot } from 'react-dom/client';
import { createIdeClient } from '@energy8engine/ide-client';
import { App } from './App';

// Top-level await: `createIdeClient` is async (it awaits the cordis fiber
// for `connection` reaching ACTIVE before handing back a `Context` with the
// service actually on it — see ide/client/src/context.ts) and Vite serves
// this as a native ES module, which supports top-level await directly.
const ctx = await createIdeClient({ url: `ws://${location.host}/ide` });

createRoot(document.getElementById('root')!).render(<App ctx={ctx} />);
