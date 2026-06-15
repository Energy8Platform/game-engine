export const SHELL_ROOT_ID = '__ge-game-shell__';

export const SHELL_CSS = `
#${SHELL_ROOT_ID} {
  position: absolute; inset: 0;
  pointer-events: none; z-index: 9000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--shell-fg);
}
#${SHELL_ROOT_ID} svg { display:block; }

/* floating readouts (no panel) */
#${SHELL_ROOT_ID} .ge-rd { font-weight:700; font-size:13px; line-height:1; white-space:nowrap;
  text-shadow:0 1px 3px rgba(0,0,0,.65); font-variant-numeric:tabular-nums; }
#${SHELL_ROOT_ID} .ge-rd .ge-lbl { display:block; color:var(--shell-muted); font-weight:600;
  font-size:9px; letter-spacing:.1em; text-transform:uppercase; margin-bottom:4px; text-shadow:none; }

/* icon buttons (borderless) */
#${SHELL_ROOT_ID} .ge-iconbtn { pointer-events:auto; cursor:pointer; border:none; background:none;
  padding:0; color:var(--shell-icon); width:40px; height:40px; display:flex; align-items:center;
  justify-content:center; font-size:24px; position:relative; transition:transform .08s ease; }
#${SHELL_ROOT_ID} .ge-iconbtn:active { transform:scale(.92); }
#${SHELL_ROOT_ID} .ge-iconbtn[disabled] { opacity:.35; cursor:default; }
#${SHELL_ROOT_ID} .ge-iconbtn.ge-active::after { content:''; position:absolute; bottom:2px; left:50%;
  transform:translateX(-50%); width:5px; height:5px; border-radius:50%; background:var(--shell-accent); }

/* SPIN (solid white disc) */
#${SHELL_ROOT_ID} .ge-shell-spin { pointer-events:auto; cursor:pointer; border:none; border-radius:50%;
  width:58px; height:58px; background:var(--shell-spin); color:var(--shell-spin-fg);
  font-size:30px; display:flex; align-items:center; justify-content:center; transition:transform .08s ease; }
#${SHELL_ROOT_ID} .ge-shell-spin:active { transform:scale(.94); }
#${SHELL_ROOT_ID} .ge-shell-spin[disabled] { opacity:.4; cursor:default; }

/* BUY BONUS (the one accent) */
#${SHELL_ROOT_ID} .ge-shell-buybonus { pointer-events:auto; cursor:pointer; border:none; border-radius:10px;
  background:var(--shell-buybonus); color:#fff; font-weight:800; letter-spacing:.02em;
  padding:10px 14px; display:flex; align-items:center; gap:7px; font-size:13px; transition:transform .08s ease; }
#${SHELL_ROOT_ID} .ge-shell-buybonus:active { transform:scale(.96); }
#${SHELL_ROOT_ID} .ge-shell-buybonus[disabled] { opacity:.4; cursor:default; }
#${SHELL_ROOT_ID} .ge-shell-buybonus svg { font-size:17px; }

/* bottom bar: transparent, two zones (wide default) */
#${SHELL_ROOT_ID} .ge-shell-bottom { position:absolute; left:0; right:0; bottom:0; pointer-events:none;
  display:flex; align-items:flex-end; justify-content:space-between; padding:14px 18px; gap:14px; }
#${SHELL_ROOT_ID} .ge-zone { display:flex; align-items:center; gap:14px; pointer-events:none; }
#${SHELL_ROOT_ID} .ge-zone > * { pointer-events:auto; }
#${SHELL_ROOT_ID} .ge-betstep { display:flex; flex-direction:column; gap:2px; }

/* narrow arrangement (spin-center) */
#${SHELL_ROOT_ID}.ge-narrow .ge-shell-bottom { flex-direction:column; align-items:stretch; gap:10px; padding:10px 12px 12px; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-info { justify-content:space-between; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-buy { justify-content:center; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-controls { justify-content:center; gap:12px; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-menu { position:absolute; left:5%; bottom:7%; }
#${SHELL_ROOT_ID}.ge-narrow .ge-shell-spin { width:62px; height:62px; }

/* freeSpins counter hero */
#${SHELL_ROOT_ID} .ge-fs-hero { text-align:center; }
#${SHELL_ROOT_ID} .ge-fs-hero b { display:block; color:#fff; font-weight:800; font-size:28px; line-height:1;
  font-variant-numeric:tabular-nums; text-shadow:0 1px 4px rgba(0,0,0,.6); }
#${SHELL_ROOT_ID} .ge-fs-hero span { display:block; color:var(--shell-muted); font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; margin-top:6px; }

/* full-screen overlays — header (title left, prominent X/back), scrolling body, vh-clamped for popout/mobile */
#${SHELL_ROOT_ID} .ge-shell-overlay { position:absolute; inset:0; pointer-events:auto; background:var(--shell-surface);
  display:flex; flex-direction:column; animation:ge-ov-in .16s ease-out; }
@keyframes ge-ov-in { from { opacity:0; } to { opacity:1; } }
#${SHELL_ROOT_ID} .ge-ov-head { flex:0 0 auto; display:flex; align-items:center; gap:12px;
  padding:clamp(12px,3vh,20px) clamp(14px,4vw,24px); }
#${SHELL_ROOT_ID} .ge-ov-title { flex:1; margin:0; color:var(--shell-fg); font-weight:800; letter-spacing:.04em;
  text-transform:uppercase; font-size:clamp(17px,4.4vh,26px); }
#${SHELL_ROOT_ID} .ge-ov-nav { flex:0 0 auto; display:flex; align-items:center; justify-content:center;
  width:44px; height:44px; border-radius:12px; cursor:pointer; color:var(--shell-icon);
  background:rgba(255,255,255,.05); border:1px solid var(--shell-hairline); font-size:22px;
  transition:background .12s ease; }
#${SHELL_ROOT_ID} .ge-ov-nav:hover { background:rgba(255,255,255,.1); }
#${SHELL_ROOT_ID} .ge-ov-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; }
#${SHELL_ROOT_ID} .ge-ov-body { max-width:600px; margin:0 auto; box-sizing:border-box;
  padding:clamp(6px,2vh,16px) clamp(16px,4vw,24px) clamp(16px,4vh,28px); }

/* full-width overlay rows (neutral) */
#${SHELL_ROOT_ID} .ge-ov-row { display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box;
  padding:clamp(11px,2.2vh,15px) 16px; margin-bottom:10px; border:1px solid var(--shell-hairline);
  border-radius:12px; background:rgba(255,255,255,.02); color:var(--shell-fg); font-size:14px; font-weight:600; }
#${SHELL_ROOT_ID} .ge-ov-row .ge-grow { flex:1; text-align:left; }
#${SHELL_ROOT_ID} button.ge-ov-row { cursor:pointer; font-family:inherit; transition:background .12s ease; }
#${SHELL_ROOT_ID} button.ge-ov-row:hover { background:rgba(255,255,255,.06); }
#${SHELL_ROOT_ID} .ge-ov-row.ge-col { flex-direction:column; align-items:stretch; gap:10px; }
#${SHELL_ROOT_ID} .ge-ov-row .ge-row-head { display:flex; justify-content:space-between; align-items:center; }
#${SHELL_ROOT_ID} .ge-ov-row .ge-row-head .ge-val { color:var(--shell-muted); font-variant-numeric:tabular-nums; font-weight:700; }
#${SHELL_ROOT_ID} .ge-slider { width:100%; accent-color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-toggle { flex:0 0 auto; width:42px; height:24px; border-radius:999px; background:rgba(255,255,255,.16);
  border:none; cursor:pointer; position:relative; }
#${SHELL_ROOT_ID} .ge-toggle.ge-on { background:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-toggle i { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%;
  background:#fff; transition:left .12s ease; }
#${SHELL_ROOT_ID} .ge-toggle.ge-on i { left:20px; }

/* game info */
#${SHELL_ROOT_ID} .ge-gi-sec { margin-bottom:16px; }
#${SHELL_ROOT_ID} .ge-gi-sec h3 { color:var(--shell-muted); font-size:10px; letter-spacing:.14em;
  text-transform:uppercase; margin:0 0 7px; }
#${SHELL_ROOT_ID} .ge-gi-sec p, #${SHELL_ROOT_ID} .ge-shell-sym-row, #${SHELL_ROOT_ID} .ge-shell-feat-row {
  color:#dfe4ee; font-size:12px; line-height:1.5; }

/* buy bonus cards */
#${SHELL_ROOT_ID} .ge-bb-grid { display:flex; flex-wrap:wrap; gap:16px; }
#${SHELL_ROOT_ID} .ge-shell-bonus-card { flex:1 1 220px; text-align:left; pointer-events:auto; cursor:pointer;
  border:1px solid var(--shell-hairline); border-radius:14px; padding:18px; background:none; color:var(--shell-fg); }
#${SHELL_ROOT_ID} .ge-shell-bonus-card[disabled] { opacity:.4; cursor:default; }
#${SHELL_ROOT_ID} .ge-bonus-name { font-size:16px; font-weight:800; }
#${SHELL_ROOT_ID} .ge-bonus-vol { letter-spacing:3px; font-size:14px; margin:8px 0; }
#${SHELL_ROOT_ID} .ge-bonus-desc { color:var(--shell-muted); font-size:12px; margin-bottom:12px; line-height:1.4; }
#${SHELL_ROOT_ID} .ge-bonus-price { font-weight:800; font-size:18px; font-variant-numeric:tabular-nums; }

#${SHELL_ROOT_ID}.ge-shell-hidden { opacity:0; pointer-events:none; transition:opacity .25s ease; }
`;
