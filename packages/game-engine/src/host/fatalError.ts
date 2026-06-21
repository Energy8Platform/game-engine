/** Render a blocking, full-screen message instead of an infinite loading screen. */
export function showFatalError(container: HTMLElement | string, message: string): void {
  const host =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container) ?? document.body
      : container;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'color:#f0c98a;background:#0a0504;font:600 18px system-ui;text-align:center;padding:24px;z-index:99999';
  overlay.textContent = message;
  host.appendChild(overlay);
}
