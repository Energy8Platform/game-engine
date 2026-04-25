import type { TextStyle } from 'pixi.js';
import { FlexContainer, type FlexContainerConfig } from './FlexContainer';
import { Label } from './Label';

export type LabelValueAlign = 'start' | 'center' | 'end';

export interface LabelValueConfig {
  /** Caption text (top row, typically smaller/muted) */
  label?: string;
  /** Value text (bottom row, typically larger/prominent) */
  value?: string;
  /** Style for the caption Label */
  labelStyle?: Partial<TextStyle>;
  /** Style for the value Label */
  valueStyle?: Partial<TextStyle>;
  /** Gap in pixels between caption and value (default: 4) */
  gap?: number;
  /** Horizontal alignment of both rows (default: 'center') */
  align?: LabelValueAlign;
  /** Maximum width — value will be auto-scaled to fit when exceeded */
  maxWidth?: number;
  /** Optional padding (forwarded to the underlying FlexContainer) */
  padding?: FlexContainerConfig['padding'];
}

/**
 * Two-row text cell with a muted caption above and a prominent value below —
 * the archetypal casino UI pattern (BALANCE/€500, BET/€1, WIN/€0.00).
 *
 * Extends FlexContainer, so it participates in parent flex layouts directly
 * (you can pass `flexGrow`, `alignSelf`, etc. when it's a child of another
 * FlexContainer) and auto-sizes to its contents when no explicit size is set.
 *
 * @example
 * ```tsx
 * <labelValue
 *   label="BALANCE"
 *   value={`€${balance.toFixed(2)}`}
 *   labelStyle={{ fontSize: 12, fill: 0x888888 }}
 *   valueStyle={{ fontSize: 22, fill: 0xffffff, fontWeight: 'bold' }}
 *   gap={6}
 *   align="center"
 * />
 * ```
 */
export class LabelValue extends FlexContainer {
  private readonly _labelEl: Label;
  private readonly _valueEl: Label;
  private _valueMaxWidth: number;

  constructor(config: LabelValueConfig = {}) {
    super({
      direction: 'column',
      alignItems: toAlignItems(config.align ?? 'center'),
      gap: config.gap ?? 4,
      padding: config.padding,
    });

    this._valueMaxWidth = config.maxWidth ?? Infinity;

    this._labelEl = new Label({
      text: config.label ?? '',
      style: config.labelStyle,
    });
    this._valueEl = new Label({
      text: config.value ?? '',
      style: config.valueStyle,
      maxWidth: config.maxWidth,
      autoFit: config.maxWidth !== undefined,
    });

    this.addFlexChild(this._labelEl);
    this.addFlexChild(this._valueEl);
  }

  /** Get the caption Label (for advanced styling / animation) */
  get labelElement(): Label {
    return this._labelEl;
  }

  /** Get the value Label */
  get valueElement(): Label {
    return this._valueEl;
  }

  /** Update caption text */
  setLabel(text: string): void {
    this._labelEl.text = text;
    this.updateLayout();
  }

  /** Update value text */
  setValue(text: string): void {
    this._valueEl.text = text;
    this.updateLayout();
  }

  /** React reconciler update hook */
  override updateConfig(changed: Record<string, any>): void {
    if ('label' in changed) this._labelEl.text = changed.label ?? '';
    if ('value' in changed) this._valueEl.text = changed.value ?? '';
    if ('labelStyle' in changed && typeof changed.labelStyle === 'object') {
      Object.assign(this._labelEl.style, changed.labelStyle);
    }
    if ('valueStyle' in changed && typeof changed.valueStyle === 'object') {
      Object.assign(this._valueEl.style, changed.valueStyle);
    }
    if ('maxWidth' in changed) {
      this._valueMaxWidth = changed.maxWidth ?? Infinity;
      this._valueEl.maxWidth = this._valueMaxWidth;
    }
    if ('gap' in changed) this.setGap(changed.gap);
    if ('align' in changed) this.setAlignItems(toAlignItems(changed.align));

    // Forward remaining FlexContainer props (e.g. padding, width, height)
    super.updateConfig(changed);
  }
}

function toAlignItems(align: LabelValueAlign): 'start' | 'center' | 'end' {
  return align;
}
