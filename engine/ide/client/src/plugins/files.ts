import type { Context } from 'cordis';
import { type Diagnostic, type FileEntry, diagnostic } from '@energy8engine/contracts';

/**
 * The browser side of `engine/ide/host/src/plugins/files.ts`'s four
 * routes. That plugin's own comment already spells out the one trap in
 * this pairing: `@cordisjs/plugin-server` decodes a path capture with
 * `decodeURIComponent(capture.replace(/\+/g, ' '))` — the query-string
 * reading of `+`, applied unconditionally to a path segment too. A file
 * named `a+b.txt` requested as a literal, unencoded `+` reads as
 * `a b.txt` and 404s. `tree()` hands back raw filesystem names, so
 * `urlFor` below is the one place that has to turn one into a URL
 * correctly — per segment, not the joined path in one call, which would
 * also escape the `/` separators this needs to keep.
 *
 * Shaped after `game-composition.ts`: a plain service wrapping `fetch`,
 * failures folded into a `diagnostics` array instead of a throw. What
 * differs is WHOSE diagnostics: `game-composition` only ever authors its
 * own (`/api/composition` has none of its own to carry). Every one of
 * these four routes already answers with a diagnostics body of its OWN,
 * written by the host, which knows the actual cause (outside the
 * project, not found, a directory where a file was wanted) — a 400 or
 * 404 is the host's ordinary way of refusing, not this client's failure
 * to talk to it. Passing that body through unchanged is the point; this
 * plugin only ever writes a diagnostic of its own for what only the
 * client can see — the network died, or the body was not the shape this
 * asked for.
 */
declare module 'cordis' {
  interface Context {
    files: FilesService;
  }
}

export interface FilesService {
  tree(): Promise<{ entries: FileEntry[]; diagnostics: Diagnostic[] }>;
  read(path: string): Promise<{ bytes?: Uint8Array; diagnostics: Diagnostic[] }>;
  write(path: string, bytes: Uint8Array): Promise<{ diagnostics: Diagnostic[] }>;
  remove(path: string): Promise<{ diagnostics: Diagnostic[] }>;
  /** Address for `<img src>` — reading the bytes just to show them is wasted work. */
  urlFor(path: string): string;
}

export interface FilesConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

export const name = 'files';

/** One diagnostic this client authors itself: the request never got a usable answer. */
function ownDiagnostic(where: string, message: string): Diagnostic {
  return diagnostic('error', 'files', where, message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Each `/`-separated segment encoded on its own and rejoined — encoding
 * the whole path in one `encodeURIComponent` call would also escape the
 * `/` this needs to keep as a separator.
 */
function urlFor(path: string): string {
  return `/api/files/${path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

/** `write`/`remove`, and `read`'s failure path, all answer `{ diagnostics }` — one parse for all three. */
async function diagnosticsFromBody(res: Response, where: string): Promise<Diagnostic[]> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    return [ownDiagnostic(where, describeError(error))];
  }
  const parsed = body as { diagnostics?: unknown };
  if (!Array.isArray(parsed.diagnostics)) {
    return [ownDiagnostic(where, 'the response has no "diagnostics" array')];
  }
  return parsed.diagnostics as Diagnostic[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function apply(ctx: Context, config: FilesConfig = {}): void {
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function tree(): ReturnType<FilesService['tree']> {
    let res: Response;
    try {
      res = await fetchFn('/api/files');
    } catch (error) {
      return { entries: [], diagnostics: [ownDiagnostic('/api/files', describeError(error))] };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      return { entries: [], diagnostics: [ownDiagnostic('/api/files', describeError(error))] };
    }
    const parsed = body as { entries?: unknown; diagnostics?: unknown };
    if (!Array.isArray(parsed.entries)) {
      return {
        entries: [],
        diagnostics: [ownDiagnostic('/api/files', 'the response has no "entries" array')],
      };
    }
    return {
      entries: parsed.entries as FileEntry[],
      diagnostics: Array.isArray(parsed.diagnostics) ? (parsed.diagnostics as Diagnostic[]) : [],
    };
  }

  async function read(path: string): ReturnType<FilesService['read']> {
    let res: Response;
    try {
      res = await fetchFn(urlFor(path));
    } catch (error) {
      return { diagnostics: [ownDiagnostic(path, describeError(error))] };
    }
    if (!res.ok) return { diagnostics: await diagnosticsFromBody(res, path) };
    try {
      return { bytes: new Uint8Array(await res.arrayBuffer()), diagnostics: [] };
    } catch (error) {
      return { diagnostics: [ownDiagnostic(path, describeError(error))] };
    }
  }

  async function write(path: string, bytes: Uint8Array): ReturnType<FilesService['write']> {
    let res: Response;
    try {
      res = await fetchFn(urlFor(path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base64: toBase64(bytes) }),
      });
    } catch (error) {
      return { diagnostics: [ownDiagnostic(path, describeError(error))] };
    }
    return { diagnostics: await diagnosticsFromBody(res, path) };
  }

  async function remove(path: string): ReturnType<FilesService['remove']> {
    let res: Response;
    try {
      res = await fetchFn(urlFor(path), { method: 'DELETE' });
    } catch (error) {
      return { diagnostics: [ownDiagnostic(path, describeError(error))] };
    }
    return { diagnostics: await diagnosticsFromBody(res, path) };
  }

  ctx.provide('files', { tree, read, write, remove, urlFor });
}
