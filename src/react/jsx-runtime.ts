/**
 * JSX prop types for the PixiJS React reconciler.
 *
 * The engine auto-augments `react`'s module-scoped `JSX.IntrinsicElements`
 * with every registered element (`<flexContainer>`, `<button>`, `<label>`,
 * `<labelValue>`, etc). Because the augmentation is scoped to the `react`
 * module (not the legacy global `JSX` namespace), it reliably wins over
 * `@types/react`'s HTML defaults for colliding names like `<button>` / `<label>`.
 *
 * **Consumers don't need any shim.** Any import from `@energy8platform/game-engine/react`
 * (e.g. `createPixiRoot`, `extendUIElements`, `ReactScene` — you're already
 * importing these to boot the reconciler) pulls this module in and the JSX
 * types activate automatically.
 *
 * If a project imports only from `/ui` or `/core` and never touches `/react`,
 * add a one-line side-effect import to trigger the augmentation:
 *
 * ```ts
 * // app/src/pixi-jsx.d.ts
 * import '@energy8platform/game-engine/react-jsx';
 * ```
 *
 * Dash-notation for nested config objects is supported:
 *   <button colors-default={0xff0000} colors-hover={0x00ff00} />
 */

import type { Texture, TextStyle } from 'pixi.js';
import type { ViewInput } from '../ui/view';
import type { ButtonConfig, ButtonState } from '../ui/Button';
import type { LabelConfig } from '../ui/Label';
import type { LabelValueConfig } from '../ui/LabelValue';
import type { PanelConfig } from '../ui/Panel';
import type { FlexContainerConfig, AlignSelf, AlignContent } from '../ui/FlexContainer';
import type { ProgressBarConfig } from '../ui/ProgressBar';
import type { ScrollContainerConfig } from '../ui/ScrollContainer';
import type { ModalConfig } from '../ui/Modal';
import type { ToastConfig } from '../ui/Toast';
import type { BalanceDisplayConfig } from '../ui/BalanceDisplay';
import type { WinDisplayConfig } from '../ui/WinDisplay';
import type { LayoutConfig } from '../ui/Layout';
import type { SliderConfig } from '../ui/Slider';
import type { ToggleConfig } from '../ui/Toggle';

// ─── Event props ─────────────────────────────────────────

export interface PixiEventProps {
  onClick?: (e: any) => void;
  onPointerDown?: (e: any) => void;
  onPointerUp?: (e: any) => void;
  onPointerMove?: (e: any) => void;
  onPointerOver?: (e: any) => void;
  onPointerOut?: (e: any) => void;
  onPointerEnter?: (e: any) => void;
  onPointerLeave?: (e: any) => void;
  onPointerCancel?: (e: any) => void;
  onPointerTap?: (e: any) => void;
  onPointerUpOutside?: (e: any) => void;
  onMouseDown?: (e: any) => void;
  onMouseUp?: (e: any) => void;
  onMouseMove?: (e: any) => void;
  onMouseOver?: (e: any) => void;
  onMouseOut?: (e: any) => void;
  onWheel?: (e: any) => void;
  onTap?: (e: any) => void;
  onRightClick?: (e: any) => void;
}

// ─── Base container props (shared by all elements) ───────

export interface BaseProps extends PixiEventProps {
  key?: React.Key;
  ref?: React.Ref<any>;
  children?: React.ReactNode;

  // Container props
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  alpha?: number;
  visible?: boolean;
  rotation?: number;
  angle?: number;
  zIndex?: number;
  label?: string;
  cursor?: string;
  eventMode?: 'auto' | 'none' | 'passive' | 'static' | 'dynamic';

  // Nested via dash-notation
  'scale-x'?: number;
  'scale-y'?: number;
  'pivot-x'?: number;
  'pivot-y'?: number;
  'position-x'?: number;
  'position-y'?: number;
  'anchor-x'?: number;
  'anchor-y'?: number;

  // Allow scale as number (uniform)
  scale?: number | { x: number; y: number };

