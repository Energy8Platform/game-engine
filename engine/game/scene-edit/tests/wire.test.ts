import { describe, expect, it, vi } from 'vitest';
import { createWire } from '../src/wire';

function fakeWindow(parentOrigin = 'http://ide') {
  const posted: { msg: unknown; origin: string }[] = [];
  let listener: ((e: { data: unknown; origin: string }) => void) | undefined;
  const wire = createWire({
    parentOrigin,
    post: (msg, origin) => posted.push({ msg, origin }),
    listen: (fn) => { listener = fn; return () => { listener = undefined; }; },
  });
  return { wire, posted, receive: (data: unknown, origin = parentOrigin) => listener?.({ data, origin }) };
}

describe('wire', () => {
  it('answers a request with a response carrying the same id; a throwing handler answers ok:false', async () => {
    const { wire, posted, receive } = fakeWindow();
    wire.handle('select', (p) => ({ got: p }));
    wire.handle('boom', () => { throw new Error('nope'); });
    receive({ type: 'e8:ide:req', id: 1, method: 'select', params: { node: 'a' } });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ msg: { type: 'e8:ide:res', id: 1, ok: true, result: { got: { node: 'a' } } }, origin: 'http://ide' });
    receive({ type: 'e8:ide:req', id: 2, method: 'boom', params: {} });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].msg).toEqual({ type: 'e8:ide:res', id: 2, ok: false, error: 'nope' });
  });
  it('an unknown method is ok:false; a foreign origin, a non-request, or a malformed frame is ignored', async () => {
    const { wire, posted, receive } = fakeWindow();
    receive({ type: 'e8:ide:req', id: 3, method: 'nope', params: {} });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].msg).toMatchObject({ ok: false });
    receive({ type: 'e8:ide:req', id: 4, method: 'nope', params: {} }, 'http://evil');
    receive({ type: 'e8:ide:evt', event: 'x' });
    receive('junk');
    receive(null);
    await new Promise((r) => setTimeout(r, 5));
    expect(posted).toHaveLength(1);
  });
  it('emit posts an event to the parent origin; "*" accepts any origin', () => {
    const { wire, posted, receive } = fakeWindow('*');
    wire.emit('ready', { scene: 'a' });
    expect(posted[0]).toEqual({ msg: { type: 'e8:ide:evt', event: 'ready', payload: { scene: 'a' } }, origin: '*' });
    wire.handle('grid', () => ({}));
    receive({ type: 'e8:ide:req', id: 1, method: 'grid', params: {} }, 'http://anything');
    return vi.waitFor(() => expect(posted).toHaveLength(2));
  });
});
