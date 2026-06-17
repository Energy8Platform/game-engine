import { Container } from 'pixi.js';
import type { ShellHost, ShellLayer } from '../context';
import { Overlay } from '../primitives/overlay';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { FlexBox } from '../primitives/flex';
import { Slider, Spacer } from '../primitives/controls';
import { IconButton } from '../primitives/widgets';

/** Settings overlay — sound on/off, volume sliders, and a Game info link. */
export function openSettings(host: ShellHost): ShellLayer {
  return new Overlay(host, {
    tag: 'settings',
    title: host.t('Settings'),
    onClose: () => host.closeLayer(),
    build: (w) => buildBody(host, w),
  });
}

function buildBody(host: ShellHost, width: number): Container {
  const col = new FlexBox({ direction: 'column', align: 'stretch', gap: 10 });

  // Sound on/off
  let soundOn = true;
  const speaker = new IconButton('soundOn', {
    size: 36,
    glyph: 24,
    color: host.tokens.plaqueLabel,
    hover: host.tokens.accent,
    activeColor: '#ffffff',
    active: true,
    onTap: () => {
      soundOn = !soundOn;
      speaker.setIcon(soundOn ? 'soundOn' : 'soundOff');
      speaker.active = soundOn;
      host.emit('settingChange', { key: 'sound', value: soundOn });
    },
  });
  col.add(glassRow(host, [textNode(host, host.t('Sound')), new Spacer(), speaker]));

  // Volume sliders
  col.add(sliderRow(host, width, 'master', host.t('Master volume')));
  col.add(sliderRow(host, width, 'music', host.t('Music')));
  col.add(sliderRow(host, width, 'sfx', host.t('SFX')));

  // Game info link
  const infoIcon = makeIcon('info', 22, '#ffffff');
  const infoLabel = textNode(host, host.t('Game info'));
  const chevron = makeIcon('chevronRight', 20, host.tokens.muted);
  const infoRow = glassRow(host, [infoIcon, infoLabel, new Spacer(), chevron], { button: true, onTap: () => host.openInfo() });
  col.add(infoRow);

  return col;
}

function textNode(host: ShellHost, text: string): Container {
  return makeText(text, { size: 14, weight: '600', color: '#ffffff' });
}

/** A full-width glass row holding the given children (label/controls), align-centred. */
function glassRow(host: ShellHost, children: Container[], opts: { button?: boolean; onTap?: () => void } = {}): FlexBox {
  const row = new FlexBox({
    direction: 'row',
    align: 'center',
    gap: 12,
    padding: { top: 13, bottom: 13, left: 16, right: 16 },
    background: { fill: host.tokens.plaqueGlass, radius: 16 },
  });
  for (const c of children) row.add(c, c instanceof Spacer ? { grow: 1 } : {});
  if (opts.button) {
    row.eventMode = 'static';
    row.cursor = 'pointer';
    if (opts.onTap) row.on('pointertap', opts.onTap);
  }
  return row;
}

/** A column row: head (label + live % value) over a draggable slider. */
function sliderRow(host: ShellHost, bodyWidth: number, key: string, label: string): FlexBox {
  const row = new FlexBox({
    direction: 'column',
    align: 'stretch',
    gap: 10,
    padding: { top: 13, bottom: 13, left: 16, right: 16 },
    background: { fill: host.tokens.plaqueGlass, radius: 16 },
  });
  const head = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between' });
  const valueText = makeText('100%', { size: 13, weight: '700', color: host.tokens.plaqueLabel });
  head.add(makeText(label, { size: 14, weight: '600', color: '#ffffff' }));
  head.add(new Spacer(), { grow: 1 });
  head.add(valueText);
  const slider = new Slider(host, 1, (v) => {
    valueText.text = `${Math.round(v * 100)}%`;
    host.emit('settingChange', { key, value: v });
  });
  row.add(head);
  row.add(slider);
  return row;
}
