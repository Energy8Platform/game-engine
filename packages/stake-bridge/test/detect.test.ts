import { describe, it, expect } from 'vitest';
import { isStakeLaunch } from '../src/detect';

const RGS = 'rgs_url=https%3A%2F%2Fx.stake-engine.com';

describe('isStakeLaunch', () => {
  it('true for a live wallet launch (rgs_url + sessionID)', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}&sessionID=abc`)).toBe(true);
  });
  it('true for a replay launch (rgs_url + replay=true)', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}&replay=true&game=g&version=1&mode=BASE&event=1`)).toBe(true);
  });
  it('false when rgs_url is missing', () => {
    expect(isStakeLaunch('https://game.example/?sessionID=abc')).toBe(false);
  });
  it('false when rgs_url present but no sessionID and no replay', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}`)).toBe(false);
  });
  it('false for replay flag that is not exactly "true"', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}&replay=1`)).toBe(false);
  });
  it('false for a malformed url', () => {
    expect(isStakeLaunch('::::not a url::::')).toBe(false);
  });
});
