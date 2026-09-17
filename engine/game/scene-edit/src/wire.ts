// The child-side half of the `e8:ide:*` postMessage RPC — a port of the request/response/event
// core of `ideBridge.ts` (feat/slot-ide-ir), decoupled from `window`/Pixi so it can run in a
// worker or be unit-tested with a fake transport.
//   parent → child   { type:'e8:ide:req', id, method, params }
//   child  → parent   { type:'e8:ide:res', id, ok, result | error }
//   child  → parent   { type:'e8:ide:evt', event, payload }   (unsolicited)

const REQ = 'e8:ide:req';
const RES = 'e8:ide:res';
const EVT = 'e8:ide:evt';

export interface WireOptions {
  parentOrigin: string;
  post(msg: unknown, origin: string): void;
  listen(fn: (e: { data: unknown; origin: string }) => void): () => void;
}

export interface Wire {
  emit(event: string, payload?: unknown): void;
  handle(method: string, fn: (params: unknown) => unknown | Promise<unknown>): void;
  dispose(): void;
}

interface ReqFrame {
  type: typeof REQ;
  id: number;
  method: string;
  params?: unknown;
}

function isReqFrame(data: unknown): data is ReqFrame {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === REQ &&
    typeof (data as { id?: unknown }).id === 'number' &&
    typeof (data as { method?: unknown }).method === 'string'
  );
}

export function createWire(o: WireOptions): Wire {
  const handlers = new Map<string, (params: unknown) => unknown | Promise<unknown>>();

  const post = (msg: unknown): void => o.post(msg, o.parentOrigin);

  const onMessage = (e: { data: unknown; origin: string }): void => {
    if (o.parentOrigin !== '*' && e.origin !== o.parentOrigin) return;
    if (!isReqFrame(e.data)) return;
    const { id, method, params } = e.data;
    const fn = handlers.get(method);
    if (!fn) {
      post({ type: RES, id, ok: false, error: `unknown method "${method}"` });
      return;
    }
    // Dispatched asynchronously so a handler that throws synchronously still answers ok:false
    // through this same catch, instead of throwing out of the message listener.
    Promise.resolve()
      .then(() => fn(params))
      .then(
        (result) => post({ type: RES, id, ok: true, result }),
        (err) => post({ type: RES, id, ok: false, error: String((err as Error)?.message ?? err) }),
      );
  };

  const stopListening = o.listen(onMessage);

  return {
    emit(event, payload) {
      post({ type: EVT, event, payload });
    },
    handle(method, fn) {
      handlers.set(method, fn);
    },
    dispose() {
      stopListening();
      handlers.clear();
    },
  };
}
