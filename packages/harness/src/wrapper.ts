/**
 * Core wrapper page — a full standalone HTML document that frames the game in an
 * iframe, renders the fixed bottom tab bar and a docked right sidebar, and loads
 * the core client ESM (served by the plugin at `/__harness/client.js`).
 *
 * The markup here is only the skeleton + styles + the injected `WrapperData`
 * blob. All behaviour (tabs, Settings, Replay, panels, launch) lives in the
 * client so panels can be added without editing this template.
 */

import type { WrapperData } from './types';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderWrapperHtml(data: WrapperData, clientUrl: string): string {
  const blob = JSON.stringify(data);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Harness — ${esc(data.title)}</title>
<style>
  :root { color-scheme: dark; --sidebar-w: 320px; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #0b0d10;
    color: #e6e8eb;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  #stage {
    position: fixed;
    inset: 0 0 56px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 24px;
    transition: right 0.18s ease;
  }
  body.sidebar-open #stage { right: var(--sidebar-w); }
  #game {
    flex: 0 0 auto;
    border: 1px solid #1e232b;
    border-radius: 10px;
    background: #000;
    box-shadow: 0 12px 48px rgba(0,0,0,0.55);
  }
  /* ── docked right sidebar ─────────────────────────────────────────── */
  #sidebar {
    position: fixed;
    top: 0; right: 0; bottom: 56px;
    width: var(--sidebar-w);
    background: #0f1216;
    border-left: 1px solid #232a33;
    display: flex;
    flex-direction: column;
    z-index: 40;
  }
  #sidebar[hidden] { display: none; }
  #sidebar > header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-bottom: 1px solid #1d222a;
    font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #aab2bd;
  }
  #sidebar > header button {
    background: transparent; border: 0; color: #6b7480; cursor: pointer; font-size: 18px; line-height: 1;
  }
  #sidebar > header button:hover { color: #e6e8eb; }
  #sidebar-body { flex: 1 1 auto; overflow: auto; padding: 12px 14px; }
  /* ── bottom tab bar ───────────────────────────────────────────────── */
  #bar {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    height: 56px;
    display: flex; align-items: center; gap: 8px;
    padding: 0 18px;
    background: linear-gradient(180deg, #14171c 0%, #0e1115 100%);
    border-top: 1px solid #232a33;
    box-shadow: 0 -10px 30px rgba(0,0,0,0.4);
    z-index: 50; font-size: 13px;
  }
  #brand { font-weight: 700; letter-spacing: 0.02em; color: #eef1f5; margin-right: 6px; white-space: nowrap; }
  #brand small { font-weight: 500; color: #6b7480; letter-spacing: 0; }
  .tabs { display: flex; align-items: center; gap: 2px; }
  .tab {
    background: transparent; border: 0; color: #99a2af;
    padding: 8px 14px; border-radius: 8px;
    font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }
  .tab:hover { color: #e6e8eb; background: rgba(255,255,255,0.04); }
  .tab.active { color: #fff; background: rgba(91,141,239,0.16); }
  .tab:disabled { color: #4b525c; cursor: not-allowed; }
  /* ── popovers ─────────────────────────────────────────────────────── */
  .popover {
    position: fixed; z-index: 60;
    min-width: 248px; max-width: 340px;
    background: #13161b; border: 1px solid #262b33; border-radius: 12px;
    box-shadow: 0 14px 44px rgba(0,0,0,0.6); padding: 12px;
  }
  .popover[hidden] { display: none; }
  .popover.replay { min-width: 288px; }
  .cap {
    display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: #828b98; margin-bottom: 6px;
  }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 6px;
  }
  .row + .row { border-top: 1px solid #1d222a; }
  .row .cap { margin: 0; }
  select, input[type=number], input[type=text] {
    background: #1c2128; color: #e9ecf1; border: 1px solid #3a414c; border-radius: 8px;
    padding: 7px 10px; font-size: 13px; font-weight: 600; font-family: inherit;
    transition: border-color 0.12s, background 0.12s;
  }
  select:hover, input:hover { border-color: #4b5563; }
  select:focus, input:focus { outline: none; border-color: #3b82f6; background: #20262f; }
  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex: 0 0 auto; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: #2b313a; border-radius: 22px; cursor: pointer; transition: background 0.15s; }
  .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.15s; }
  .switch input:checked + .slider { background: #3b82f6; }
  .switch input:checked + .slider::before { transform: translateX(18px); }
  .screen-list { display: flex; flex-direction: column; gap: 2px; }
  .screen-opt {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    background: transparent; border: 0; color: #d3d8df; padding: 9px 11px; border-radius: 8px;
    font-size: 13px; font-weight: 600; font-family: inherit; text-align: left; cursor: pointer;
  }
  .screen-opt small { color: #828b98; font-weight: 500; }
  .screen-opt:hover { background: #1c2128; }
  .screen-opt.active { background: #2f6bff; color: #fff; }
  .screen-opt.active small { color: #d8e2ff; }
  .field { margin-bottom: 12px; }
  .field .cap em { font-style: normal; color: #5f6772; font-weight: 600; text-transform: none; letter-spacing: 0; }
  .field select, .field input { width: 100%; }
  button.primary {
    width: 100%; background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
    color: #fff; border: 0; border-radius: 9px; padding: 11px;
    font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer;
    transition: filter 0.12s, transform 0.06s;
  }
  button.primary:hover { filter: brightness(1.08); }
  button.primary:active { transform: translateY(1px); }
  button.primary:disabled { cursor: not-allowed; opacity: 0.45; filter: none; }
  button.ghost {
    width: 100%; background: transparent; border: 1px solid #3a414c; color: #cfd5dd;
    padding: 9px; border-radius: 8px; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  }
  button.ghost:hover { border-color: #4b5563; color: #fff; }
  button.link-danger {
    width: 100%; background: transparent; border: 0; color: #e5616b; padding: 10px; margin-top: 4px;
    font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  }
  button.link-danger:hover { color: #ef7681; }
  .muted { color: #6b7480; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
  <script type="application/json" id="harness-data">${blob}</script>
  <div id="stage"><iframe id="game" title="game"></iframe></div>
  <aside id="sidebar" hidden>
    <header><span id="sidebar-title"></span><button id="sidebar-close" title="Close">&times;</button></header>
    <div id="sidebar-body"></div>
  </aside>
  <div id="bar">
    <span id="brand">${esc(data.title)} <small>· v${esc(data.version)}</small></span>
    <div class="tabs" id="tabs"></div>
  </div>
  <div id="popovers"></div>
  <script type="module" src="${clientUrl}"></script>
</body>
</html>`;
}
