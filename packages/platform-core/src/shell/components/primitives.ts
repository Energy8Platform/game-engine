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
