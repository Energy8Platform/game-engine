import { SHELL_FONT_CSS } from '@/core/fonts';
import { SHELL_DIGIT_FONT_CSS } from '@/core/fonts-digits';

export const SHELL_ROOT_ID = '__ge-game-shell__';

// Inter (bundled, base64) leads the stack so the shell renders identically on every
// platform; the system fonts stay as graceful fallback if the webfont ever fails to load.
export const SHELL_CSS = SHELL_FONT_CSS + SHELL_DIGIT_FONT_CSS + `
#${SHELL_ROOT_ID} {
  position: absolute; inset: 0;
  container-type: size;   /* query container → centred modals size in cq units (responsive on every screen) */
  pointer-events: none; z-index: 9000;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
#${SHELL_ROOT_ID} .ge-iconbtn.ge-active { color:var(--shell-icon-active); }
/* Turbo shows its level by SWAPPING the glyph (off → single bolt turboOff, L1 → single bolt
   turbo1, L2 → bolt-with-speed-lines turbo2). Colour just marks state — no outline:
   off (ge-turbo-0) = #ccc (the svg turbo-off grey) · engaged (L1/L2) = accent · hover = accent. */
#${SHELL_ROOT_ID} .ge-iconbtn[data-ge="turbo"].ge-turbo-0 { color:#ccc; }
#${SHELL_ROOT_ID} .ge-iconbtn[data-ge="turbo"].ge-turbo-1,
#${SHELL_ROOT_ID} .ge-iconbtn[data-ge="turbo"].ge-turbo-2 { color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn[data-ge="turbo"]:hover { color:var(--shell-accent); }

/* SPIN — white disc by default, big glyph reaching for the rim; lights up accent on hover */
#${SHELL_ROOT_ID} .ge-shell-spin { pointer-events:auto; cursor:pointer; border:3px solid #000; border-radius:50%;
  width:86px; height:86px; background:var(--shell-spin); color:var(--shell-spin-fg); box-sizing:border-box; font-size:68px;
  display:flex; align-items:center; justify-content:center;
  transition:transform .08s ease, box-shadow .12s ease, background .12s ease, color .12s ease; }
#${SHELL_ROOT_ID} .ge-shell-spin:hover { background:var(--shell-accent); color:#fff;
  box-shadow:0 0 0 3px var(--shell-accent), 0 0 18px 2px var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-shell-spin:active { transform:scale(.94); }
/* disabled: dim via filter (stays opaque) so the plaque seam doesn't show through the disc */
#${SHELL_ROOT_ID} .ge-shell-spin[disabled] { filter:grayscale(.4) brightness(.62); box-shadow:none; cursor:default; }
/* spinning while a spin is in progress */
#${SHELL_ROOT_ID} .ge-shell-spin.ge-spinning svg { transform-origin:50% 50%; animation:ge-spin-rot .8s linear infinite; }
@keyframes ge-spin-rot { to { transform:rotate(360deg); } }
/* autoplay running: STOP glyph + countdown stacked in the disc */
#${SHELL_ROOT_ID} .ge-shell-spin.ge-stop { position:relative; }
#${SHELL_ROOT_ID} .ge-spin-stop { display:flex; }            /* STOP glyph at the disc's full size, like SPIN */
/* no entrance animation: the bar re-renders many times per spin, so any animation here
   would replay each time and make the counter visibly jump. tabular-nums keeps it steady. */
/* the STOP glyph is a solid dark square, so the autoplay count is always pure white to read on it. */
#${SHELL_ROOT_ID} .ge-spin-count { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:22px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; color:#fff; }

/* BUY BONUS — round accent badge, 2-line label, text pulses + accent glow on hover */
#${SHELL_ROOT_ID} .ge-shell-buybonus { pointer-events:auto; cursor:pointer; box-sizing:border-box;
  width:80px; height:80px; border-radius:50%; border:3px solid #000; background:var(--shell-accent);
  color:#fff; font-weight:800; letter-spacing:.02em; font-size:13px; line-height:1.08; text-align:center;
  display:flex; align-items:center; justify-content:center; transition:transform .08s ease, box-shadow .12s ease; }
#${SHELL_ROOT_ID} .ge-shell-buybonus span { display:inline-block; will-change:transform; }
/* the ticket glyph fills the badge (em-sized off the button's font-size, so it scales per context) */
#${SHELL_ROOT_ID} .ge-shell-buybonus .ge-bb-tk { display:flex; font-size:3.5em; color:#0b0e16; }
/* coin variant (BUY state): the full-colour coin IS the button — drop the accent disc + border,
   keep the circular hit/glow. The coin art fills the button and is the pulsed node on hover. */
#${SHELL_ROOT_ID} .ge-shell-buybonus.ge-bb-coin { background:none; border:none; }
#${SHELL_ROOT_ID} .ge-shell-buybonus .ge-bb-coin-art { display:flex; width:100%; height:100%; }
#${SHELL_ROOT_ID} .ge-shell-buybonus .ge-bb-coin-art svg { width:100%; height:100%; display:block; }
#${SHELL_ROOT_ID} .ge-shell-buybonus:hover { box-shadow:0 0 11px 1px var(--shell-accent); }
/* the coin needs no accent halo on hover/active — it carries its own gold look */
#${SHELL_ROOT_ID} .ge-shell-buybonus.ge-bb-coin:hover { box-shadow:none; }
#${SHELL_ROOT_ID} .ge-shell-buybonus:hover span { animation:ge-bb-pulse .7s ease-in-out infinite; }
#${SHELL_ROOT_ID} .ge-shell-buybonus:active { transform:scale(.96); }
#${SHELL_ROOT_ID} .ge-shell-buybonus[disabled] { filter:grayscale(.5) brightness(.72); box-shadow:none; cursor:default; }
#${SHELL_ROOT_ID} .ge-shell-buybonus[disabled] span { animation:none; }
@keyframes ge-bb-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.16)} }

/* host = bottom-anchored flex column: [win pill (on overflow)] above [the bar] */
#${SHELL_ROOT_ID} .ge-shell-barhost { position:absolute; left:0; right:0; bottom:0; pointer-events:none;
  display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px;
  transform-origin:bottom center; }
/* bottom bar: a row of [BUY BONUS (outside-left)] + [one continuous dark panel] (wide default).
   Capped at 750px and centred (the barhost centres it) so it doesn't stretch edge-to-edge on wide screens. */
#${SHELL_ROOT_ID} .ge-shell-bottom { width:100%; max-width:850px; box-sizing:border-box; pointer-events:none;
  display:flex; align-items:center; justify-content:flex-start; padding:0 14px 8px; gap:10px; }
#${SHELL_ROOT_ID} .ge-zone { display:flex; align-items:center; gap:14px; pointer-events:none; }
#${SHELL_ROOT_ID} .ge-zone > * { pointer-events:auto; }
#${SHELL_ROOT_ID} .ge-betstep { display:flex; flex-direction:column; gap:2px; }
/* auto stacked over turbo (far-right column, base/desktop) */
#${SHELL_ROOT_ID} .ge-autoturbo { display:flex; flex-direction:column; gap:2px; }
#${SHELL_ROOT_ID} .ge-autoturbo .ge-iconbtn { width:40px; height:30px; }

/* mobile (portrait) — two levels: [controls bar] over a small [balance · − bet + · win] info pill */
#${SHELL_ROOT_ID}.ge-mobile .ge-shell-bottom { flex-direction:column; align-items:center; gap:10px; padding:8px 10px 8px; }
/* level 1 — the dark controls bar (white icons, spin disc, buy badge) */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls { display:flex; align-items:center; justify-content:space-between;
  width:100%; box-sizing:border-box; height:62px; border-radius:16px; padding:0 18px; background:var(--shell-bar); }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-iconbtn,
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-rd,
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-rd .ge-lbl { color:#fff; }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-rd { text-shadow:none; text-align:center; }
/* Total Win is the one variable-width readout in the controls row — make it the shrinkable slot
   (min-width:0 lets flex shrink it below content; overflow:hidden clips the pre-scale value) so a
   large amount SHRINKS its number (fitReadouts) instead of pushing the buttons / scaling the bar.
   The other children (menu/hero/turbo) keep their intrinsic min-width and stay put. */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-fs-totalwin { min-width:0; overflow:hidden; }
/* mobile: restore accent hover + autoplay glow (the white rule above out-specifies the base ones) */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-iconbtn:hover,
#${SHELL_ROOT_ID}.ge-mobile .ge-m-controls .ge-iconbtn.ge-glow { color:var(--shell-accent); }
/* level 2 — the small info pill. Readouts are smaller and each can shrink long numbers (see fitReadouts). */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-info { display:flex; align-items:center; justify-content:space-between;
  width:100%; box-sizing:border-box; height:40px; border-radius:12px; padding:0 14px; gap:10px;
  background:var(--shell-plaque-glass); }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-info > .ge-rd { flex:1 1 0; min-width:0; overflow:hidden; color:#fff;
  text-shadow:none; font-size:11px; transform-origin:left center; }
/* Right-align via flex, not text-align: the WIN value can be WIDER than its flex slot, and
   text-align:right only right-aligns content NARROWER than its box — so a wide value stayed
   left-aligned and overflowed the slot's right edge (clipped mid-number). align-items:flex-end
   anchors the value's right edge to the slot right regardless of width, so fitReadouts's
   transform-origin:right then scales it cleanly into view. */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-info > .ge-win { display:flex; flex-direction:column; align-items:flex-end; text-align:right; }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-info > .ge-win .ge-rd-val { transform-origin:right center; }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-info .ge-rd .ge-lbl { color:var(--shell-plaque-label); font-size:8px; margin-bottom:2px; }
/* bet sits in the middle: − value + (compact), fixed so the numbers don't shove balance/win */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-betgroup { flex:0 0 auto; display:flex; align-items:center; gap:6px; }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-betgroup .ge-iconbtn { width:26px; height:26px; color:#fff; font-size:18px; }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-betgroup .ge-iconbtn:hover { color:var(--shell-accent); }
/* fixed-width box (sized for up to ~€100,000) so +/- never resizes the bet or shifts balance/win;
   bigger amounts shrink the number instead (fitReadouts) */
#${SHELL_ROOT_ID}.ge-mobile .ge-m-betgroup .ge-bet-value { flex:0 0 auto; width:76px; font-size:11px;
  text-align:center; color:#fff; text-shadow:none; }
#${SHELL_ROOT_ID}.ge-mobile .ge-m-betgroup .ge-bet-value .ge-rd-val { transform-origin:center; }
/* SPIN — same as desktop: white disc, black icon + ring; hover tints the icon accent (no fill/ring) */
#${SHELL_ROOT_ID}.ge-mobile .ge-shell-spin { width:84px; height:84px; font-size:66px; border-width:4px;
  background:var(--shell-btn); color:var(--shell-btn-ink); }
#${SHELL_ROOT_ID}.ge-mobile .ge-shell-spin:hover { background:var(--shell-btn); color:var(--shell-accent); box-shadow:none; }
#${SHELL_ROOT_ID}.ge-mobile .ge-shell-buybonus { width:58px; height:58px; font-size:9px; border-width:2px; }
/* landscape overflow — size the column to content, centre it; JS scales the whole stack to fit */
#${SHELL_ROOT_ID} .ge-shell-barhost.ge-fit { left:50%; right:auto; width:max-content; max-width:none; }
#${SHELL_ROOT_ID} .ge-shell-barhost.ge-fit .ge-shell-bottom { width:max-content; }

/* full-screen overlays — header (title left, prominent X/back), scrolling body, vh-clamped for popout/mobile.
   Frosted backdrop: the game shows through, blurred, behind a light dark tint (white-on-blur).
   Same glass "plaque" language as the control bar; scheme-independent. */
#${SHELL_ROOT_ID} .ge-shell-overlay { position:absolute; inset:0; z-index:50; pointer-events:auto;
  background:rgba(12,17,28,.5); backdrop-filter:blur(20px) saturate(120%);
  -webkit-backdrop-filter:blur(20px) saturate(120%);
  display:flex; flex-direction:column; animation:ge-ov-in .16s ease-out; }
/* SPIN/BUY BONUS use z-index:3 to overlap their plaques; lift the overlay clear above them */
@keyframes ge-ov-in { from { opacity:0; } to { opacity:1; } }
#${SHELL_ROOT_ID} .ge-ov-head { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:6px 10px; }
#${SHELL_ROOT_ID} .ge-ov-title { flex:1; margin:0; text-align:center; color:#fff; font-weight:800; letter-spacing:.04em;
  text-transform:uppercase; font-size:clamp(13px,2.6vh,16px); }
#${SHELL_ROOT_ID} .ge-ov-spacer { flex:0 0 auto; width:32px; }
#${SHELL_ROOT_ID} .ge-ov-nav { flex:0 0 auto; display:flex; align-items:center; justify-content:center;
  width:32px; height:32px; border-radius:9px; cursor:pointer; color:#fff;
  background:var(--shell-plaque-dark); border:none; font-size:18px;
  transition:background .12s ease, color .12s ease; }
#${SHELL_ROOT_ID} .ge-ov-nav:hover { background:var(--shell-plaque-glass); color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-ov-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; }
#${SHELL_ROOT_ID} .ge-ov-body { max-width:800px; margin:0 auto; box-sizing:border-box;
  padding:clamp(6px,2vh,16px) clamp(16px,4vw,24px) clamp(16px,4vh,28px); }

/* full-width overlay rows — glass plaque, white-on-dark */
#${SHELL_ROOT_ID} .ge-ov-row { display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box;
  padding:clamp(11px,2.2vh,15px) 16px; margin-bottom:10px; border:none;
  border-radius:16px; background:var(--shell-plaque-glass); color:#fff; font-size:14px; font-weight:600; }
#${SHELL_ROOT_ID} .ge-ov-row .ge-grow { flex:1; text-align:left; }
#${SHELL_ROOT_ID} button.ge-ov-row { cursor:pointer; font-family:inherit; transition:background .12s ease, color .12s ease; }
#${SHELL_ROOT_ID} button.ge-ov-row:hover { background:var(--shell-plaque-glass-hover); color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-ov-row.ge-col { flex-direction:column; align-items:stretch; gap:10px; }
#${SHELL_ROOT_ID} .ge-ov-row .ge-row-head { display:flex; justify-content:space-between; align-items:center; }
#${SHELL_ROOT_ID} .ge-ov-row .ge-row-head .ge-val { color:var(--shell-plaque-label); font-variant-numeric:tabular-nums; font-weight:700; }
#${SHELL_ROOT_ID} .ge-slider { width:100%; accent-color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-toggle { flex:0 0 auto; width:42px; height:24px; border-radius:999px; background:var(--shell-plaque-line);
  border:none; cursor:pointer; position:relative; }
#${SHELL_ROOT_ID} .ge-toggle.ge-on { background:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-toggle i { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%;
  background:#fff; transition:left .12s ease; }
#${SHELL_ROOT_ID} .ge-toggle.ge-on i { left:20px; }
/* sound on/off — speaker icon button (replaces the toggle) */
#${SHELL_ROOT_ID} .ge-snd { pointer-events:auto; cursor:pointer; border:none; background:none; padding:0;
  width:36px; height:36px; display:flex; align-items:center; justify-content:center; font-size:24px;
  color:#fff; transition:color .12s ease, transform .08s ease; }
#${SHELL_ROOT_ID} .ge-snd:not(.ge-active) { color:var(--shell-plaque-label); }
#${SHELL_ROOT_ID} .ge-snd:hover { color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-snd:active { transform:scale(.92); }

/* game info — each section is its own glass plaque; body text sized for comfortable reading */
#${SHELL_ROOT_ID} .ge-gi-sec { margin-bottom:12px; background:var(--shell-plaque-glass);
  border-radius:16px; padding:16px 18px; }
#${SHELL_ROOT_ID} .ge-gi-sec h3 { color:var(--shell-plaque-label); font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; margin:0 0 12px; }
#${SHELL_ROOT_ID} .ge-gi-sec p { color:rgba(255,255,255,.88); font-size:15px; line-height:1.6; margin:0; }
#${SHELL_ROOT_ID} .ge-gi-version { text-align:center; color:var(--shell-muted); font-size:11px;
  letter-spacing:.08em; opacity:.7; margin:4px 0 2px; }

/* hotkeys — keycap chips → localized action label, mirrors controls row layout */
#${SHELL_ROOT_ID} .ge-gi-hk-block { display:flex; flex-direction:column; }
#${SHELL_ROOT_ID} .ge-gi-hk { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; }
#${SHELL_ROOT_ID} .ge-gi-hk + .ge-gi-hk { border-top:1px solid var(--shell-plaque-line); }
/* Let the keycaps SHRINK instead of hogging the row: flex:0 1 auto lets the chips block give up
   width down to its widest single combo, and flex-wrap reflows the extra combos onto another line.
   On narrow/mobile widths the many-chip rows (Raise/Lower bet) otherwise squeeze the label off the
   right edge and clip it. (No min-width:0 here — the min-content floor is what keeps a combo intact
   and wrapping rather than overflowing.) */
#${SHELL_ROOT_ID} .ge-gi-hk-chips { display:flex; align-items:center; flex-wrap:wrap; gap:4px; flex:0 1 auto; }
#${SHELL_ROOT_ID} .ge-gi-hk-combo { display:inline-flex; align-items:center; gap:4px; }
#${SHELL_ROOT_ID} .ge-gi-hk-chip { display:inline-flex; align-items:center; justify-content:center;
  padding:2px 7px; border-radius:6px; border:1px solid var(--shell-plaque-line);
  background:var(--shell-plaque-dark); color:#fff;
  font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace; font-size:12px;
  font-weight:600; line-height:1.5; white-space:nowrap; min-width:1.6em; text-align:center; }
#${SHELL_ROOT_ID} .ge-gi-hk-sep { color:var(--shell-plaque-label); font-size:11px; padding:0 1px; }
#${SHELL_ROOT_ID} .ge-gi-hk-sep2 { color:var(--shell-plaque-label); font-size:11px; padding:0 4px; }
/* flex:1 1 auto (content-based basis, NOT flex:1's 0 basis) so the label keeps demanding its word
   width and shrinks in PROPORTION to the chips — both give ground and wrap, instead of the label
   collapsing to nothing. No min-width:0: the min-content floor stops a word being clipped. */
#${SHELL_ROOT_ID} .ge-gi-hk-tx { color:rgba(255,255,255,.88); font-size:14px; font-weight:600; text-align:right; flex:1 1 auto; }

/* controls — two blocks (gameplay / menu & info), icon/name/description per control */
#${SHELL_ROOT_ID} .ge-gi-ctl-block + .ge-gi-ctl-block { margin-top:16px; padding-top:4px; border-top:1px solid var(--shell-plaque-line); }
#${SHELL_ROOT_ID} .ge-gi-ctl-block-h { color:var(--shell-plaque-label); font-size:11px; letter-spacing:.12em;
  text-transform:uppercase; margin:8px 0 2px; font-weight:700; }
#${SHELL_ROOT_ID} .ge-gi-ctl { display:flex; align-items:center; gap:14px; padding:9px 0; }
#${SHELL_ROOT_ID} .ge-gi-ctl + .ge-gi-ctl { border-top:1px solid var(--shell-plaque-line); }
#${SHELL_ROOT_ID} .ge-gi-ctl-ic { flex:0 0 auto; width:48px; height:48px; display:flex; align-items:center;
  justify-content:center; font-size:26px; color:#fff; }
/* bet shows both chevrons, stacked & smaller */
#${SHELL_ROOT_ID} .ge-gi-ctl-ic--bet { flex-direction:column; font-size:18px; gap:0; }
/* buy bonus draws the real control-bar badge, scaled down & non-interactive */
#${SHELL_ROOT_ID} .ge-gi-ctl-ic .ge-shell-buybonus { width:46px; height:46px; font-size:8px; border-width:2px; pointer-events:none; }
#${SHELL_ROOT_ID} .ge-gi-ctl-tx { display:flex; flex-direction:column; gap:2px; min-width:0; }
#${SHELL_ROOT_ID} .ge-gi-ctl-tx b { color:#fff; font-size:15px; font-weight:700; }
#${SHELL_ROOT_ID} .ge-gi-ctl-tx span { color:rgba(255,255,255,.7); font-size:13px; line-height:1.4; }

/* paytable — cards: symbol image on top, name, then win tiers "<count> x<mult>" */
#${SHELL_ROOT_ID} .ge-gi-pt-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:10px; }
#${SHELL_ROOT_ID} .ge-gi-pt-card { display:flex; flex-direction:column; align-items:center; gap:8px;
  background:var(--shell-plaque-dark); border-radius:14px; padding:14px 12px; }
#${SHELL_ROOT_ID} .ge-gi-pt-sym { display:flex; flex-direction:column; align-items:center; gap:5px; min-width:0; }
#${SHELL_ROOT_ID} .ge-gi-pt-sym img { width:56px; height:56px; object-fit:contain; }
#${SHELL_ROOT_ID} .ge-gi-pt-sym span { color:#fff; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
#${SHELL_ROOT_ID} .ge-gi-pt-wins { display:flex; flex-direction:column; align-items:stretch; gap:2px; width:100%; }
#${SHELL_ROOT_ID} .ge-gi-pt-win { display:flex; justify-content:space-between; align-items:baseline; gap:14px;
  font-size:13.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
#${SHELL_ROOT_ID} .ge-gi-pt-win i { color:var(--shell-plaque-label); font-style:normal; }
#${SHELL_ROOT_ID} .ge-gi-pt-win b { color:var(--shell-accent); font-weight:700; }

/* wins — accent-filled mini-grid(s); classic = one per line, cluster/anywhere = one, ways = two */
#${SHELL_ROOT_ID} .ge-gi-pl-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(72px,1fr)); gap:12px; }
#${SHELL_ROOT_ID} .ge-gi-pl-item { display:flex; flex-direction:column; align-items:center; gap:6px; }
#${SHELL_ROOT_ID} .ge-gi-pl-svg { width:100%; height:auto; max-width:140px; }
#${SHELL_ROOT_ID} .ge-gi-pl-cell { fill:var(--shell-plaque-line); }
#${SHELL_ROOT_ID} .ge-gi-pl-on { fill:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-gi-pl-cap { color:#fff; font-size:13px; font-weight:700; }
#${SHELL_ROOT_ID} .ge-gi-win-row { display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap; }
#${SHELL_ROOT_ID} .ge-gi-win-row .ge-gi-pl-svg { flex:0 0 auto; width:140px; }
#${SHELL_ROOT_ID} .ge-gi-win-desc { flex:1; min-width:160px; color:rgba(255,255,255,.78); font-size:14px; line-height:1.5; margin:0; }
#${SHELL_ROOT_ID} .ge-gi-win-two { display:flex; gap:22px; flex-wrap:wrap; }
#${SHELL_ROOT_ID} .ge-gi-win-col { display:flex; flex-direction:column; align-items:center; gap:6px; }
#${SHELL_ROOT_ID} .ge-gi-win-col .ge-gi-pl-svg { width:140px; }
#${SHELL_ROOT_ID} .ge-gi-win-tag { font-size:12px; font-weight:700; }
#${SHELL_ROOT_ID} .ge-gi-win-ok { color:#4ade80; }
#${SHELL_ROOT_ID} .ge-gi-win-no { color:#f87171; }
#${SHELL_ROOT_ID} .ge-gi-win-badge { display:inline-block; margin-left:10px; padding:2px 8px; border-radius:999px;
  font-size:11px; font-weight:700; letter-spacing:.02em; color:var(--shell-accent);
  background:var(--shell-plaque-dark); vertical-align:middle; }

/* modes — comparison cards */
#${SHELL_ROOT_ID} .ge-gi-modes { display:flex; flex-direction:column; }
#${SHELL_ROOT_ID} .ge-gi-mode { padding:12px 0; }
#${SHELL_ROOT_ID} .ge-gi-mode + .ge-gi-mode { border-top:1px solid var(--shell-plaque-line); }
#${SHELL_ROOT_ID} .ge-gi-mode-top { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:6px 16px; margin-bottom:6px; }
#${SHELL_ROOT_ID} .ge-gi-mode-h { color:#fff; font-size:16px; font-weight:800; }
#${SHELL_ROOT_ID} .ge-gi-mode-stats { display:flex; flex-wrap:wrap; gap:14px; }
#${SHELL_ROOT_ID} .ge-gi-mode-st { display:flex; align-items:baseline; gap:5px; }
#${SHELL_ROOT_ID} .ge-gi-mode-st span { color:var(--shell-plaque-label); font-size:10px; letter-spacing:.1em; text-transform:uppercase; }
#${SHELL_ROOT_ID} .ge-gi-mode-st b { color:#fff; font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; }
#${SHELL_ROOT_ID} .ge-gi-mode-desc { color:rgba(255,255,255,.78); font-size:14px; line-height:1.5; margin:0; }
/* shapes — row list (grid illustration left, name + description right), modes-style text */
#${SHELL_ROOT_ID} .ge-gi-shapes { display:flex; flex-direction:column; }
#${SHELL_ROOT_ID} .ge-gi-shape { display:flex; align-items:center; gap:16px; padding:12px 0; }
#${SHELL_ROOT_ID} .ge-gi-shape + .ge-gi-shape { border-top:1px solid var(--shell-plaque-line); }
#${SHELL_ROOT_ID} .ge-gi-shape .ge-gi-pl-svg { flex:0 0 auto; width:96px; }
#${SHELL_ROOT_ID} .ge-gi-shape-tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
#${SHELL_ROOT_ID} .ge-gi-custom { color:rgba(255,255,255,.88); font-size:15px; line-height:1.6; }

/* buy bonus cards — art-forward, centred, flat (no gradients); --card-acc/--card-ink per card.
   order: title → thumb → description → (spacer) → volatility → price → full-bleed button. */
/* wide: horizontal scrolling strip. Cards scale PROPORTIONALLY with the viewport — every
   dimension is in em-units, so the single font-size knob shrinks the whole card uniformly
   (like the control bar's fit-scale), keeping small popouts readable. mobile: vertical stack. */
/* the buy-bonus scroll area is a SIZE CONTAINER, so the cards' cqh units measure the overlay
   (the popout frame) and not the browser window — cards fit without any vertical scroll. */
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-ov-scroll { container-type:size; }
/* Popout / landscape: the horizontal card strip must be the ONLY scroll axis. The cqh-sized cards
   are meant to fit the overlay height (no vertical scroll), but the old 7px font floor stopped them
   shrinking on the tiniest popouts — so they spilled past the frame and the overlay grew a SECOND,
   vertical scrollbar (scrollable in both directions). Two changes keep it single-axis:
     1. the card font floor drops (below) so cards actually fit the frame height; and
     2. vertical scrolling is locked off as a belt-and-braces guard, with the strip centred (the body
        fills the frame and centres the grid) so any sub-pixel slack splits evenly instead of clipping
        the price/CTA off the bottom.
   This mirrors the pixi shell, which masks the cards and drag-scrolls on the X axis alone. (Centring
   lives on the body, not the scroll box, so the grid keeps its width and its own X-scroll.) */
#${SHELL_ROOT_ID}:not(.ge-mobile) [data-ge="buybonus-overlay"] .ge-ov-scroll { overflow-y:hidden; }
#${SHELL_ROOT_ID}:not(.ge-mobile) [data-ge="buybonus-overlay"] .ge-ov-body {
  min-height:100%; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; }
/* buy-bonus uses the FULL overlay width (no 800px centre cap) so the card row isn't cropped at
   the sides; small horizontal padding keeps the cards off the screen edges. */
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-ov-body { max-width:none; padding:clamp(6px,2.5cqh,16px) clamp(12px,3vw,28px); }
#${SHELL_ROOT_ID} .ge-bb-grid { display:flex; gap:14px; justify-content:safe center; overflow-x:auto; overflow-y:hidden; padding-bottom:6px;
  scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; }
/* the one knob that scales the whole card (its whole layout is em-relative). It is the SMALLER of two
   fits, so the card is always fully visible:
     • 3.4cqh — height: the card stays inside the band between the header and the bet footer (cqh
       measures the overlay popout frame, not the browser window);
     • 84cqw / (N*18) — width: the N cards (each 18em) fit the frame width side-by-side instead of
       overflowing into an X-scroll. --ge-bb-n is the live card count, set in BuyBonus.ts.
   Floor is deliberately tiny: on a 400×225 popout a fully visible card beats a bigger clipped one. */
#${SHELL_ROOT_ID} .ge-bb-grid .ge-bonus-card { flex:0 0 18em; scroll-snap-align:start;
  font-size:clamp(4px, min(3.4cqh, calc(84cqw / (var(--ge-bb-n,3) * 18))), 12px); }
/* mobile: vertical stack at a fixed, readable size — scroll the list; only shrink if the card would
   be wider than the frame (very narrow viewport), so it never overflows horizontally. */
#${SHELL_ROOT_ID}.ge-mobile .ge-bb-grid { display:flex; flex-direction:column; gap:14px; overflow:visible; }
#${SHELL_ROOT_ID}.ge-mobile .ge-bb-grid .ge-bonus-card { flex:0 0 auto; font-size:min(12px, calc(92cqw / 18)); }
#${SHELL_ROOT_ID} .ge-bonus-card { display:flex; flex-direction:column; border-radius:1.4em; overflow:hidden;
  background:var(--shell-plaque-glass); border:1px solid var(--shell-plaque-line); color:#fff; text-align:center;
  pointer-events:auto; cursor:pointer; transition:box-shadow .12s ease, background .12s ease; }
#${SHELL_ROOT_ID} .ge-bonus-card:hover:not(.ge-bonus-off) {
  box-shadow:0 0 0 1px var(--card-acc), 0 12px 34px -12px var(--card-acc); }
#${SHELL_ROOT_ID} .ge-bonus-card--kbd-focus:not(.ge-bonus-off) {
  box-shadow:0 0 0 1px var(--card-acc), 0 12px 34px -12px var(--card-acc); }
/* custom card (BonusOption.custom): keep grid sizing + accent vars, drop the default chrome so the game owns the UI */
#${SHELL_ROOT_ID} .ge-bonus-card--custom { background:none; border:none; cursor:default; }
#${SHELL_ROOT_ID} .ge-bonus-body { display:flex; flex-direction:column; align-items:center; flex:1; padding:1.25em 1.1em .9em; }
#${SHELL_ROOT_ID} .ge-bonus-title { font-size:1.3em; font-weight:800; letter-spacing:.04em; text-transform:uppercase;
  color:var(--card-acc); margin-bottom:.75em; }
#${SHELL_ROOT_ID} .ge-bonus-thumb { height:6.2em; display:flex; align-items:center; justify-content:center; margin-bottom:.7em; }
#${SHELL_ROOT_ID} .ge-bonus-thumb img { max-height:100%; max-width:100%; object-fit:contain; filter:drop-shadow(0 6px 14px rgba(0,0,0,.45)); }
#${SHELL_ROOT_ID} .ge-bonus-thumb-ph { font-size:3.5em; color:var(--card-acc); opacity:.85; display:flex; }
#${SHELL_ROOT_ID} .ge-bonus-desc { font-size:.96em; line-height:1.45; color:rgba(255,255,255,.82); }
#${SHELL_ROOT_ID} .ge-bonus-spacer { flex:1; min-height:.7em; }
#${SHELL_ROOT_ID} .ge-bonus-vol { display:flex; justify-content:center; align-items:center; gap:0;
  font-size:2.2em; line-height:1; margin-bottom:.55em; }
#${SHELL_ROOT_ID} .ge-bonus-vol-on, #${SHELL_ROOT_ID} .ge-bonus-vol-off { display:inline-flex; gap:0; }
/* Volatility = the turbo bolt (turbo1) repeated: active bolts filled accent, inactive filled black
   and dimmed. Solid fill, no outline. */
#${SHELL_ROOT_ID} .ge-bonus-vol-on svg path { fill:var(--card-acc); }
#${SHELL_ROOT_ID} .ge-bonus-vol-off svg path { fill:#000; }
#${SHELL_ROOT_ID} .ge-bonus-vol-off { opacity:.5; }
#${SHELL_ROOT_ID} .ge-bonus-price { font-size:1.6em; font-weight:800; color:#fff; font-variant-numeric:tabular-nums; white-space:nowrap; }
#${SHELL_ROOT_ID} .ge-bonus-cta { width:100%; border:none; padding:1.15em; font-weight:800; font-size:1.05em;
  letter-spacing:.05em; text-transform:uppercase; cursor:pointer; background:var(--card-acc); color:var(--card-ink);
  transition:filter .12s ease; }
#${SHELL_ROOT_ID} .ge-bonus-cta:hover:not([disabled]) { filter:brightness(1.06); }
/* unaffordable / disabled */
#${SHELL_ROOT_ID} .ge-bonus-card.ge-bonus-off { opacity:.62; cursor:default; }
#${SHELL_ROOT_ID} .ge-bonus-off .ge-bonus-title { color:rgba(255,255,255,.6); }
#${SHELL_ROOT_ID} .ge-bonus-off .ge-bonus-vol-on { color:rgba(255,255,255,.4); }
#${SHELL_ROOT_ID} .ge-bonus-off .ge-bonus-cta { background:#8d939e; color:#3a3f47; cursor:default; }
/* buy-bonus confirm — bonus preview inside the shared sheet card (see .ge-sheet-actions below) */
#${SHELL_ROOT_ID} .ge-confirm-preview { display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; }
#${SHELL_ROOT_ID} .ge-confirm-preview .ge-bonus-thumb,
#${SHELL_ROOT_ID} .ge-confirm-preview .ge-bonus-vol { margin:0; }
/* effective-bet readout while a feature is active (value colour set inline to the feature accent) */
#${SHELL_ROOT_ID} .ge-rd.ge-bet-feature { font-weight:800; }
/* bet control — compact pill in a thin footer at the screen bottom (footer only as tall as the pill) */
#${SHELL_ROOT_ID} .ge-bb-betbar { flex:0 0 auto; display:flex; justify-content:center; padding:4px; }
#${SHELL_ROOT_ID} .ge-bb-betpill { display:inline-flex; align-items:center; gap:4px;
  background:var(--shell-plaque-dark); border-radius:999px; padding:3px 5px; }
#${SHELL_ROOT_ID} .ge-bb-betstep { pointer-events:auto; cursor:pointer; width:32px; height:32px; border:none; border-radius:50%;
  background:none; color:#fff; font-size:20px; display:flex; align-items:center; justify-content:center;
  transition:color .12s ease, transform .08s ease; }
#${SHELL_ROOT_ID} .ge-bb-betstep:hover { color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-bb-betstep:active { transform:scale(.9); }
#${SHELL_ROOT_ID} .ge-bb-betval { min-width:80px; text-align:center; padding:0 2px; }
#${SHELL_ROOT_ID} .ge-bb-betval span { display:block; font-size:7px; font-weight:600; letter-spacing:.14em; text-transform:uppercase;
  color:var(--shell-plaque-label); }
#${SHELL_ROOT_ID} .ge-bb-betval b { font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; color:#fff; }
/* Popout S (short landscape): the header (title + ✕) and the bet footer are fixed-px and dwarf the
   shrunk cards. Scale the buy-bonus chrome down with the FRAME height. Units are cqh (the overlay is a
   size container below), NOT vh — vh tracks the browser window, which only equals the frame inside the
   Stake iframe, so it wouldn't shrink in the demo's device-frame view. Coefficients hit the normal cap
   by ~450px tall (Popout L) and shrink below that, to a readable floor at Popout S (225px). */
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] { container:ge-bb-frame / size; }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-ov-head { padding:clamp(3px,1.33cqh,6px) 10px; }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-ov-title { font-size:clamp(11px,3.5cqh,16px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-ov-spacer { width:clamp(24px,7cqh,32px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-ov-nav { width:clamp(24px,7cqh,32px); height:clamp(24px,7cqh,32px);
  font-size:clamp(14px,4cqh,18px); border-radius:clamp(7px,2cqh,9px); }
/* the bet pill read too large next to the shrunk cards — size it ~0.8× across the board (the floors
   stay readable; the maxima are what dominate on Popout L / wide frames). */
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-bb-betbar { padding:clamp(2px,.75cqh,3px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-bb-betpill { padding:clamp(2px,.55cqh,3px) clamp(3px,.9cqh,4px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-bb-betstep { width:clamp(20px,5.7cqh,26px); height:clamp(20px,5.7cqh,26px);
  font-size:clamp(12px,3.5cqh,16px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-bb-betval { min-width:clamp(50px,14cqh,66px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-bb-betval b { font-size:clamp(9px,2.5cqh,11px); }
#${SHELL_ROOT_ID} [data-ge="buybonus-overlay"] .ge-bb-betval span { font-size:clamp(5px,1.25cqh,6px); }
/* Popout S (very short landscape, e.g. 400×225): the height-fit shrank the cards' descriptions to an
   unreadable ~4px floor with nothing to scroll. Below a ~340px frame height, drop the shrink-to-fit and
   switch the (non-mobile) buy-bonus to a READABLE vertical stack that scrolls vertically — like mobile.
   Query the overlay's ge-bb-frame size container so it tracks the popout frame, not the browser window. */
@container ge-bb-frame (max-height: 340px) {
  #${SHELL_ROOT_ID}:not(.ge-mobile) [data-ge="buybonus-overlay"] .ge-ov-scroll { overflow-y:auto; }
  #${SHELL_ROOT_ID}:not(.ge-mobile) [data-ge="buybonus-overlay"] .ge-ov-body { justify-content:flex-start; }
  #${SHELL_ROOT_ID}:not(.ge-mobile) .ge-bb-grid { flex-direction:column; align-items:center; overflow:visible; }
  #${SHELL_ROOT_ID}:not(.ge-mobile) .ge-bb-grid .ge-bonus-card {
    flex:0 0 auto; width:18em; font-size:min(12px, calc(84cqw / 18)); }
}

/* ═══ desktop control bar — one continuous dark panel; white-disc buttons; BUY BONUS outside-left ═══ */
/* the dark surface fills the row width (BUY BONUS sits outside, to its left) */
#${SHELL_ROOT_ID} .ge-bar-panel { flex:1 1 auto; min-width:0; box-sizing:border-box; display:flex;
  align-items:center; justify-content:space-between; gap:10px; height:68px; padding:0 14px;
  border-radius:12px; background:var(--shell-bar); }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-zone-left, #${SHELL_ROOT_ID} .ge-bar-panel .ge-zone-right { gap:12px; min-width:0; }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-rd { color:#fff; text-shadow:none; }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-rd .ge-lbl { color:var(--shell-plaque-label); }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-balance { min-width:142px; }  /* fixed-wide so the digits don't reflow the row */

/* white-disc buttons: black icon + black ring; hover tints just the ICON accent (no outer ring) */
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn { width:38px; height:38px; border-radius:50%; border:2px solid #000;
  background:var(--shell-btn); color:var(--shell-btn-ink); font-size:19px; }
/* hover + active/engaged tint the icon AND the ring accent (menu/steppers have no border, so unaffected) */
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn:hover { background:var(--shell-btn); color:var(--shell-accent); border-color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn.ge-active,
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn.ge-glow { color:var(--shell-accent); border-color:var(--shell-accent); }
/* autoplay glyph reads small in its disc — enlarge it */
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn[data-ge="autoplay"] { font-size:25px; }
/* MENU stays a plain (borderless) icon — just larger; no white disc */
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn[data-ge="menu"] { background:none; border:none;
  width:auto; height:auto; color:#fff; font-size:30px; }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-iconbtn[data-ge="menu"]:hover { background:none; color:var(--shell-accent); }
/* turbo at rest reads dimmed — clearly off, but lighter than a true [disabled] control */
#${SHELL_ROOT_ID} [data-ge="turbo"]:not(.ge-active) {  }
#${SHELL_ROOT_ID} [data-ge="turbo"]:not(.ge-active):hover { opacity:1; }

/* BET group — value + tight stacked chevrons, parked close to the divider (no extra air) */
#${SHELL_ROOT_ID} .ge-betgroup { display:flex; align-items:center; gap:8px; }
/* the value box is a FIXED width (sized to hold up to ~€100,000) so changing the stake never shifts
   the steppers/divider/SPIN; bigger amounts shrink the value span instead — see fitReadouts(). */
#${SHELL_ROOT_ID} .ge-betgroup .ge-bet-value { flex:0 0 auto; width:90px; border-radius:0; }
/* every readout's value is an inline-block span so it can be measured & transform-scaled to fit;
   numerals render in OswaldNum (the digit-only subset), text glyphs fall back to Inter */
#${SHELL_ROOT_ID} .ge-rd-val { display:inline-block; white-space:nowrap; transform-origin:left center;
  font-family:'OswaldNum','Inter',sans-serif; font-size:1.15em; }
#${SHELL_ROOT_ID} .ge-spin-count { font-family:'OswaldNum','Inter',sans-serif; }
#${SHELL_ROOT_ID} .ge-betgroup .ge-betstep { gap:2px; }
/* the +/- stay plain icons (no white disc), just bolder/bigger than the default */
#${SHELL_ROOT_ID} .ge-betgroup .ge-betstep .ge-iconbtn { background:none; border:none; width:30px; height:22px;
  color:#fff; font-size:22px; }
#${SHELL_ROOT_ID} .ge-betgroup .ge-betstep .ge-iconbtn:hover { background:none; color:var(--shell-accent); }
/* tappable stake readout opens the bet picker */
#${SHELL_ROOT_ID} .ge-betbtn { pointer-events:auto; cursor:pointer; border-radius:8px; transition:color .12s ease; }
#${SHELL_ROOT_ID} .ge-betbtn:hover { color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-betbtn.ge-disabled { pointer-events:none; }

/* divider — short, with air above & below (not full bar height) */
#${SHELL_ROOT_ID} .ge-pl-divider { align-self:center; flex:0 0 auto; width:1px; height:22px;
  background:var(--shell-plaque-line); }

/* SPIN + auto/turbo cluster — SPIN is the hero white disc: larger than the bar so it pops above/below */
#${SHELL_ROOT_ID} .ge-spinwrap { display:flex; align-items:center; gap:8px; }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-shell-spin { width:84px; height:84px; font-size:65px; border-width:4px;
  background:var(--shell-btn); color:var(--shell-btn-ink); position:relative; z-index:3; }
#${SHELL_ROOT_ID} .ge-bar-panel .ge-shell-spin:hover { background:var(--shell-btn); color:var(--shell-accent); box-shadow:none; }

/* FS hero — replaces SPIN in free spins: same white/black-ring hero, but a rounded rectangle showing
   the spins counter. Pops above/below the bar like SPIN (height matches the disc). */
#${SHELL_ROOT_ID} .ge-fs-hero { pointer-events:auto; box-sizing:border-box; height:84px; min-width:96px;
  padding:0 18px; border:4px solid #000; border-radius:20px; background:var(--shell-btn); color:var(--shell-btn-ink);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
  position:relative; z-index:3; }
/* the label wraps to ≤2 lines so long localizations ("Бесплатные вращения") fit the narrow hero */
#${SHELL_ROOT_ID} .ge-fs-hero .ge-fs-lbl { font-weight:700; font-size:9px; line-height:1.1; letter-spacing:.08em;
  text-transform:uppercase; color:#454c5a; text-align:center; max-width:11ch; }
#${SHELL_ROOT_ID} .ge-fs-hero .ge-fs-num { font-family:'OswaldNum','Inter',sans-serif; font-weight:700;
  font-size:30px; line-height:1; font-variant-numeric:tabular-nums; white-space:nowrap; }

/* BUY BONUS — floats outside-left of the bar; keeps its accent disc + hover ring (the one exception).
   relative/z-index so it stacks predictably under the full-screen overlays (see overlay-stacking test). */
#${SHELL_ROOT_ID} .ge-shell-bottom > .ge-shell-buybonus { flex:0 0 auto; width:71px; height:71px;
  font-size:11px; border-width:3px; position:relative; z-index:3; }

/* WIN — a plain readout (same as balance/bet), grouped on the left with the other info */
#${SHELL_ROOT_ID} .ge-bar-panel .ge-win { pointer-events:none; }

/* centred CARD modal — opaque card on a frosted backdrop, accent title heading at the top
   (no ✕), content, full-bleed footer button(s). Shared by the buy-bonus confirm AND the
   bet/autoplay pickers so every centred modal is the same type. Close via backdrop click. */
#${SHELL_ROOT_ID} .ge-sheet { position:absolute; inset:0; z-index:60; pointer-events:auto; display:flex;
  align-items:center; justify-content:center; padding:clamp(10px,4vh,24px); box-sizing:border-box;
  background:rgba(12,17,28,.5); backdrop-filter:blur(var(--ge-sheet-blur,20px)) saturate(120%);
  -webkit-backdrop-filter:blur(var(--ge-sheet-blur,20px)) saturate(120%); animation:ge-ov-in .16s ease-out; }
/* Card sizes in cq units of the shell root → responsive on EVERY screen, not just popouts. The
   card's font-size is the one knob (clamped for readability); everything inside is em-relative so
   the whole card scales as a unit. GameShell.fitModal() still transform-scales it down as a
   backstop for very short popouts. */
#${SHELL_ROOT_ID} .ge-modal-card { font-size:clamp(11px, 2cqmin, 15px); width:100%; max-width:28em; box-sizing:border-box;
  overflow:hidden; transform-origin:center center; background:var(--shell-plaque-solid); border-radius:1.3em;
  display:flex; flex-direction:column; }
/* ✕ pinned to the overlay corner (the screen), not the card */
#${SHELL_ROOT_ID} .ge-modal-close { position:absolute; top:12px; right:12px; z-index:2; width:36px; height:36px;
  border:none; border-radius:50%; cursor:pointer; pointer-events:auto; background:var(--shell-plaque-dark); color:#fff;
  display:flex; align-items:center; justify-content:center; font-size:20px; transition:background .12s ease, color .12s ease; }
#${SHELL_ROOT_ID} .ge-modal-close:hover { background:var(--shell-plaque-glass); color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-modal-body { padding:1.2em; display:flex; flex-direction:column; gap:1.05em; }
#${SHELL_ROOT_ID} .ge-modal-title { margin:0; text-align:center; color:var(--card-acc, var(--shell-accent));
  font-weight:800; letter-spacing:.04em; text-transform:uppercase; font-size:1.2em; }
#${SHELL_ROOT_ID} .ge-modal-text { margin:0; text-align:center; color:rgba(255,255,255,.85); font-size:.93em; line-height:1.5; }
#${SHELL_ROOT_ID} .ge-sheet-grid { display:grid; gap:.65em; grid-template-columns:repeat(var(--cols,3),1fr); }
#${SHELL_ROOT_ID}.ge-mobile .ge-sheet-grid { grid-template-columns:repeat(var(--cols-m,var(--cols,3)),1fr); }
/* the bet picker packs 6 chips/row → give its card room (autoplay & co. stay at the 28em default) */
#${SHELL_ROOT_ID} .ge-sheet[data-ge="bet-modal"] .ge-modal-card { max-width:44em; }
/* Bet chips carry variable-width currency (a wide currency makes labels grow). Reflow the columns
   to the widest label (--chip-min, computed in JS) so no chip is ever clipped, and cap the grid
   height so a long bet ladder scrolls instead of overflowing the card's clipped edge. */
#${SHELL_ROOT_ID} .ge-sheet[data-ge="bet-modal"] .ge-sheet-grid,
#${SHELL_ROOT_ID}.ge-mobile .ge-sheet[data-ge="bet-modal"] .ge-sheet-grid {
  grid-template-columns:repeat(auto-fill, minmax(min(100%, var(--chip-min, 6em)), 1fr));
  max-height:min(50vh, 28em); overflow-y:auto; overflow-x:hidden; }
#${SHELL_ROOT_ID} .ge-sheet[data-ge="bet-modal"] .ge-chip { min-width:0; }
#${SHELL_ROOT_ID} .ge-chip { pointer-events:auto; cursor:pointer; border:1px solid var(--shell-plaque-line);
  border-radius:.8em; background:rgba(255,255,255,.04); color:#fff; font-size:1em; font-weight:700;
  font-variant-numeric:tabular-nums; padding:.8em .55em; transition:background .12s ease, border-color .12s ease; }
#${SHELL_ROOT_ID} .ge-chip:hover { background:var(--shell-plaque-glass-hover); }
#${SHELL_ROOT_ID} .ge-chip.ge-on { border-color:var(--shell-accent); background:var(--shell-accent); color:#fff; }
/* full-bleed footer button(s), flush to the card's bottom edge (card clips the corners) */
#${SHELL_ROOT_ID} .ge-modal-actions { display:flex; }
#${SHELL_ROOT_ID} .ge-modal-actions > * { flex:1; }
#${SHELL_ROOT_ID} .ge-modal-btn { width:100%; border:none; padding:1.05em; font-size:1em; font-weight:800;
  letter-spacing:.04em; text-transform:uppercase; cursor:pointer; pointer-events:auto; transition:filter .12s ease; }
#${SHELL_ROOT_ID} .ge-modal-btn:hover:not([disabled]) { filter:brightness(1.08); }
#${SHELL_ROOT_ID} .ge-modal-btn--accent { background:var(--card-acc, var(--shell-accent)); color:#fff; }
#${SHELL_ROOT_ID} .ge-modal-btn--ghost { background:var(--shell-plaque-glass-hover); color:#fff; }
/* replay summary — label/value rows, accented total-win row */
#${SHELL_ROOT_ID} .ge-replay-rows { display:flex; flex-direction:column; }
#${SHELL_ROOT_ID} .ge-replay-row { display:flex; justify-content:space-between; align-items:baseline; gap:1.05em; padding:.73em .13em; }
#${SHELL_ROOT_ID} .ge-replay-row + .ge-replay-row { border-top:1px solid var(--shell-plaque-line); }
#${SHELL_ROOT_ID} .ge-replay-row span { color:var(--shell-plaque-label); text-transform:uppercase; letter-spacing:.07em; font-size:.73em; font-weight:700; }
#${SHELL_ROOT_ID} .ge-replay-row b { color:#fff; font-weight:800; font-size:1em; font-variant-numeric:tabular-nums; }
#${SHELL_ROOT_ID} .ge-replay-total span { color:#fff; font-size:.8em; }
#${SHELL_ROOT_ID} .ge-replay-total b { color:var(--shell-accent); font-size:1.27em; }

#${SHELL_ROOT_ID}.ge-shell-hidden { opacity:0; pointer-events:none; transition:opacity .25s ease; }
`;
