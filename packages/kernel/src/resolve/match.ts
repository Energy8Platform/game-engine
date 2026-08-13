import type { LaunchContext, Matcher } from './types';
import { error } from '../diagnostics';
import type { Diagnostic } from '../diagnostics';

function decodeSafe(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    // Malformed escape sequence; return the raw string
    return encoded;
  }
}

function hasUrlParam(url: string, param: string): boolean {
  if (!url || typeof url !== 'string') return false;
  // Parsed by hand: URL is a DOM/Node global and this package depends on neither.
  // Find hash first to know where the fragment starts, so we can ignore ?s in the fragment.
  const hash = url.indexOf('#');
  const beforeFragment = hash < 0 ? url : url.slice(0, hash);
  const query = beforeFragment.indexOf('?');
  if (query < 0) return false;
  const search = beforeFragment.slice(query + 1);
  for (const pair of search.split('&')) {
    const paramName = pair.split('=')[0];
    // Match if either the raw or the decoded name matches the param
    if (paramName === param || decodeSafe(paramName) === param) return true;
  }
  return false;
}

/** True when every condition the matcher declares holds. A pure `default` matcher never matches. */
export function matches(matcher: Matcher | undefined | null, ctx: LaunchContext, out?: Diagnostic[]): boolean {
  if (!matcher) return false;

  const conditions: boolean[] = [];
  if (matcher.urlParam !== undefined) {
    conditions.push(hasUrlParam(ctx?.url, matcher.urlParam));
  }
  if (matcher.buildTarget !== undefined) {
    conditions.push(ctx?.buildTarget === matcher.buildTarget);
  }
  if (matcher.match !== undefined) {
    try {
      const result = matcher.match(ctx);
      // Treat any truthy value as true, not just boolean true
      conditions.push(!!result);
    } catch (err) {
      // If the predicate throws, report it and treat it as no match
      if (out) {
        out.push(error('match/predicate-threw', `A matcher's custom rule threw: ${err instanceof Error ? err.message : String(err)}`, {
          fix: 'Fix the match() predicate, or express the rule with urlParam/buildTarget instead.',
        }));
      }
      conditions.push(false);
    }
  }

  if (conditions.length === 0) return false;
  return conditions.every(Boolean);
}

/** True for the fallback marker — a matcher that says only "use me when nothing else matched". */
export function isDefaultMatcher(matcher: Matcher | undefined | null): boolean {
  if (!matcher || matcher.default !== true) return false;
  return matcher.urlParam === undefined && matcher.buildTarget === undefined && matcher.match === undefined;
}

/** One sentence the IDE shows so a person can see when a contribution takes over. */
export function describeMatcher(matcher: Matcher | undefined | null): string {
  if (!matcher) return 'always';

  const parts: string[] = [];
  if (matcher.urlParam !== undefined) parts.push(`when ?${matcher.urlParam} is present`);
  if (matcher.buildTarget !== undefined) parts.push(`when the build target is "${matcher.buildTarget}"`);
  if (matcher.match !== undefined) parts.push('when a custom rule matches');
  if (parts.length === 0 && matcher.default === true) return 'when nothing else matches';

  return parts.length === 0 ? 'always' : parts.join(' and ');
}
