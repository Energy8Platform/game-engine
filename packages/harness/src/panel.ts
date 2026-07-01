/**
 * `@energy8platform/harness/panel` — the browser-side contract a panel client
 * implements. A panel's `clientEntry` file must default-export a
 * `HarnessPanelMount`. Pure types — safe to import from any panel package.
 */

export interface HarnessPanelContext {
  /** Container to render the panel UI into (sidebar body or popover). */
  root: HTMLElement;
  /** The live game iframe. `contentWindow` changes across relaunches. */
  iframe: HTMLIFrameElement;
  /** Post a message to the current game iframe. */
  post(message: unknown): void;
  /** Subscribe to messages FROM the game iframe. Returns an unsubscribe fn. */
  on(handler: (message: unknown) => void): () => void;
  /** Ask the harness to relaunch the iframe with current settings. */
  relaunch(): void;
}

export type HarnessPanelMount = (ctx: HarnessPanelContext) => void;
