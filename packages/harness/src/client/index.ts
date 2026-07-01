/**
 * Core harness client — the browser driver, served (self-contained ESM) at
 * `/__harness/client.js`. Reads the injected `WrapperData`, builds the tab bar,
 * the Screen / Settings / Replay popovers and the docked sidebar, drives the
 * iframe launch, and loads/mounts panel client ESMs.
 *
 * No framework, no external imports except sibling harness modules (bundled).
 */

import type { WrapperData, WrapperPanelInfo } from '../types';
import type { ScreenPreset } from '../screens';
import type { HarnessPanelContext, HarnessPanelMount } from '../panel';
import { buildLaunchUrl, buildReplayUrl, type CoreLaunchState } from '../launch';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const data: WrapperData = JSON.parse($('#harness-data').textContent ?? '{}');
const iframe = $<HTMLIFrameElement>('#game');
const tabsEl = $('#tabs');
const popsEl = $('#popovers');
const barEl = $('#bar');
const sidebar = $('#sidebar');
const sidebarTitle = $('#sidebar-title');
const sidebarBody = $('#sidebar-body');

const state: CoreLaunchState = {
  currency: data.defaultCurrency,
  social: false,
  lang: data.defaultLang,
  device: 'desktop',
};

// ── launch ───────────────────────────────────────────────────────────────
function launchNormal(): void {
  const base = data.backend?.launch.base ?? {};
  iframe.src = buildLaunchUrl(base, state);
}

function launchReplay(mode: string, event: number, amountMinor: number): void {
  const rb = data.backend?.launch.replayBase;
  if (!rb) return;
  iframe.src = buildReplayUrl(rb, state, { mode, event, amount: amountMinor });
}

// ── message bus (wrapper ↔ iframe) ─────────────────────────────────────────
function post(message: unknown): void {
  iframe.contentWindow?.postMessage(message, '*');
}
function on(handler: (message: unknown) => void): () => void {
  const listener = (e: MessageEvent): void => {
    if (e.source && e.source === iframe.contentWindow) handler(e.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

// ── popover plumbing ───────────────────────────────────────────────────────
let openPanel: string | null = null;

function closePanels(): void {
  openPanel = null;
  popsEl.querySelectorAll<HTMLElement>('.popover').forEach((p) => (p.hidden = true));
  tabsEl.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
}

function positionPopover(name: string): void {
  const tab = tabsEl.querySelector<HTMLElement>(`.tab[data-panel="${name}"]`);
  const pop = document.getElementById('pop-' + name);
  if (!tab || !pop) return;
  const r = tab.getBoundingClientRect();
  pop.style.bottom = barEl.offsetHeight + 10 + 'px';
  let left = r.left;
  const maxLeft = window.innerWidth - pop.offsetWidth - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < 12) left = 12;
  pop.style.left = left + 'px';
}

function togglePopover(name: string): void {
  if (openPanel === name) return closePanels();
  closePanels();
  const pop = document.getElementById('pop-' + name);
  if (!pop) return;
  pop.hidden = false;
  openPanel = name;
  tabsEl.querySelector(`.tab[data-panel="${name}"]`)?.classList.add('active');
  positionPopover(name);
}

// ── tab factory ────────────────────────────────────────────────────────────
function addTab(name: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const tab = el('button', { class: 'tab', 'data-panel': name });
  tab.textContent = label;
  if (disabled) tab.disabled = true;
  tab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tab.disabled) return;
    onClick();
  });
  tabsEl.appendChild(tab);
  return tab;
}