  // Flex item props (used when child of <flexContainer>)
  flexGrow?: number;
  flexShrink?: number;
  layoutWidth?: number | string;
  layoutHeight?: number | string;
  alignSelf?: AlignSelf;
  flexExclude?: boolean;
  // Absolute positioning for flexExclude children.
  // Values describe the visual bounding rectangle (top-left of the rendered
  // frame), so elements with centered origin like Button/Label are positioned
  // intuitively — (left: 100, top: 50) puts the visible corner at (100, 50).
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  /** X coordinate of the visual center within parent (px or `'50%'`). Overrides left/right. */
  centerX?: number | string;
  /** Y coordinate of the visual center within parent (px or `'50%'`). Overrides top/bottom. */
  centerY?: number | string;
}

// ─── PixiJS primitive elements ───────────────────────────

export interface SpriteProps extends BaseProps {
  texture?: string | Texture;
  anchor?: number | { x: number; y: number };
  tint?: number;
}

export interface TextProps extends BaseProps {
  text?: string;
  style?: Partial<TextStyle>;
  anchor?: number | { x: number; y: number };
  // Dash-notation for style
  'style-fontSize'?: number;
  'style-fill'?: number | string;
  'style-fontFamily'?: string;
  'style-fontWeight'?: string;
  'style-letterSpacing'?: number;
}

export interface GraphicsProps extends BaseProps {
  /** Draw function: receives the Graphics instance, called on mount and updates */
  draw?: (g: any) => void;
  /**
   * Layout size hint (pixels). For Graphics, `width`/`height` do NOT apply a scale
   * transform (unlike Container.width). They're forwarded to the parent
   * FlexContainer as `layoutWidth`/`layoutHeight` so layout measures the element
   * at the requested size while the actual geometry stays in the `draw` callback.
   */
  width?: number;
  height?: number;
}

export interface AnimatedSpriteProps extends BaseProps {
  textures?: Texture[];
  animationSpeed?: number;
  loop?: boolean;
  playing?: boolean;
}

export interface NineSliceSpriteProps extends BaseProps {
  texture?: string | Texture;
  leftWidth?: number;
  topHeight?: number;
  rightWidth?: number;
  bottomHeight?: number;
}

export interface TilingSpriteProps extends BaseProps {
  texture?: string | Texture;
  tilePosition?: { x: number; y: number };
}

// ─── Engine UI component props ───────────────────────────

export interface ButtonComponentProps extends BaseProps, Omit<ButtonConfig, 'colors' | 'textStyle'> {
  // Full object form
  colors?: Partial<Record<ButtonState, number>>;
  textStyle?: Record<string, unknown>;
  // Custom views (ViewInput: string texture name, Texture, or Container)
  defaultView?: ViewInput;
  hoverView?: ViewInput;
  pressedView?: ViewInput;
  disabledView?: ViewInput;
  // Dash-notation for nested objects
  'colors-default'?: number;
  'colors-hover'?: number;
  'colors-pressed'?: number;
  'colors-disabled'?: number;
  'textStyle-fontSize'?: number;
  'textStyle-fill'?: number | string;
  'textStyle-fontFamily'?: string;
  'textStyle-fontWeight'?: string;
  'textStyle-fontStyle'?: string;
  'textStyle-letterSpacing'?: number;
  // Component callbacks
  onPress?: () => void;
}

export interface LabelComponentProps extends BaseProps, Omit<LabelConfig, 'style'> {
  style?: Partial<TextStyle>;
  'style-fontSize'?: number;
  'style-fill'?: number | string;
  'style-fontFamily'?: string;
  'style-fontWeight'?: string;
  'style-letterSpacing'?: number;
}

export interface LabelValueComponentProps extends Omit<BaseProps, 'width' | 'height' | 'label'>,
  Omit<LabelValueConfig, 'labelStyle' | 'valueStyle'> {
  labelStyle?: Partial<TextStyle>;
  valueStyle?: Partial<TextStyle>;
  width?: number | string;
  height?: number | string;
  // Dash-notation for nested styles
  'labelStyle-fontSize'?: number;
  'labelStyle-fill'?: number | string;
  'labelStyle-fontFamily'?: string;
  'labelStyle-fontWeight'?: string;
  'valueStyle-fontSize'?: number;
  'valueStyle-fill'?: number | string;
  'valueStyle-fontFamily'?: string;
  'valueStyle-fontWeight'?: string;
}

