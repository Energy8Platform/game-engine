import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle } from '@/core/renderer';

/** Records every contract call so tests assert the controller drives the view correctly. */
export class FakeRenderer implements ShellRenderer {
  host!: ShellHost;
  bars = 0;
  layouts: string[] = [];
  themes = 0;
  money: Array<{ field: string; from: number; to: number; durationMs?: number }> = [];
  overlays: OverlayRequest[] = [];
  closed = 0;
  destroyed = false;
  /** When set, openOverlay returns a handle with this onKey. */
  onKey?: (e: KeyboardEvent) => boolean;
  mount(host: ShellHost): void { this.host = host; }
  renderBar(): void { this.bars++; }
  setLayout(l: 'wide' | 'mobile'): void { this.layouts.push(l); }
  applyTheme(): void { this.themes++; }
  animateMoney(field: 'balance' | 'win', from: number, to: number, durationMs?: number): void { this.money.push({ field, from, to, durationMs }); }
  openOverlay(req: OverlayRequest): OverlayHandle { this.overlays.push(req); return { onKey: this.onKey, close: () => { this.closed++; } }; }
  closeOverlay(): void { this.closed++; }
  destroy(): void { this.destroyed = true; }
}
