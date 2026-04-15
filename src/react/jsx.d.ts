/**
 * JSX IntrinsicElements type declarations for the PixiJS React reconciler.
 *
 * Provides TypeScript autocompletion and type safety for:
 * - Standard PixiJS elements: <container>, <sprite>, <text>, <graphics>
 * - Engine UI components: <button>, <label>, <panel>, <flexContainer>, etc.
 *
 * Dash-notation is supported for nested config objects:
 *   <button colors-default={0xff0000} colors-hover={0x00ff00} />
 */

import type { Container, Texture, TextStyle } from 'pixi.js';
import type { ViewInput } from '../ui/view';
import type { ButtonConfig, ButtonState } from '../ui/Button';
import type { LabelConfig } from '../ui/Label';
import type { PanelConfig } from '../ui/Panel';
import type { FlexContainerConfig } from '../ui/FlexContainer';
import type { ProgressBarConfig } from '../ui/ProgressBar';
import type { ScrollContainerConfig } from '../ui/ScrollContainer';
import type { ModalConfig } from '../ui/Modal';
import type { ToastConfig } from '../ui/Toast';
import type { BalanceDisplayConfig } from '../ui/BalanceDisplay';
import type { WinDisplayConfig } from '../ui/WinDisplay';
import type { LayoutConfig } from '../ui/Layout';

// ─── Event props ─────────────────────────────────────────

interface PixiEventProps {
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

interface BaseProps extends PixiEventProps {
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
}

// ─── PixiJS primitive elements ───────────────────────────

interface SpriteProps extends BaseProps {
  texture?: string | Texture;
  anchor?: number | { x: number; y: number };
  tint?: number;
}

interface TextProps extends BaseProps {
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

interface GraphicsProps extends BaseProps {
  /** Draw function: receives the Graphics instance, called on mount and updates */
  draw?: (g: any) => void;
}

// ─── Engine UI component props ───────────────────────────

interface ButtonComponentProps extends BaseProps, Omit<ButtonConfig, 'colors' | 'textStyle'> {
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

interface LabelComponentProps extends BaseProps, Omit<LabelConfig, 'style'> {
  style?: Partial<TextStyle>;
  'style-fontSize'?: number;
  'style-fill'?: number | string;
  'style-fontFamily'?: string;
  'style-fontWeight'?: string;
  'style-letterSpacing'?: number;
}

interface PanelComponentProps extends BaseProps, Omit<PanelConfig, 'layout'> {
  layout?: Partial<FlexContainerConfig>;
}

interface FlexContainerComponentProps extends BaseProps, FlexContainerConfig {
  padding?: number | [number, number, number, number];
}

interface ProgressBarComponentProps extends BaseProps, ProgressBarConfig {
  progress?: number;
  /** Custom track background (string texture name, Texture, or Container) */
  trackView?: ViewInput;
  /** Custom fill bar */
  fillView?: ViewInput;
}

interface ScrollContainerComponentProps extends BaseProps, Omit<ScrollContainerConfig, 'width' | 'height'> {
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

interface ModalComponentProps extends BaseProps, ModalConfig {
  onClose?: () => void;
}

interface ToastComponentProps extends BaseProps, ToastConfig {
  /** Custom background view */
  backgroundView?: ViewInput;
}

interface BalanceDisplayComponentProps extends BaseProps, BalanceDisplayConfig {
  /** Current balance value */
  value?: number;
}

interface WinDisplayComponentProps extends BaseProps, WinDisplayConfig {}

interface LayoutComponentProps extends BaseProps, LayoutConfig {}

// ─── JSX IntrinsicElements ───────────────────────────────

declare global {
  namespace JSX {
    interface IntrinsicElements {
      // PixiJS primitives
      container: BaseProps;
      sprite: SpriteProps;
      text: TextProps;
      graphics: GraphicsProps;
      animatedSprite: BaseProps & { textures?: Texture[]; animationSpeed?: number; loop?: boolean; playing?: boolean };
      nineSliceSprite: BaseProps & { texture?: string | Texture; leftWidth?: number; topHeight?: number; rightWidth?: number; bottomHeight?: number };
      tilingSprite: BaseProps & { texture?: string | Texture; tilePosition?: { x: number; y: number } };

      // Engine UI components
      button: ButtonComponentProps;
      label: LabelComponentProps;
      panel: PanelComponentProps;
      flexContainer: FlexContainerComponentProps;
      progressBar: ProgressBarComponentProps;
      scrollContainer: ScrollContainerComponentProps;
      modal: ModalComponentProps;
      toast: ToastComponentProps;
      balanceDisplay: BalanceDisplayComponentProps;
      winDisplay: WinDisplayComponentProps;
      layout: LayoutComponentProps;
    }
  }
}

export {};
