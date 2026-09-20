/**
 * Insets a page reserves around the game's viewport — a shell's bar, a
 * device notch — in viewport pixels. The scenes runtime fits the design
 * into the viewport MINUS these (`fitStage`), so a `pin` measures from
 * the safe rect's edges rather than the screen's. Same shape as the
 * shell's own `SafeArea`; a `safeArea` SERVICE on the context wins over
 * the shell's (an editor page's preset band, a notch).
 */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
