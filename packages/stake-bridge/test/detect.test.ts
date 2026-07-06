import { describe, it, expect } from 'vitest';
import { isStakeLaunch, classifyStakeLaunch } from '../src/detect';

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
  it('false when rgs_url is present but tampered to a non-Stake host', () => {
    expect(isStakeLaunch('https://game.example/?rgs_url=evil.com&sessionID=abc')).toBe(false);
  });
});

describe('classifyStakeLaunch (host security gate)', () => {
  it("'stake' for a valid live launch (valid rgs_url + sessionID)", () => {
    expect(classifyStakeLaunch(`https://game.example/?${RGS}&sessionID=abc`)).toBe('stake');
  });
  it("'stake' for a valid replay launch (valid rgs_url + replay=true)", () => {
    expect(classifyStakeLaunch(`https://game.example/?${RGS}&replay=true`)).toBe('stake');
  });
  it("'stake' for the bare-host rgs_url form Stake actually sends", () => {
    expect(classifyStakeLaunch('https://game.example/?rgs_url=rgsd.stake-engine.com&sessionID=abc')).toBe('stake');
  });

  // The reported bug: a Stake session whose rgs_url was stripped must NOT fall through to offline.
  it("'blocked' when a session is present but rgs_url was removed", () => {
    expect(classifyStakeLaunch('https://game.example/?sessionID=abc')).toBe('blocked');
  });
  it("'blocked' when a session is present but rgs_url is blank", () => {
    expect(classifyStakeLaunch('https://game.example/?rgs_url=&sessionID=abc')).toBe('blocked');
  });
  it("'blocked' when rgs_url is tampered to a non-Stake host (open-redirect)", () => {
    expect(classifyStakeLaunch('https://game.example/?rgs_url=evil.com&sessionID=abc')).toBe('blocked');
    expect(classifyStakeLaunch('https://game.example/?rgs_url=stake-engine.com.evil.com&sessionID=abc')).toBe('blocked');
  });
  it("'blocked' for a replay launch whose rgs_url was stripped", () => {
    expect(classifyStakeLaunch('https://game.example/?replay=true&game=g&version=1&mode=BASE&event=1')).toBe('blocked');
  });

  it("'offline' for a genuine non-Stake launch (no session markers)", () => {
    expect(classifyStakeLaunch('https://game.example/')).toBe('offline');
    expect(classifyStakeLaunch(`https://game.example/?${RGS}`)).toBe('offline'); // rgs but no session
  });
  it("'offline' for a malformed url (nothing Stake-ish to enforce)", () => {
    expect(classifyStakeLaunch('::::not a url::::')).toBe('offline');
  });
});
