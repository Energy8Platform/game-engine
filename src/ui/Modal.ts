import { Container, Graphics } from 'pixi.js';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';

export interface ModalConfig {
  /** Overlay color */
  overlayColor?: number;
  /** Overlay alpha */
  overlayAlpha?: number;
  /** Close on overlay tap */
  closeOnOverlay?: boolean;
  /** Animation duration */
  animationDuration?: number;
}

/**
 * Modal overlay component.
 * Shows content on top of a dark overlay with enter/exit animations.
 *
 * Content is automatically centered via position calculations.
 *
 * @example
 * ```ts
 * const modal = new Modal({ closeOnOverlay: true });
 * modal.content.addChild(settingsPanel);
 * modal.onClose = () => console.log('Closed');
 * await modal.show(1920, 1080);
 * ```
 */
export class Modal extends Container {
  readonly __uiComponent = true as const;

  private _overlay: Graphics;
  private _contentContainer: Container;
  private _config: Required<ModalConfig>;
  private _showing = false;

  /** Called when the modal is closed */
  public onClose?: () => void;

  constructor(config: ModalConfig = {}) {
    super();

    this._config = {
      overlayColor: config.overlayColor ?? 0x000000,
      overlayAlpha: config.overlayAlpha ?? 0.7,
      closeOnOverlay: config.closeOnOverlay ?? true,
      animationDuration: config.animationDuration ?? 300,
    };

    // Overlay
    this._overlay = new Graphics();
    this._overlay.eventMode = 'static';
    this.addChild(this._overlay);

    if (this._config.closeOnOverlay) {
      this._overlay.on('pointertap', () => this.hide());
    }

    // Content container
    this._contentContainer = new Container();
    this.addChild(this._contentContainer);

    this.visible = false;
  }

  /** Content container — add your UI here */
  get content(): Container {
    return this._contentContainer;
  }

  /** Whether the modal is currently showing */
  get isShowing(): boolean {
    return this._showing;
  }

  /**
   * Show the modal with animation.
   */
  async show(viewWidth: number, viewHeight: number): Promise<void> {
    this._showing = true;
    this.visible = true;

    // Draw overlay to cover full screen
    this._overlay.clear();
    this._overlay.rect(0, 0, viewWidth, viewHeight).fill(this._config.overlayColor);
    this._overlay.alpha = 0;

    // Center content
    this._contentContainer.x = viewWidth / 2;
    this._contentContainer.y = viewHeight / 2;
    this._contentContainer.alpha = 0;
    this._contentContainer.scale.set(0.8);

    // Animate in
    await Promise.all([
      Tween.to(
        this._overlay,
        { alpha: this._config.overlayAlpha },
        this._config.animationDuration,
        Easing.easeOutCubic,
      ),
      Tween.to(
        this._contentContainer,
        { alpha: 1, 'scale.x': 1, 'scale.y': 1 },
        this._config.animationDuration,
        Easing.easeOutBack,
      ),
    ]);
  }

  /**
   * Hide the modal with animation.
   */
  async hide(): Promise<void> {
    if (!this._showing) return;

    await Promise.all([
      Tween.to(
        this._overlay,
        { alpha: 0 },
        this._config.animationDuration * 0.7,
        Easing.easeInCubic,
      ),
      Tween.to(
        this._contentContainer,
        { alpha: 0, 'scale.x': 0.8, 'scale.y': 0.8 },
        this._config.animationDuration * 0.7,
        Easing.easeInCubic,
      ),
    ]);

    this.visible = false;
    this._showing = false;
    this.onClose?.();
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('overlayAlpha' in changed) this._config.overlayAlpha = changed.overlayAlpha;
    if ('closeOnOverlay' in changed) this._config.closeOnOverlay = changed.closeOnOverlay;
    if ('animationDuration' in changed) this._config.animationDuration = changed.animationDuration;
    if ('onClose' in changed) this.onClose = changed.onClose;
  }
}
