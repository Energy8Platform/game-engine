import React from 'react';
import { createRoot } from 'react-dom/client';
import { createIdeClient } from '@energy8engine/ide-client';
import { App } from './App';

// Plugin client halves run as plain, untranspiled ES modules straight from
// the browser (see `engine/ide/host/src/plugins/client-assets.ts`), so they
// cannot `import React from 'react'` — no import map resolves that bare
// specifier, and bundling React per plugin would load several copies and
// break hooks. Instead the shell publishes the one React it runs on here,
// before the client context boots, so every plugin's client half reads it
// off this global instead of importing its own.
(globalThis as any).__E8_IDE__ = { React };

// Top-level await: `createIdeClient` is async (it awaits the cordis fiber
// for `connection` reaching ACTIVE before handing back a `Context` with the
// service actually on it — see ide/client/src/context.ts) and Vite serves
// this as a native ES module, which supports top-level await directly.
const ctx = await createIdeClient({ url: `ws://${location.host}/ide` });

createRoot(document.getElementById('root')!).render(<App ctx={ctx} />);