// ── Settings popover ───────────────────────────────────────────────────────
function buildSettings(): void {
  const pop = el('div', { class: 'popover', id: 'pop-settings' });
  pop.hidden = true;
  const be = data.backend;

  if (be?.controls) {
    const balSel = el('select', { id: 'set-balance' });
    for (const b of data.balances) {
      const o = el('option', { value: String(b.value) });
      o.textContent = b.label;
      if (b.value === data.defaultBalance) o.selected = true;
      balSel.appendChild(o);
    }
    balSel.addEventListener('change', async () => {
      await fetch(be.controls!.setBalanceUrl + '?major=' + balSel.value);
      launchNormal();
    });
    const rowB = el('div', { class: 'row' }, '<span class="cap">Balance</span>');
    rowB.appendChild(balSel);
    pop.appendChild(rowB);

    const curSel = el('select', { id: 'set-currency' });
    for (const c of be.currencies) {
      const o = el('option', { value: c });
      o.textContent = c;
      if (c === state.currency) o.selected = true;
      curSel.appendChild(o);
    }
    curSel.addEventListener('change', async () => {
      state.currency = curSel.value;
      await fetch(be.controls!.setCurrencyUrl + '?code=' + curSel.value);
      launchNormal();
    });
    const rowC = el('div', { class: 'row' }, '<span class="cap">Currency</span>');
    rowC.appendChild(curSel);
    pop.appendChild(rowC);
  }

  const rowS = el('div', { class: 'row' }, '<span class="cap">Social Mode</span>');
  const sw = el('label', { class: 'switch' });
  const chk = el('input', { type: 'checkbox', id: 'set-social' });
  chk.addEventListener('change', () => {
    state.social = chk.checked;
    launchNormal();
  });
  sw.appendChild(chk);
  sw.appendChild(el('span', { class: 'slider' }));
  rowS.appendChild(sw);
  pop.appendChild(rowS);

  const langSel = el('select', { id: 'set-lang' });
  for (const l of data.langs) {
    const o = el('option', { value: l.code });
    o.textContent = l.label;
    if (l.code === state.lang) o.selected = true;
    langSel.appendChild(o);
  }
  langSel.addEventListener('change', () => {
    state.lang = langSel.value;
    launchNormal();
  });
  const rowL = el('div', { class: 'row' }, '<span class="cap">Language</span>');
  rowL.appendChild(langSel);
  pop.appendChild(rowL);

  popsEl.appendChild(pop);
  addTab('settings', 'Settings', () => togglePopover('settings'));
}

// ── Screen popover ─────────────────────────────────────────────────────────
function applyScreen(p: ScreenPreset): void {
  iframe.style.width = p.w + 'px';
  iframe.style.height = p.h + 'px';
}
function buildScreen(): void {
  const pop = el('div', { class: 'popover', id: 'pop-screen' });
  pop.hidden = true;
  const list = el('div', { class: 'screen-list' });
  for (const p of data.screens) {
    const opt = el('button', { class: 'screen-opt', 'data-screen': p.name });
    opt.innerHTML = `${p.name} <small>${p.w}×${p.h}</small>`;
    if (p.name === data.screens[0].name) opt.classList.add('active');
    opt.addEventListener('click', () => {
      applyScreen(p);
      list.querySelectorAll('.screen-opt').forEach((o) => o.classList.toggle('active', o === opt));
      closePanels();
    });
    list.appendChild(opt);
  }
  pop.appendChild(list);
  popsEl.appendChild(pop);
  addTab('screen', 'Screen', () => togglePopover('screen'));
  applyScreen(data.screens[0]);
}

// ── Replay popover ─────────────────────────────────────────────────────────
function buildReplay(): void {
  const modes = data.backend?.modes ?? [];
  if (!modes.length || !data.backend?.launch.replayBase) return;
  const pop = el('div', { class: 'popover replay', id: 'pop-replay' });
  pop.hidden = true;

  const modeSel = el('select', { id: 'rp-mode' });
  modes.forEach((m, i) => {
    const o = el('option', { value: m.name });
    o.textContent = m.name;
    if (i === 0) o.selected = true;
    modeSel.appendChild(o);
  });
  const modeField = el('div', { class: 'field' }, '<span class="cap">Game Mode</span>');
  modeField.appendChild(modeSel);

  const hint = el('em', { id: 'rp-hint' });
  const cap = el('span', { class: 'cap' });
  cap.textContent = 'Event ID ';
  cap.appendChild(hint);
  const eventInput = el('input', { type: 'number', id: 'rp-event', min: '0', value: '0' });
  const eventField = el('div', { class: 'field' });
  eventField.appendChild(cap);
  eventField.appendChild(eventInput);

  const bets = data.backend?.betLevelsMajor ?? [];
  const defAmount = bets.length ? Math.min(...bets) : 1;
  const amountInput = el('input', { type: 'number', id: 'rp-amount', min: '0', step: 'any', value: String(defAmount) });
  const amountField = el('div', { class: 'field' }, '<span class="cap">Amount</span>');
  amountField.appendChild(amountInput);

  const playBtn = el('button', { class: 'primary' });
  playBtn.textContent = 'Play Event';
  const closeBtn = el('button', { class: 'link-danger' });
  closeBtn.textContent = 'Close Replay';

  const updateHint = (): void => {
    const m = modes.find((x) => x.name === modeSel.value);
    const n = m?.count ?? 0;
    if (n > 0) {
      hint.textContent = '(Range: 0 – ' + (n - 1) + ')';
      eventInput.max = String(n - 1);
    } else {
      hint.textContent = '';
      eventInput.removeAttribute('max');
    }
  };
  modeSel.addEventListener('change', updateHint);
  playBtn.addEventListener('click', () => {
    const ev = Number(eventInput.value);
    launchReplay(modeSel.value, Number.isFinite(ev) ? ev : 0, Number(amountInput.value) * 1_000_000);
    closePanels();
  });
  closeBtn.addEventListener('click', () => {
    launchNormal();
    closePanels();
  });

  pop.append(modeField, eventField, amountField, playBtn, closeBtn);
  popsEl.appendChild(pop);
  addTab('replay', 'Replay', () => togglePopover('replay'));
  updateHint();
}

