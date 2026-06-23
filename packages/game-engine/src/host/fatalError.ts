// packages/game-engine/src/host/fatalError.ts

/** Marker id so the modal is idempotent (first one wins; later calls replace its message). */
const FATAL_ID = 'e8-fatal-error';

/** Pure: extract a human-readable message from any thrown value / event reason. */
export function fatalMessage(input: unknown): string {
  if (input == null) return 'Something went wrong.';
  if (typeof input === 'string') return input;
  if (input instanceof Error) return input.message || input.name || 'Something went wrong.';
  const anyIn = input as { message?: unknown; reason?: unknown };
  if (typeof anyIn.message === 'string' && anyIn.message) return anyIn.message;
  if (anyIn.reason != null) return fatalMessage(anyIn.reason);
  try {
    return String(input);
  } catch {
    return 'Something went wrong.';
  }
}

/** Pure: build the modal overlay element (error text + a Reload button). */
export function buildFatalErrorModal(message: string, onReload: () => void): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = FATAL_ID;
  overlay.setAttribute('role', 'alertdialog');
  overlay.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(10,5,4,0.92);z-index:99999;font-family:system-ui,sans-serif;padding:24px';

  const card = document.createElement('div');
  card.style.cssText =
    'max-width:420px;width:100%;background:#1a0f0a;border:1px solid #5a3a1e;border-radius:12px;' +
    'padding:28px 24px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.6)';

  const text = document.createElement('div');
  text.className = 'e8-fatal-message';
  text.style.cssText = 'color:#f0c98a;font:600 17px/1.4 system-ui,sans-serif;margin-bottom:22px';
  text.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'e8-fatal-reload';
  button.textContent = 'Reload';
  button.style.cssText =
    'cursor:pointer;border:none;border-radius:8px;padding:12px 28px;font:600 15px system-ui,sans-serif;' +
    'color:#1a0f0a;background:#f0c98a';
  button.addEventListener('click', onReload);

  card.appendChild(text);
  card.appendChild(button);
  overlay.appendChild(card);
  return overlay;
}

/**
 * Render a blocking fatal-error modal with a Reload button. Idempotent: if a modal is already
 * shown, its message is replaced instead of stacking a second overlay.
 */
export function showFatalError(container: HTMLElement | string, message: string): void {
  if (typeof document === 'undefined') return;
  const host =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container) ?? document.body
      : container;

  const existing = document.getElementById(FATAL_ID);
  if (existing) {
    const msg = existing.querySelector<HTMLElement>('.e8-fatal-message');
    if (msg) msg.textContent = message;
    return;
  }

  const overlay = buildFatalErrorModal(message, () => {
    try {
      location.reload();
    } catch {
      /* no-op in non-browser environments */
    }
  });
  host.appendChild(overlay);
}

/**
 * Install global handlers so ANY uncaught error or unhandled promise rejection surfaces the
 * fatal modal (game devs don't have to handle errors themselves). `fatal` defaults to the
 * built-in modal targeting `container`. Returns a disposer that removes the listeners.
 */
export function installGlobalErrorHandlers(
  container: HTMLElement | string,
  fatal: (message: string) => void = (m) => showFatalError(container, m),
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onError = (e: ErrorEvent) => fatal(fatalMessage(e.error ?? e.message));
  const onRejection = (e: PromiseRejectionEvent) => fatal(fatalMessage(e.reason));

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
