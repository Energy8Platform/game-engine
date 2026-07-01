// examples/reel-lab/src/controls.ts
//
// Renders the schema into a DOM panel and binds each control to the live config object.

import type { ReelSystemConfig } from '@energy8platform/game-engine/slot';
import { SCHEMA, type Control, type Section } from './schema';

type Cfg = ReelSystemConfig;

export function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
export function setPath(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

export interface ControlPanelOptions {
  config: Cfg;
  onChange: (path: string) => void;
}

export function buildControlPanel(
  root: HTMLElement,
  opts: ControlPanelOptions,
): { refresh: () => void } {
  const updaters: (() => void)[] = [];
  root.innerHTML = '';
  for (const section of SCHEMA) root.appendChild(renderSection(section, opts, updaters));
  return { refresh: () => updaters.forEach((u) => u()) };
}

function renderSection(
  section: Section,
  opts: ControlPanelOptions,
  updaters: (() => void)[],
): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'panel-section';
  const head = document.createElement('button');
  head.className = 'section-head';
  head.textContent = section.title;
  const body = document.createElement('div');
  body.className = 'section-body';
  if (section.collapsed) body.style.display = 'none';
  head.addEventListener('click', () => {
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });
  wrap.appendChild(head);
  wrap.appendChild(body);
  for (const c of section.controls) body.appendChild(renderControl(c, opts, updaters));
  return wrap;
}

function renderControl(
  c: Control,
  opts: ControlPanelOptions,
  updaters: (() => void)[],
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'control';
  const name = document.createElement('span');
  name.className = 'control-label';
  name.textContent = c.label;
  row.appendChild(name);

  const emit = () => opts.onChange(c.path);

  if (c.kind === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    const sync = () => (input.checked = !!getPath(opts.config, c.path));
    sync();
    input.addEventListener('change', () => {
      setPath(opts.config, c.path, input.checked);
      emit();
    });
    row.classList.add('control-toggle');
    row.appendChild(input);
    updaters.push(sync);
  } else if (c.kind === 'select') {
    const sel = document.createElement('select');
    for (const o of c.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    }
    const sync = () => (sel.value = String(getPath(opts.config, c.path)));
    sync();
    sel.addEventListener('change', () => {
      setPath(opts.config, c.path, sel.value);
      emit();
    });
    row.appendChild(sel);
    updaters.push(sync);
  } else if (c.kind === 'range') {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    const val = document.createElement('output');
    val.className = 'control-value';
    const sync = () => {
      // fall back to another path (e.g. cellWidth → cellSize) when this value is unset/non-scalar
      let raw = getPath(opts.config, c.path);
      if ((raw == null || typeof raw !== 'number') && c.fallback != null)
        raw = getPath(opts.config, c.fallback);
      const v = Number(raw);
      input.value = String(v);
      val.textContent = String(v);
    };
    sync();
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setPath(opts.config, c.path, v);
      val.textContent = String(v);
      emit();
    });
    row.appendChild(input);
    row.appendChild(val);
    updaters.push(sync);
  } else {
    const input = document.createElement('input');
    input.type = 'color';
    const sync = () =>
      (input.value =
        '#' +
        Number(getPath(opts.config, c.path) ?? 0)
          .toString(16)
          .padStart(6, '0'));
    sync();
    input.addEventListener('input', () => {
      setPath(opts.config, c.path, parseInt(input.value.slice(1), 16));
      emit();
    });
    row.appendChild(input);
    updaters.push(sync);
  }
  return row;
}
