import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';
import type { languages } from '../editor/monacoSlice';
import type { ConnectionService } from './connection';

/**
 * One editor language. `load` is lazy on purpose: Monaco's own grammar
 * modules (`monaco-editor/languages/definitions/<lang>/<lang>.js`) import
 * `editor/editor.api.js`, which must not be evaluated before `Monaco.tsx`'s
 * own `load()` (jsdom throws; the bundle would carry it eagerly). Our own
 * grammars use the same shape so there is one shape.
 */
export interface LanguageDef {
  id: string;
  /** With the dot, lower-case: '.ts'. */
  extensions: string[];
  load(): Promise<{ language: languages.IMonarchLanguage; conf?: languages.LanguageConfiguration }>;
}

declare module 'cordis' {
  interface Context {
    languages: LanguagesService;
  }
}

export interface LanguagesService {
  /** Same id again replaces (and retracts that id's `failed` diagnostic); the return retracts this registration. */
  register(def: LanguageDef): () => void;
  /** The language for a path by its last extension, or `'plaintext'`. */
  languageFor(path: string): string;
  list(): readonly LanguageDef[];
  subscribe(listener: () => void): () => void;
  /** A grammar that could not be loaded or compiled — reported as a diagnostic; `Monaco.tsx` calls this. */
  failed(id: string, message: string): void;
}

export const name = 'languages';

/** The extension of a path's basename, with the dot, lower-cased; '' for a dotfile or no dot. */
function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function apply(ctx: Context) {
  const entries = createRegistry<LanguageDef>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const failures = new Map<string, () => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Read leniently, as `slots` does: this service has no static dependency
  // on `connection` and keeps working (silently) without it.
  const connection = () => ctx.reflect.get('connection', false) as ConnectionService | undefined;

  const service: LanguagesService = {
    register(def) {
      for (const other of service.list()) {
        if (other.id === def.id) continue;
        const shared = def.extensions.filter((ext) => other.extensions.includes(ext));
        if (shared.length > 0)
          connection()?.report(
            diagnostic(
              'warning',
              'languages',
              def.id,
              `"${def.id}" also claims ${shared.join(', ')}, already claimed by "${other.id}" — the later registration wins`,
              'give each extension one language',
            ),
          );
      }
      failures.get(def.id)?.();
      failures.delete(def.id);
      const off = entries.add(def.id, def);
      notify();
      return () => {
        const isCurrent = entries.get(def.id) === def;
        off();
        if (isCurrent) notify();
      };
    },
    languageFor(path) {
      const ext = extensionOf(path);
      if (ext === '') return 'plaintext';
      // Reverse: the LAST registration claiming an extension wins.
      const defs = service.list();
      for (let i = defs.length - 1; i >= 0; i--)
        if (defs[i].extensions.includes(ext)) return defs[i].id;
      return 'plaintext';
    },
    list() {
      const result: LanguageDef[] = [];
      for (const id of entries.keys()) {
        const def = entries.get(id);
        if (def) result.push(def);
      }
      return result;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    failed(id, message) {
      failures.get(id)?.();
      const retract = connection()?.report(
        diagnostic(
          'error',
          'languages',
          id,
          `language "${id}": ${message}`,
          'fix the grammar and register the language again',
        ),
      );
      failures.set(id, retract ?? (() => {}));
    },
  };

  ctx.provide('languages', service);
}
