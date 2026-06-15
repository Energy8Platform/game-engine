import { icon } from './icons';

export interface ButtonOpts {
  label: string;
  className?: string;
  onClick: () => void;
}

export function createButton(opts: ButtonOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `ge-shell-btn ${opts.className ?? ''}`.trim();
  btn.textContent = opts.label;
  btn.addEventListener('click', () => {
    if (!btn.disabled) opts.onClick();
  });
  return btn;
}

export interface ToggleOpts {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function createToggle(opts: ToggleOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'ge-shell-btn ge-shell-toggle';
  let checked = opts.checked;
  const render = () => (btn.textContent = checked ? 'ON' : 'OFF');
  render();
  btn.addEventListener('click', () => {
    checked = !checked;
    render();
    opts.onChange(checked);
  });
  return btn;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (value: number) => void;
}

export function createSlider(opts: SliderOpts): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.className = 'ge-shell-slider';
  input.addEventListener('input', () => opts.onInput(Number(input.value)));
  return input;
}

export interface ModalOpts {
  onClose: () => void;
}

/** A full-screen overlay card. Returns { root, body }; append content to body. */
export function createModal(opts: ModalOpts): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ge-shell-modal';
  const card = document.createElement('div');
  card.className = 'ge-shell-modal-card';
  const close = createButton({ label: '✕', className: 'ge-shell-close', onClick: opts.onClose });
  const body = document.createElement('div');
  card.append(close, body);
  root.appendChild(card);
  root.addEventListener('click', (e) => {
    if (e.target === root) opts.onClose();
  });
  return { root, body };
}

export interface OverlayOpts {
  title: string;
  onClose: () => void;
  onBack?: () => void;
}

/** Full-screen overlay. Returns { root, body }; append content to body. */
export function createOverlay(opts: OverlayOpts): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ge-shell-overlay';
  const head = document.createElement('div');
  head.className = 'ge-ov-head';
  if (opts.onBack) {
    const back = document.createElement('button');
    back.className = 'ge-ov-nav'; back.dataset.ge = 'info-back'; back.innerHTML = icon('back');
    back.addEventListener('click', opts.onBack);
    head.appendChild(back);
  }
  const h = document.createElement('h4'); h.className = 'ge-ov-title'; h.textContent = opts.title; head.appendChild(h);
  const close = document.createElement('button');
  close.className = 'ge-ov-nav'; close.setAttribute('aria-label', 'Close'); close.innerHTML = icon('close');
  close.addEventListener('click', opts.onClose);
  head.appendChild(close);
  // Header stays fixed; only this wrapper scrolls — the X never scrolls away,
  // and vh-clamped padding keeps it usable on small popouts (e.g. 400×225).
  const scroll = document.createElement('div'); scroll.className = 'ge-ov-scroll';
  const body = document.createElement('div'); body.className = 'ge-ov-body';
  scroll.appendChild(body);
  root.append(head, scroll);
  return { root, body };
}
