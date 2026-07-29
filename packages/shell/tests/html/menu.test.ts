// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import { createPopover } from '@/ui/html/primitives';
import { POPOVER } from '@/core/popover';
import type { ShellConfig } from '@/core/types';
import type { HtmlRenderer } from '@/ui/html/HtmlRenderer';

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
    ...over,
  } as ShellConfig & { mount: HTMLElement };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('bar menu popover', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
    // ShellController installs a global capture-phase pointerdown listener (unrelated to this
    // popover) that calls window.focus() to pull focus into the game frame. jsdom doesn't
    // implement window.focus and logs "Not implemented" via its virtual console on every call;
    // the "closes on a click outside" test below dispatches a real pointerdown, so stub it quiet.
    vi.spyOn(window, 'focus').mockImplementation(() => {});
  });

  it('burger opens the popover with the default rows, in order', () => {
    const shell = createGameShell(cfg(mount));
    const opened = vi.fn();
    const setSpy = vi.fn();
    shell.on('menuOpen', opened);
    shell.on('settingsOpen', setSpy);
    q(mount, '[data-ge="menu"]')!.click();
    expect(opened).toHaveBeenCalledOnce();
    expect(setSpy).not.toHaveBeenCalled(); // settingsOpen is only emitted by the deprecated openSettings() alias
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
    const rows = Array.from(mount.querySelectorAll('[data-ge^="menu-row-"], [data-ge="menu-sep"]'));
    expect(rows.map((r) => (r as HTMLElement).dataset.ge)).toEqual([
      'menu-row-sound', 'menu-row-music', 'menu-row-sfx', 'menu-sep', 'menu-row-gameInfo',
    ]);
    expect(q(mount, '[data-ge="settings-modal"]')).toBeNull(); // the overlay is gone for good
  });

  it('a second burger tap closes it', () => {
    createGameShell(cfg(mount));
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
    burger.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('closes on a click outside and on Escape', () => {
    createGameShell(cfg(mount));
    q(mount, '[data-ge="menu"]')!.click();
    q(mount, '[data-ge="menu-popover"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();

    q(mount, '[data-ge="menu"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('sound row toggles and swaps its glyph', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openMenu();
    const row = q(mount, '[data-ge="menu-row-sound"]')!;
    expect(row.querySelector('svg')).toBeTruthy();
    q(mount, '[data-ge="menu-item-sound"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'sound', value: false });
    expect(shell.soundOn).toBe(false);
  });

  it('volume rows move the shell volumes', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openMenu();
    const s = q(mount, '[data-ge="menu-item-music"]') as HTMLInputElement;
    s.value = '0.3';
    s.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith({ key: 'music', value: 0.3 });
    expect(shell.getVolume('music')).toBe(0.3);
  });

  it('game info row opens the info overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    q(mount, '[data-ge="menu-item-gameInfo"]')!.click();
    expect(q(mount, '[data-ge="info-modal"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('renders custom toggle / range / button rows and runs their callbacks', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const shell = createGameShell(cfg(mount, {
      menu: [
        { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false, onChange },
        { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, step: 1, value: 2, format: (v) => `×${v}` },
        { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket', chevron: true, onSelect },
      ],
    }));
    shell.openMenu();
    q(mount, '[data-ge="menu-item-lefty"]')!.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(shell.getMenuValue('lefty')).toBe(true);

    const speed = q(mount, '[data-ge="menu-item-speed"]') as HTMLInputElement;
    expect(speed.min).toBe('1');
    expect(speed.max).toBe('5');
    expect(q(mount, '[data-ge="menu-row-speed"]')!.textContent).toContain('×2');

    q(mount, '[data-ge="menu-item-paytable"]')!.click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // Regression: Pixi dims every disabled row (box.alpha = 0.5); the DOM previously set only the
  // native `disabled` attribute, so a disabled toggle/range row (a <div> wrapper, which cannot
  // carry [disabled] itself) had NO visual treatment at all, and a disabled BUTTON row still lit up
  // on hover because bare `:hover` matches a disabled element. `disabled` is public MenuItem API, so
  // a game that ships it must get one consistent behaviour, not two.
  it('disabled rows of every kind are visually marked and do not write through', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const shell = createGameShell(cfg(mount, {
      menu: [
        { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false, disabled: true, onChange },
        { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, step: 1, value: 2, disabled: true },
        { id: 'paytable', type: 'button', label: 'Paytable', disabled: true, onSelect },
      ],
    }));
    shell.openMenu();

    // toggle — the row container is a <div>, so it needs the class; the control itself is a real
    // <button disabled>.
    const toggleRow = q(mount, '[data-ge="menu-row-lefty"]')!;
    expect(toggleRow.classList.contains('ge-disabled')).toBe(true);
    const toggleBtn = q(mount, '[data-ge="menu-item-lefty"]') as HTMLButtonElement;
    expect(toggleBtn.disabled).toBe(true);
    toggleBtn.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(shell.getMenuValue('lefty')).toBe(false);

    // range — same <div>-wrapper story; the native attribute already reaches the <input>.
    const rangeRow = q(mount, '[data-ge="menu-row-speed"]')!;
    expect(rangeRow.classList.contains('ge-disabled')).toBe(true);
    const rangeInput = q(mount, '[data-ge="menu-item-speed"]') as HTMLInputElement;
    expect(rangeInput.disabled).toBe(true);

    // button — the row IS the control, so [disabled] alone marks and blocks it.
    const payBtn = q(mount, '[data-ge="menu-item-paytable"]') as HTMLButtonElement;
    expect(payBtn.disabled).toBe(true);
    payBtn.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('live-updates an open popover from setMenuValue', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    shell.setMenuValue('sfx', 0.25);
    const s = q(mount, '[data-ge="menu-item-sfx"]') as HTMLInputElement;
    expect(s.value).toBe('0.25');
    expect(q(mount, '[data-ge="menu-row-sfx"]')!.textContent).toContain('25%');
  });

  // Regression: this test used to anchor the card to the BURGER (left === burger.x), which is
  // exactly the old, rejected behaviour — the card's left edge lined up with the glyph, not with
  // anything a player would read as intentional, and its bottom edge could land ON the bar's own
  // surface rather than above it. Updated for the plate/pointer split: the plate (`.ge-bar-panel`)
  // now drives x/y/maxH, and only the arrow still follows the burger (the "pointer").
  it('places the card above the WHOLE bar plaque, left-aligned to it, with the arrow on the burger', () => {
    const shell = createGameShell(cfg(mount));
    const root = mount.querySelector('#__ge-game-shell__') as HTMLElement;
    Object.defineProperty(root, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });
    root.getBoundingClientRect = () => rect(0, 0, 1000, 600);
    // Force a deterministic bar scale (s=1) so this test isolates the plate/pointer geometry change
    // from the separate scale behaviour covered below.
    (shell as unknown as { renderer: HtmlRenderer }).renderer.fitBar();

    // The plate (the wide dark panel) is WIDER than, and offset from, the burger inside it — if the
    // card anchored to the burger instead, left/arrow would coincide; they must not.
    const plate = q(mount, '.ge-bar-panel')!;
    plate.getBoundingClientRect = () => rect(40, 500, 400, 70);
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.getBoundingClientRect = () => rect(100, 516, 36, 36);

    shell.openMenu();
    const card = q(mount, '[data-ge="menu-card"]')!;

    // left edge flush with the PLATE's left edge (40), not the burger's (100)
    expect(parseFloat(card.style.left)).toBe(40);

    // bottom edge clears the PLATE's top edge (500) by the usual gap — never overlaps the bar's own
    // surface. jsdom's offsetHeight is 0, so the rendered height is the POPOVER.minH fallback (120).
    const top = parseFloat(card.style.top);
    const maxH = parseFloat(card.style.maxHeight);
    const renderedH = Math.min(POPOVER.minH, maxH);
    expect(top + renderedH).toBeLessThanOrEqual(500 - POPOVER.gap);

    // arrow centred on the BURGER's centre (100+18=118), relative to the card's left edge (40) —
    // NOT the plate's own centre (40+200=240).
    const arrow = q(mount, '.ge-pop-arrow') as HTMLElement;
    expect(parseFloat(arrow.style.left)).toBeCloseTo(118 - 40, 5);
  });

  // Defect 2: the popover must scale with the SAME factor the bar applies to itself, and that
  // scaled card must still land fully inside the surface (not just clamped by content but correctly
  // converted between the card's own local/unscaled units and the screen units placePopover uses).
  it('scales the card by the bar\'s own fit-scale, and a scaled card still lands fully inside the surface', () => {
    const shell = createGameShell(cfg(mount));
    const root = mount.querySelector('#__ge-game-shell__') as HTMLElement;
    // BAR_REF_WIDTH is 840 — a 420-wide root computes s = max(0.5, min(1, 420/840)) = 0.5.
    Object.defineProperty(root, 'clientWidth', { value: 420, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });
    root.getBoundingClientRect = () => rect(0, 0, 420, 600);
    (shell as unknown as { renderer: HtmlRenderer }).renderer.fitBar();

    const plate = q(mount, '.ge-bar-panel')!;
    plate.getBoundingClientRect = () => rect(10, 520, 380, 60);
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.getBoundingClientRect = () => rect(190, 532, 36, 36);

    shell.openMenu();
    const card = q(mount, '[data-ge="menu-card"]')!;

    // Stub the card's own content size as a real browser would (jsdom's scrollWidth/offsetHeight are
    // always 0), then force a reposition — setMenuValue on a RANGE row is the one path that calls
    // reposition() on an already-open popover (see the "live-updates" test above).
    Object.defineProperty(card, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(card, 'offsetHeight', {
      configurable: true,
      get() {
        const mh = parseFloat(card.style.maxHeight || '');
        return Number.isFinite(mh) ? Math.min(300, mh) : 300;
      },
    });
    shell.setMenuValue('music', 0.4);

    const s = 0.5;
    // typography/paddings/row-heights all scale together via one transform on the whole card
    expect(card.style.transform).toContain(`scale(${s})`);
    // The LOCAL (pre-scale) width/max-height are the resolved SCREEN-space numbers divided by s.
    // Getting this backwards (or dropping the division) would shrink the card's real content box
    // (width) or clip it far short of the space actually available (max-height); 500/1008 vs a
    // wrong 250/504 make either mistake obvious.
    expect(parseFloat(card.style.width)).toBeCloseTo(500, 5);
    expect(parseFloat(card.style.maxHeight)).toBeCloseTo(1008, 5);

    // left/top are already screen units (position isn't itself scaled — only the card's content is,
    // around its top-left transform-origin) — and, once the card's own scale is applied on top, it
    // must still land fully inside the surface.
    const left = parseFloat(card.style.left);
    const top = parseFloat(card.style.top);
    const screenW = 250; // popoverWidth(420, 500*0.5) — already screen units
    const screenH = Math.min(300, 1008) * s; // min(natural, local max-height) * s
    expect(left).toBeGreaterThanOrEqual(POPOVER.margin);
    expect(top).toBeGreaterThanOrEqual(POPOVER.margin);
    expect(left + screenW).toBeLessThanOrEqual(420 - POPOVER.margin);
    expect(top + screenH).toBeLessThanOrEqual(600 - POPOVER.margin);

    // arrow still on the burger's centre (190+18=208 screen px), converted to LOCAL units (÷ s)
    // since the arrow lives inside the scaled card.
    const arrow = q(mount, '.ge-pop-arrow') as HTMLElement;
    expect(parseFloat(arrow.style.left)).toBeCloseTo((208 - left) / s, 5);
  });

  // Regression: HtmlRenderer's ResizeObserver calls renderBar() (which does barHost.innerHTML = ''
  // and rebuilds the bottom bar — a brand-new burger element) BEFORE re-calling position(). A
  // popover that captured its anchor once would already be pointing at a detached element by then,
  // silently recentring with its arrow hidden on every resize. createPopover must re-resolve an
  // anchor FUNCTION on every position() call instead of tracking a fixed reference.
  it('re-resolves a function anchor on every position() call, tracking a rebuilt element', () => {
    const surface = document.createElement('div');
    document.body.appendChild(surface);
    surface.getBoundingClientRect = () => rect(0, 0, 1000, 600);

    let current = document.createElement('button');
    current.getBoundingClientRect = () => rect(20, 540, 40, 40);

    const pop = createPopover({ ge: 'x', surface, plate: () => current, onClose: () => {} });
    document.body.appendChild(pop.root);
    pop.position();
    expect(parseFloat(pop.card.style.left)).toBe(20);

    // Simulate renderBar(): the old burger is discarded; a brand-new one takes its place at a
    // different position — exactly what a barHost rebuild does to the real `[data-ge="menu"]` node.
    current = document.createElement('button');
    current.getBoundingClientRect = () => rect(300, 540, 40, 40);
    pop.position();

    expect(parseFloat(pop.card.style.left)).toBe(300); // tracks the NEW element, not the stale one
    const arrow = pop.card.querySelector('.ge-pop-arrow') as HTMLElement;
    expect(arrow.style.display).not.toBe('none'); // still anchored — arrow stays visible, not centred
  });

  // Regression: position() clears a prior run's constrained WIDTH before measuring (see the comment
  // in createPopover), but must do the same for max-height. offsetHeight respects `max-height` in a
  // real browser, so once a first position() call clamps the card short, an uncleared max-height
  // makes every later call measure the CLAMPED height forever — even after the surface regrows and
  // the card no longer needs clamping. jsdom's real offsetHeight is a constant 0 (which is exactly
  // why this whole branch is otherwise untested), so this getter emulates a real browser: it reports
  // the natural height, or the max-height clamp when one is narrower.
  it('re-measures the true content height after a max-height clamp, so a regrown surface repositions correctly', () => {
    const NATURAL_H = 420;
    const surface = document.createElement('div');
    document.body.appendChild(surface);
    let surfaceH = 360;
    surface.getBoundingClientRect = () => rect(0, 0, 800, surfaceH);

    // Models a bottom-bar burger: it re-anchors near the surface's bottom edge on resize, exactly
    // like the real control bar does.
    const anchorEl = document.createElement('button');
    anchorEl.getBoundingClientRect = () => rect(20, surfaceH - 60, 40, 40);

    const pop = createPopover({ ge: 'x', surface, plate: anchorEl, onClose: () => {} });
    document.body.appendChild(pop.root);
    Object.defineProperty(pop.card, 'offsetHeight', {
      configurable: true,
      get() {
        const mh = parseFloat(pop.card.style.maxHeight || '');
        return Number.isFinite(mh) ? Math.min(NATURAL_H, mh) : NATURAL_H;
      },
    });

    // First open: surface 800x360, burger near the bottom — the card is height-clamped to fit above it.
    pop.position();
    const firstMaxH = parseFloat(pop.card.style.maxHeight);
    expect(firstMaxH).toBeLessThan(NATURAL_H); // genuinely clamped, not just capped by content
    const firstTop = parseFloat(pop.card.style.top);
    const firstRenderedBottom = firstTop + Math.min(NATURAL_H, firstMaxH);
    expect(firstTop).toBeGreaterThanOrEqual(POPOVER.margin);
    expect(firstRenderedBottom).toBeLessThanOrEqual(surfaceH - POPOVER.margin);

    // Surface grows a lot (rotate / popout resize) — the burger re-anchors near the new bottom.
    surfaceH = 900;
    pop.position();

    const top = parseFloat(pop.card.style.top);
    const maxH = parseFloat(pop.card.style.maxHeight);
    const renderedBottom = top + Math.min(NATURAL_H, maxH);
    // The bug placed the card using the stale CLAMPED height, then lifted the clamp — so the card
    // sprang back to its natural height after being positioned, spilling past the (regrown)
    // surface's bottom edge and into the re-anchored burger.
    expect(top).toBeGreaterThanOrEqual(POPOVER.margin);
    expect(renderedBottom).toBeLessThanOrEqual(surfaceH - POPOVER.margin);
    expect(renderedBottom).toBeLessThanOrEqual(surfaceH - 60); // clear of the re-anchored burger
  });
});