export interface PanelComponentProps extends BaseProps, Omit<PanelConfig, 'layout'> {
  layout?: Partial<FlexContainerConfig>;
}

export interface FlexContainerComponentProps extends Omit<BaseProps, 'width' | 'height'>, FlexContainerConfig {
  padding?: number | [number, number, number, number];
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  alignContent?: AlignContent;
  width?: number | string;
  height?: number | string;
}

export interface ProgressBarComponentProps extends BaseProps, ProgressBarConfig {
  progress?: number;
  /** Custom track background (string texture name, Texture, or Container) */
  trackView?: ViewInput;
  /** Custom fill bar */
  fillView?: ViewInput;
}

export interface ScrollContainerComponentProps extends BaseProps, Omit<ScrollContainerConfig, 'width' | 'height'> {
  width: number;
  height: number;
  /** Show scrollbar indicator */
  scrollbar?: boolean;
  /** Custom scrollbar thumb view */
  thumbView?: ViewInput;
  scrollbarWidth?: number;
  scrollbarPadding?: number;
  scrollbarColor?: number;
  scrollbarAlpha?: number;
}

export interface ModalComponentProps extends BaseProps, ModalConfig {
  onClose?: () => void;
}

export interface ToastComponentProps extends BaseProps, ToastConfig {
  /** Custom background view */
  backgroundView?: ViewInput;
}

export interface BalanceDisplayComponentProps extends BaseProps, BalanceDisplayConfig {
  /** Current balance value */
  value?: number;
}

export interface WinDisplayComponentProps extends BaseProps, WinDisplayConfig {}

export interface LayoutComponentProps extends BaseProps, LayoutConfig {}

export interface SliderComponentProps extends BaseProps, Omit<SliderConfig, 'width' | 'height'> {
  width?: number;
  height?: number;
  onUpdate?: (value: number) => void;
  onChange?: (value: number) => void;
}

export interface ToggleComponentProps extends BaseProps, Omit<ToggleConfig, 'width' | 'height'> {
  width?: number;
  height?: number;
  onView?: ViewInput;
  offView?: ViewInput;
  onChange?: (value: boolean) => void;
}

// ─── IntrinsicElements map ───────────────────────────────

/**
 * Complete element → prop-type map for all engine-registered JSX elements.
 * Also consumable directly for typing custom wrappers around engine elements.
 */
export interface EngineIntrinsicElements {
  // PixiJS primitives
  container: BaseProps;
  sprite: SpriteProps;
  text: TextProps;
  graphics: GraphicsProps;
  animatedSprite: AnimatedSpriteProps;
  nineSliceSprite: NineSliceSpriteProps;
  tilingSprite: TilingSpriteProps;

  // Engine UI components
  button: ButtonComponentProps;
  label: LabelComponentProps;
  labelValue: LabelValueComponentProps;
  panel: PanelComponentProps;
  flexContainer: FlexContainerComponentProps;
  progressBar: ProgressBarComponentProps;
  scrollContainer: ScrollContainerComponentProps;
  modal: ModalComponentProps;
  toast: ToastComponentProps;
  balanceDisplay: BalanceDisplayComponentProps;
  winDisplay: WinDisplayComponentProps;
  layout: LayoutComponentProps;
  slider: SliderComponentProps;
  toggle: ToggleComponentProps;
}

// ─── Auto-augment React's JSX namespace ──────────────────
//
// React 19 scopes `JSX.IntrinsicElements` inside `declare module 'react'`,
// so we augment the same module. `extends EngineIntrinsicElements {}` adds
// every engine element to the interface the reconciler sees.
//
// Interface merging with `@types/react`'s HTML defaults: property names
// unique to the engine (`flexContainer`, `labelValue`, `button` since it
// carries our ButtonComponentProps, etc.) merge cleanly. For HTML-colliding
// names (`button`, `label`), this module-scoped augmentation takes precedence
// over the legacy global JSX namespace in React-19 apps.

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends EngineIntrinsicElements {}
  }
}
