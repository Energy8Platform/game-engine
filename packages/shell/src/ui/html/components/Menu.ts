import type { ShellHost } from '@/core/renderer';
import { resolveMenu, type MenuRow } from '@/core/menu';
import { createPopover } from '../primitives';
import { icon, type IconName } from '../icons';

/** The bar menu, as a light-dismiss popover anchored to the burger. Rows come from the core model,
 *  so DOM and Pixi always show the same list in the same order. */
export function openMenuPopover(
  host: ShellHost,
  surface: HTMLElement,
  getScale: () => number,
): { root: HTMLElement; position(): void } {
  const pop = createPopover({
    ge: 'menu-popover',
    surface,
    // Resolved lazily on every position() call, not captured once: HtmlRenderer's renderBar() (run
    // on every resize, and on ~20 other state changes) rebuilds the bottom bar from scratch, so the
    // plate/burger are brand-new elements after it — a captured reference would already be detached
    // by the next position() call and the card would silently recentre with its arrow hidden.
    // The plate is the bar's own plaque — the continuous dark panel wide, the controls row mobile
    // (NOT the info pill below it) — so the card sits flush with the WHOLE bar, not just the burger.
    plate: () => surface.querySelector(host.layout === 'mobile' ? '.ge-m-controls' : '.ge-bar-panel') as HTMLElement | null,
    pointer: () => surface.querySelector('[data-ge="menu"]') as HTMLElement | null,
    // Mobile only: the SPIN disc / FS counter is taller than `.ge-m-controls` and centred inside it
    // (`align-items:center` over a shorter fixed-height row), so it pops above the row's own top edge
    // — see createPopover's `plateOverflowTop` doc comment. Exactly one of the two (or neither, e.g. a
    // replay with no free spins) is ever rendered, so a combined selector resolves to whichever is
    // current. Wide's plate already contains its content, so this deliberately resolves to null there.
    plateOverflowTop: () =>
      host.layout === 'mobile'
        ? (surface.querySelector('[data-ge="spin"], [data-ge="fs-counter"]') as HTMLElement | null)
        : null,
    scale: getScale,
    onClose: () => host.actions.closeOverlay(),
  });
  const updaters: Record<string, (v: boolean | number) => void> = {};
  for (const row of resolveMenu(host)) {
    pop.body.appendChild(buildRow(host, row, updaters, () => pop.position()));
  }
  // Live updates while open (host.setMenuValue / setSound / setVolume); cleared by the controller.
  host.setMenuRefresh((id, v) => updaters[id]?.(v));
  return { root: pop.root, position: pop.position };
}

function glyph(name: IconName | undefined, cls: string): HTMLElement | null {
  if (!name) return null;
  const el = document.createElement('span');
  el.className = cls;
  el.innerHTML = icon(name);
  return el;
}

function buildRow(
  host: ShellHost,
  row: MenuRow,
  updaters: Record<string, (v: boolean | number) => void>,
  reposition: () => void,
): HTMLElement {
  if (row.kind === 'separator') {
    const sep = document.createElement('div');
    sep.className = 'ge-pop-sep';
    sep.dataset.ge = 'menu-sep';
    return sep;
  }
  if (row.kind === 'button') {
    // The row hook goes on a wrapper so both `menu-row-<id>` (order assertions) and
    // `menu-item-<id>` (the clickable control) exist, as they do for toggle/range rows.
    const wrap = document.createElement('div');
    wrap.dataset.ge = `menu-row-${row.id}`;
    const btn = document.createElement('button');
    btn.className = 'ge-ov-row';
    btn.dataset.ge = `menu-item-${row.id}`;
    btn.disabled = row.disabled;
    const label = document.createElement('span');
    label.className = 'ge-grow';
    label.textContent = row.label;
    const ico = glyph(row.icon, 'ge-mi-icon');
    const chev = row.chevron ? glyph('chevronRight', 'ge-mi-chev') : null;
    for (const el of [ico, label, chev]) if (el) btn.appendChild(el);
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      host.actions.closeOverlay();
      row.select();
    });
    wrap.appendChild(btn);
    return wrap;
  }
  if (row.kind === 'toggle') {
    const el = document.createElement('div');
    el.className = 'ge-ov-row';
    el.classList.toggle('ge-disabled', row.disabled); // a <div> can't carry [disabled] itself
    el.dataset.ge = `menu-row-${row.id}`;
    const ico = glyph(row.icon(row.get()), 'ge-mi-icon');
    const label = document.createElement('span');
    label.className = 'ge-grow';
    label.textContent = row.label;
    const btn = document.createElement('button');
    btn.className = 'ge-toggle';
    btn.dataset.ge = `menu-item-${row.id}`;
    btn.disabled = row.disabled;
    btn.innerHTML = '<i></i>';
    const paint = (v: boolean): void => {
      btn.classList.toggle('ge-on', v);
      btn.setAttribute('aria-pressed', String(v));
      const next = row.icon(v);
      if (ico && next) ico.innerHTML = icon(next);
    };
    paint(row.get());
    btn.addEventListener('click', () => {
      if (!btn.disabled) row.set(!row.get());
    });
    updaters[row.id] = (v) => paint(v === true);
    if (ico) el.appendChild(ico);
    el.append(label, btn);
    return el;
  }
  // range
  const el = document.createElement('div');
  el.className = 'ge-ov-row ge-col';
  el.classList.toggle('ge-disabled', row.disabled); // a <div> can't carry [disabled] itself
  el.dataset.ge = `menu-row-${row.id}`;
  const head = document.createElement('div');
  head.className = 'ge-row-head';
  const name = document.createElement('span');
  name.textContent = row.label;
  const val = document.createElement('span');
  val.className = 'ge-val';
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'ge-slider';
  input.dataset.ge = `menu-item-${row.id}`;
  input.min = String(row.min);
  input.max = String(row.max);
  input.step = String(row.step);
  input.disabled = row.disabled;
  const paint = (v: number): void => {
    input.value = String(v);
    val.textContent = row.format(v);
  };
  paint(row.get());
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = row.format(v);
    row.set(v);
  });
  updaters[row.id] = (v) => {
    paint(Number(v));
    reposition();
  };
  el.append(head, input);
  return el;
}
