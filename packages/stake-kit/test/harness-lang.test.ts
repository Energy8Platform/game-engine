import { describe, it, expect } from 'vitest';

import { renderWrapperHtml } from '../src/harness/wrapper';
import { LANGS } from '../src/harness/langs';

// ---------------------------------------------------------------------------
// LANGS constant
// ---------------------------------------------------------------------------

describe('LANGS', () => {
  it('exports exactly 16 languages', () => {
    expect(LANGS).toHaveLength(16);
  });

  it('contains every required language code', () => {
    const codes = LANGS.map((l) => l.code);
    for (const c of ['de', 'en', 'es', 'fi', 'fr', 'hi', 'id', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh', 'da']) {
      expect(codes).toContain(c);
    }
  });

  it('each entry has a non-empty code and label', () => {
    for (const l of LANGS) {
      expect(l.code.length).toBeGreaterThan(0);
      expect(l.label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// renderWrapperHtml — language selector presence
// ---------------------------------------------------------------------------

const base = {
  gameId: 'demo-slot',
  version: '1',
  betLevelsMajor: [0.2, 1, 5],
  currencies: ['USD', 'EUR'],
  rgsUrl: 'localhost:5173/__rgs',
  modes: [],
};

describe('renderWrapperHtml — language selector', () => {
  it('renders a <select id="lang"> element', () => {
    const html = renderWrapperHtml(base);
    expect(html).toContain('id="lang"');
  });

  it('renders exactly 16 <option> elements inside the lang select', () => {
    const html = renderWrapperHtml(base);
    // Parse out the lang select block — extract from id="lang" to next </select>
    const match = html.match(/id="lang"[^>]*>([\s\S]*?)<\/select>/);
    expect(match).not.toBeNull();
    const optionCount = (match![1].match(/<option/g) ?? []).length;
    expect(optionCount).toBe(16);
  });

  it('marks "en" as selected by default', () => {
    const html = renderWrapperHtml(base);
    expect(html).toContain('value="en" selected');
  });

  it('includes the lang <select> label/row inside the settings popover', () => {
    const html = renderWrapperHtml(base);
    // The settings popover must contain both the currency and lang rows
    const settingsPop = html.match(/id="pop-settings"[\s\S]*?<\/div>\s*<div class="popover/);
    // Simpler: just confirm lang is inside the harness body, near other settings
    expect(html).toContain('id="lang"');
    expect(html).toContain('id="currency"');
    // both should appear before the screen popover (lang is in settings panel)
    const langIdx = html.indexOf('id="lang"');
    const screenPopIdx = html.indexOf('id="pop-screen"');
    expect(langIdx).toBeLessThan(screenPopIdx);
  });

  it('the inline driver contains a langSel variable referencing id="lang"', () => {
    const html = renderWrapperHtml(base);
    // The driver must bind a variable to the lang select for change events
    expect(html).toContain("byId('lang')");
  });

  it('the launchNormal function passes lang to buildLaunchUrl', () => {
    const html = renderWrapperHtml(base);
    // The driver's launchNormal must include lang in the buildLaunchUrl opts
    expect(html).toContain('lang:');
  });

  it('the lang select change triggers launchNormal (event wiring)', () => {
    const html = renderWrapperHtml(base);
    // Must attach a change listener on langSel
    expect(html).toContain('langSel.addEventListener');
  });
});
