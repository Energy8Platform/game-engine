import { useState, useCallback, useRef, createElement } from 'react';
import type { ReactElement } from 'react';
import {
  ReactScene,
  extendPixiElements,
  extendUIElements,
  useEngine,
  useBalance,
} from '@energy8platform/game-engine/react';

// Register PixiJS + engine UI elements for JSX (idempotent)
extendPixiElements();
extendUIElements();

const BET_LEVELS = [0.20, 0.50, 1, 2, 5, 10, 20];

/**
 * Slot game scene built entirely with React + declarative engine UI components.
 * Shows the same slot UI as GameScene but using JSX instead of imperative code.
 */
export class ReactSlotScene extends ReactScene {
  render(): ReactElement {
    return createElement(SlotUI);
  }
}

// ─── Root component ──────────────────────────────────────

function SlotUI() {
  const { screen } = useEngine();
  const balance = useBalance();
  const [betIndex, setBetIndex] = useState(2);
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState(0);
  const [showWin, setShowWin] = useState(false);
  const [spins, setSpins] = useState(0);

  const bet = BET_LEVELS[betIndex];

  const changeBet = useCallback((delta: number) => {
    setBetIndex((i) => Math.max(0, Math.min(BET_LEVELS.length - 1, i + delta)));
  }, []);

  const spin = useCallback(async () => {
    if (spinning) return;
    setSpinning(true);
    setShowWin(false);
    setSpins((s) => s + 1);

    // Simulate spin delay
    await new Promise((r) => setTimeout(r, 1200));

    const isWin = Math.random() > 0.35;
    const win = isWin ? Math.round(bet * (1 + Math.random() * 20) * 100) / 100 : 0;

    if (win > 0) {
      setLastWin(win);
      setShowWin(true);
    }
    setSpinning(false);
  }, [spinning, bet]);

  const { width, height } = screen;
  const padding = 20;

  return (
    <container>
      {/* Background */}
      <graphics
        draw={(g: any) => {
          g.rect(0, 0, width, height).fill(0x0f0f23);
          g.circle(width / 2, height * 0.42, 400).fill({ color: 0x1a1a4a, alpha: 0.35 });
          g.circle(width / 2, height * 0.42, 250).fill({ color: 0x1a1a5a, alpha: 0.25 });
        }}
      />

      {/* Top bar */}
      <flexContainer
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        padding={[12, 24, 12, 24] as [number, number, number, number]}
        width={width}
        height={60}
        y={padding}
      >
        <balanceDisplay
          prefix="BALANCE"
          currency="USD"
          animated
          animationDuration={400}
          value={balance}
        />
        {showWin && (
          <label
            text={`WIN: $${lastWin.toFixed(2)}`}
            style-fontSize={28}
            style-fill={0xffd700}
            style-fontWeight="bold"
          />
        )}
      </flexContainer>

      {/* Spin counter */}
      <label
        text={`SPINS: ${spins}`}
        style-fontSize={14}
        style-fill={0x888888}
        x={width - 120}
        y={padding + 8}
      />

      {/* Reel area placeholder */}
      <graphics
        x={width / 2 - 310}
        y={height / 2 - 200}
        draw={(g: any) => {
          g.roundRect(0, 0, 620, 400, 16).fill({ color: 0x0a0a1e, alpha: 0.8 });
          g.roundRect(0, 0, 620, 400, 16).stroke({ color: 0x2a2a5a, width: 2 });
          // Grid placeholder
          for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 3; row++) {
              const x = 16 + col * 120;
              const y = 16 + row * 124;
              g.roundRect(x, y, 112, 116, 12).fill({ color: 0x1a1a3e, alpha: 0.9 });
              g.roundRect(x, y, 112, 116, 12).stroke({ color: 0x2a2a5a, width: 1 });
            }
          }
        }}
      />

      {/* Center message when spinning */}
      {spinning && (
        <label
          text="SPINNING..."
          style-fontSize={32}
          style-fill={0xffd700}
          style-fontWeight="bold"
          style-letterSpacing={6}
          x={width / 2}
          y={height / 2}
        />
      )}

      {/* Bottom bar */}
      <flexContainer
        direction="row"
        justifyContent="center"
        alignItems="center"
        gap={12}
        padding={[12, 24, 12, 24] as [number, number, number, number]}
        width={width}
        height={80}
        y={height - 80 - padding}
      >
        <button
          width={50} height={50} borderRadius={25}
          colors-default={0x334455} colors-hover={0x445566}
          colors-pressed={0x223344}
          text="i"
          textStyle={{ fontSize: 22, fontStyle: 'italic' }}
        />

        <button
          width={50} height={50} borderRadius={25}
          colors-default={0x444444} colors-hover={0x555555}
          colors-pressed={0x333333}
          text="-"
          textStyle={{ fontSize: 28 }}
          disabled={spinning}
          onPress={() => changeBet(-1)}
        />

        <label
          text={`BET: $${bet.toFixed(2)}`}
          style-fontSize={18}
          style-fill={0xcccccc}
          style-fontWeight="bold"
        />

        <button
          width={50} height={50} borderRadius={25}
          colors-default={0x444444} colors-hover={0x555555}
          colors-pressed={0x333333}
          text="+"
          textStyle={{ fontSize: 28 }}
          disabled={spinning}
          onPress={() => changeBet(1)}
        />

        <button
          width={140} height={60} borderRadius={30}
          colors-default={0x22aa44} colors-hover={0x33cc55}
          colors-pressed={0x1a8833} colors-disabled={0x333333}
          pressScale={0.92}
          text="SPIN"
          textStyle={{ fontSize: 22, letterSpacing: 3 }}
          disabled={spinning}
          onPress={spin}
        />

        <button
          width={50} height={50} borderRadius={25}
          colors-default={0x334455} colors-hover={0x445566}
          colors-pressed={0x223344}
          text="A"
          textStyle={{ fontSize: 18 }}
        />

        <button
          width={50} height={50} borderRadius={25}
          colors-default={0x334455} colors-hover={0x445566}
          colors-pressed={0x223344}
          text="⚙"
          textStyle={{ fontSize: 22 }}
        />
      </flexContainer>
    </container>
  );
}
