import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as viewers from '../src/plugins/viewers';
import * as media from '../src/plugins/viewers-media';
import { TOO_BIG_BYTES } from '../src/shell/ViewerDocument';

function fakeConnection() {
  const reported: Diagnostic[] = [];
  return {
    reported,
    report: (d: Diagnostic) => {
      reported.push(d);
      return () => {};
    },
  };
}

async function boot(withMedia = false) {
  const ctx = new Context();
  const connection = fakeConnection();
  ctx.provide('connection', connection);
  ctx.provide('files', { urlFor: (p: string) => `/api/files/${p}` });
  await ctx.plugin(viewers);
  if (withMedia) await ctx.plugin(media);
  return { ctx, connection };
}

const Nothing = () => null;

describe('viewers', () => {
  it('pick returns the last registered viewer whose match says yes', async () => {
    const { ctx } = await boot();
    ctx.viewers.register({ id: 'a', match: (p) => p.endsWith('.x'), component: Nothing });
    ctx.viewers.register({ id: 'b', match: (p) => p.endsWith('.x'), component: Nothing });
    expect(ctx.viewers.pick('f.x')?.id).toBe('b');
    expect(ctx.viewers.pick('f.y')).toBeUndefined();
  });
  it('the same id again replaces, with a warning; a retract removes', async () => {
    const { ctx, connection } = await boot();
    const off = ctx.viewers.register({ id: 'a', match: () => true, component: Nothing });
    ctx.viewers.register({ id: 'a', match: () => false, component: Nothing });
    expect(connection.reported[0]).toMatchObject({
      severity: 'warning',
      plugin: 'viewers',
      where: 'a',
    });
    expect(ctx.viewers.pick('f')).toBeUndefined();
    off(); // stale
    expect(ctx.viewers.list()).toHaveLength(1);
  });
  it('match sees the entry', async () => {
    const { ctx } = await boot();
    ctx.viewers.register({ id: 'big', match: (_p, e) => (e?.size ?? 0) > 10, component: Nothing });
    expect(ctx.viewers.pick('f', { path: 'f', kind: 'file', size: 11 })?.id).toBe('big');
    expect(ctx.viewers.pick('f', { path: 'f', kind: 'file', size: 1 })).toBeUndefined();
  });
});

describe('viewers-media', () => {
  it('registers image, audio and video, matched by extension, case-insensitively', async () => {
    const { ctx } = await boot(true);
    expect(ctx.viewers.pick('a/logo.PNG')?.id).toBe('image');
    expect(ctx.viewers.pick('a/hero.avif')?.id).toBe('image');
    expect(ctx.viewers.pick('a/win.mp3')?.id).toBe('audio');
    expect(ctx.viewers.pick('a/intro.webm')?.id).toBe('video');
    expect(ctx.viewers.pick('a/script.spin')).toBeUndefined();
  });
  it('a big image still opens as an image — TOO_BIG_BYTES guards reading bytes, not <img src>', async () => {
    const { ctx } = await boot(true);
    expect(
      ctx.viewers.pick('big.png', { path: 'big.png', kind: 'file', size: TOO_BIG_BYTES + 1 })?.id,
    ).toBe('image');
  });
  it('the three components render native elements pointed at files.urlFor', async () => {
    const { ctx } = await boot(true);
    for (const [path, role, tag] of [
      ['art/logo.png', 'img', 'IMG'],
      ['sfx/win.mp3', null, 'AUDIO'],
      ['clips/intro.mp4', null, 'VIDEO'],
    ] as const) {
      const Def = ctx.viewers.pick(path)!.component;
      const { container, unmount } = render(<Def ctx={ctx} path={path} />);
      const el = role ? screen.getByRole(role) : container.querySelector(tag)!;
      expect(el.tagName).toBe(tag);
      expect(el.getAttribute('src')).toBe(`/api/files/${path}`);
      if (tag !== 'IMG') expect(el.hasAttribute('controls')).toBe(true);
      unmount();
    }
  });
});
