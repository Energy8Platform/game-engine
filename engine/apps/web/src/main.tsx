import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  createIdeClient,
  useEditorDiagnostics,
  useGameComposition,
  useGameDiagnostics,
  useLayout,
  useSlot,
} from '@energy8engine/ide-client';
import { App } from './App';

// Plugin client halves run as plain, untranspiled ES modules straight from
// the browser (see `engine/ide/host/src/plugins/client-assets.ts`), so they
// cannot `import React from 'react'` — no import map resolves that bare
// specifier, and bundling React per plugin would load several copies and
// break hooks. Instead the shell publishes the one React it runs on here,
// before the client context boots, so every plugin's client half reads it
// off this global instead of importing its own.
//
// The hooks travel with it, for the same reason and one more: a screen
// that can register but cannot SUBSCRIBE is not a first-class screen. A
// plugin's screen is a React component like any other, and the only way it
// can watch a service move — the game's composition being fetched, a card
// arriving in a slot, a game reporting trouble — is these. They are
// exactly the ones `App` below uses for the two screens the engine ships;
// nothing is held back for the shipped half.
(globalThis as any).__E8_IDE__ = {
  React,
  useLayout,
  useSlot,
  useGameComposition,
  useGameDiagnostics,
  useEditorDiagnostics,
};

// Top-level await: `createIdeClient` is async (it awaits the cordis fiber
// for `connection` reaching ACTIVE before handing back a `Context` with the
// service actually on it — see ide/client/src/context.ts) and Vite serves
// this as a native ES module, which supports top-level await directly.
const ctx = await createIdeClient({ url: `ws://${location.host}/ide` });

createRoot(document.getElementById('root')!).render(<App ctx={ctx} />);