// ── Panels (sidebar + custom tabs) ─────────────────────────────────────────
const mounted = new Set<string>();

function panelContext(root: HTMLElement, config: unknown): HarnessPanelContext {
  return { root, iframe, post, on, relaunch: launchNormal, config };
}

async function mountPanelInto(panel: WrapperPanelInfo, root: HTMLElement): Promise<void> {
  if (mounted.has(panel.id)) return;
  mounted.add(panel.id);
  try {
    const mod = (await import(/* @vite-ignore */ panel.clientUrl)) as { default?: HarnessPanelMount };
    mod.default?.(panelContext(root, panel.config));
  } catch (err) {
    root.innerHTML = `<p class="muted">Failed to load panel "${panel.id}": ${String(err)}</p>`;
  }
}

let sidebarPanel: string | null = null;
function toggleSidebar(panel: WrapperPanelInfo): void {
  if (sidebarPanel === panel.id && !sidebar.hidden) {
    closeSidebar();
    return;
  }
  sidebarPanel = panel.id;
  sidebarTitle.textContent = panel.title;
  sidebar.hidden = false;
  document.body.classList.add('sidebar-open');
  tabsEl.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  tabsEl.querySelector(`.tab[data-panel="${panel.id}"]`)?.classList.add('active');
  // Sidebar hosts one panel body per id; show the requested, hide others.
  sidebarBody.querySelectorAll<HTMLElement>('[data-panel-body]').forEach((b) => {
    b.hidden = b.getAttribute('data-panel-body') !== panel.id;
  });
  let body = sidebarBody.querySelector<HTMLElement>(`[data-panel-body="${panel.id}"]`);
  if (!body) {
    body = el('div', { 'data-panel-body': panel.id });
    sidebarBody.appendChild(body);
  }
  void mountPanelInto(panel, body);
}
function closeSidebar(): void {
  sidebar.hidden = true;
  document.body.classList.remove('sidebar-open');
  if (sidebarPanel) tabsEl.querySelector(`.tab[data-panel="${sidebarPanel}"]`)?.classList.remove('active');
}

function buildPanels(): void {
  for (const panel of data.panels) {
    if (panel.placement === 'sidebar') {
      addTab(panel.id, panel.title, () => toggleSidebar(panel));
    } else {
      const pop = el('div', { class: 'popover', id: 'pop-' + panel.id });
      pop.hidden = true;
      popsEl.appendChild(pop);
      addTab(panel.id, panel.title, () => {
        togglePopover(panel.id);
        if (!pop.hidden) void mountPanelInto(panel, pop);
      });
    }
  }
}

// ── global close handlers ──────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (!openPanel) return;
  const pop = document.getElementById('pop-' + openPanel);
  if (pop && pop.contains(e.target as Node)) return;
  const tab = tabsEl.querySelector(`.tab[data-panel="${openPanel}"]`);
  if (tab && tab.contains(e.target as Node)) return;
  closePanels();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanels();
});
window.addEventListener('resize', () => {
  if (openPanel) positionPopover(openPanel);
});
$('#sidebar-close').addEventListener('click', closeSidebar);

// ── boot ───────────────────────────────────────────────────────────────────
buildSettings();
buildScreen();
buildReplay();
buildPanels();
launchNormal();
