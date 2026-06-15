export const SHELL_ROOT_ID = '__ge-game-shell__';

export const SHELL_CSS = `
#${SHELL_ROOT_ID} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 9000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--shell-fg);
}
#${SHELL_ROOT_ID} .ge-shell-bottom {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  pointer-events: auto;
  background: linear-gradient(0deg, rgba(15,23,42,0.85), rgba(15,23,42,0));
}
#${SHELL_ROOT_ID} .ge-shell-btn {
  pointer-events: auto;
  cursor: pointer;
  border: none;
  border-radius: var(--shell-radius);
  background: var(--shell-accent);
  color: var(--shell-fg);
  padding: 10px 16px;
  font-size: 14px;
}
#${SHELL_ROOT_ID} .ge-shell-btn[disabled] { opacity: 0.4; cursor: default; }
#${SHELL_ROOT_ID} .ge-shell-spin { min-width: 96px; min-height: 64px; font-weight: 700; }
#${SHELL_ROOT_ID} .ge-shell-buybonus { background: var(--shell-buybonus); }
#${SHELL_ROOT_ID} .ge-shell-modal {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.6);
  pointer-events: auto;
}
#${SHELL_ROOT_ID} .ge-shell-modal-card {
  background: var(--shell-bg);
  border-radius: var(--shell-radius);
  padding: 24px; max-width: 90%; max-height: 80%; overflow: auto;
}
#${SHELL_ROOT_ID}.ge-shell-hidden { opacity: 0; pointer-events: none; }
`;
