// packages/game-engine/tests/intro-option.test.ts
import { describe, it, expect } from 'vitest';
import { resolveIntro } from '@/host/introOption';
import { Scene } from '@/core/Scene';

class MyIntro extends Scene { async onEnter() {} onExit() {} }

describe('resolveIntro', () => {
  it('class form: returns the provided scene ctor + data, marks custom', () => {
    const r = resolveIntro({ scene: MyIntro, data: { foo: 1 } });
    expect(r?.ctor).toBe(MyIntro);
    expect(r?.data).toEqual({ foo: 1 });
  });
  it('config form: returns the built-in IntroScene ctor + the config as data', () => {
    const r = resolveIntro({ title: 'Hi' });
    expect(r?.ctor.name).toBe('IntroScene');
    expect(r?.data).toEqual({ title: 'Hi' });
  });
  it('undefined: returns null', () => {
    expect(resolveIntro(undefined)).toBeNull();
  });
});
