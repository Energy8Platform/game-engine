import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import { createFlowNodes } from '@energy8engine/flow';
import * as runtime from '../src/runtime';

describe('fx1 runtime half', () => {
  it('registers tween, count, sound and audio on flowNodes; dispose takes them all back', async () => {
    const ctx = new Context();
    const flowNodes = createFlowNodes();
    ctx.provide('flowNodes', flowNodes);
    const fiber = ctx.plugin(runtime);
    await fiber;
    expect(flowNodes.get('tween')?.kind).toBe('tween');
    expect(flowNodes.get('count')?.kind).toBe('count');
    expect(flowNodes.get('sound')?.kind).toBe('sound');
    expect(flowNodes.get('audio')?.kind).toBe('audio');
    await fiber.dispose();
    expect(flowNodes.list()).toEqual([]);
  });

  it('names itself and needs only flowNodes', () => {
    expect(runtime.name).toBe('flow-fx');
    expect(runtime.inject).toEqual(['flowNodes']);
  });
});
