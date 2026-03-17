// ─── @pixi/layout setup (must be imported before creating containers) ────
import '@pixi/layout';

// ─── Engine UI Components ─────────────────────────────────
export { Button } from './Button';
export type { ButtonConfig, ButtonState } from './Button';
export { ProgressBar } from './ProgressBar';
export type { ProgressBarConfig } from './ProgressBar';
export { Label } from './Label';
export type { LabelConfig } from './Label';
export { Panel } from './Panel';
export type { PanelConfig } from './Panel';
export { BalanceDisplay } from './BalanceDisplay';
export type { BalanceDisplayConfig } from './BalanceDisplay';
export { WinDisplay } from './WinDisplay';
export type { WinDisplayConfig } from './WinDisplay';
export { Modal } from './Modal';
export type { ModalConfig } from './Modal';
export { Toast } from './Toast';
export type { ToastConfig, ToastType } from './Toast';
export { Layout } from './Layout';
export type { LayoutConfig, LayoutDirection, LayoutAlignment, LayoutAnchor } from './Layout';
export { ScrollContainer } from './ScrollContainer';
export type { ScrollContainerConfig, ScrollDirection } from './ScrollContainer';

// ─── Direct access to @pixi/ui and @pixi/layout ──────────
// These packages are optional peer dependencies.
// For any classes or types not wrapped by the engine (e.g. Slider, CheckBox,
// Input, Select, RadioGroup, List, etc.), import directly:
//
//   import { Slider, CheckBox } from '@pixi/ui';
//   import { LayoutContainer } from '@pixi/layout/components';
//
