import { defineConfig } from 'vite';

// Plain vanilla-TS Vite app — the game shell is renderer-agnostic DOM,
// so this example needs no Pixi/React/devBridge plumbing.
export default defineConfig({
  base: '/',
});
