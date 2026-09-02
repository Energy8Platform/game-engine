/**
 * A seam is a capability with exactly one provider: `renderer`, `session`,
 * `ui.shell`, `assets`. Several packages can each declare "I can be the
 * `session` provider" (a `SeamCandidate`); this module is the one place
 * that decides, from the running environment, which one actually wins.
 *
 * A pure function over data — no cordis, no DOM, no network. `SeamContext`
 * is passed in rather than read off `location.search`, so this is testable
 * headless and usable outside a browser (e.g. from a CLI or the IDE host).
 * Failures are data: `selectProvider` never throws, it returns
 * `provider: null` plus a `Diagnostic` explaining why nothing was chosen.
 *
 * Resolution rule (not derivable from the types, so written out here):
 * candidates split into "specific" (`buildTarget` or `urlParam`) and
 * "default" (`default: true`).
 *   1. Take the specific candidates whose matcher matches `env`. Exactly
 *      one → that's the answer.
 *   2. More than one → ambiguous: no provider, diagnostic naming all of
 *      the matching specific candidates.
 *   3. None matched → fall back to the default candidates, resolved by
 *      the SAME rule (exactly one wins, more than one is ambiguous).
 * `default: true` is never a tiebreak between two defaults — two defaults
 * matching is exactly as ambiguous as two specifics matching.
 *
 * A well-formed matcher declares EXACTLY ONE discriminator: `buildTarget`,
 * `urlParam`, or `default: true`. `SeamMatcher`'s three fields are each
 * independently optional (that is the interface this package is required
 * to implement), so nothing in the type system stops a matcher declaring
 * zero of them (`{}` — can never match, since `matches()` below has no
 * discriminator to test), two of the specific ones at once
 * (`{ buildTarget, urlParam }` — `matches()` would have to silently pick
 * one and ignore the other, which is worse than useless: it reads as
 * "match on either", but only ever checks the first), or a specific one
 * together with `default: true` (`{ buildTarget, default: true }` — the
 * two-phase resolution rule above has no phase where a candidate is both
 * "only counts if buildTarget matches" and "always counts as the
 * fallback"; the two meanings can't coexist on one candidate). All three
 * shapes are illegal, and since the type can't rule any of them out, a
 * diagnostic does: `selectProvider` flags them and excludes them from
 * matching, rather than guessing what the author meant.
 */
import { type Diagnostic, diagnostic } from '@energy8engine/contracts';

export interface SeamMatcher {
  buildTarget?: string;
  urlParam?: string;
  default?: true;
}

export interface SeamCandidate {
  seam: string;
  provider: string;
  matcher: SeamMatcher;
}

export interface SeamContext {
  buildTarget?: string;
  urlParams?: Record<string, string>;
}

/** Renders a matcher the way a diagnostic should show it, e.g. `buildTarget: "stake"`. */
function describeMatcher(matcher: SeamMatcher): string {
  const parts: string[] = [];
  if (matcher.buildTarget !== undefined) parts.push(`buildTarget: "${matcher.buildTarget}"`);
  if (matcher.urlParam !== undefined) parts.push(`urlParam: "${matcher.urlParam}"`);
  if (matcher.default === true) parts.push('default: true');
  return parts.length === 0 ? '{}' : parts.join(', ');
}

/** One candidate, named with its matcher, for a diagnostic listing what was considered. */
function describeCandidate(candidate: SeamCandidate): string {
  return `${candidate.provider} (${describeMatcher(candidate.matcher)})`;
}

/** How many of the two specific discriminators (`buildTarget`, `urlParam`) a matcher sets. */
function specificity(matcher: SeamMatcher): number {
  return (matcher.buildTarget !== undefined ? 1 : 0) + (matcher.urlParam !== undefined ? 1 : 0);
}

/** Which discriminator names a matcher sets, in declaration order — for diagnostics. */
function setDiscriminators(matcher: SeamMatcher): string[] {
  const names: string[] = [];
  if (matcher.buildTarget !== undefined) names.push('buildTarget');
  if (matcher.urlParam !== undefined) names.push('urlParam');
  if (matcher.default === true) names.push('default');
  return names;
}

/** Total discriminators set, counting `default: true` alongside the two specific ones. */
function discriminatorCount(matcher: SeamMatcher): number {
  return specificity(matcher) + (matcher.default === true ? 1 : 0);
}

/**
 * Legal iff EXACTLY ONE discriminator is set. Zero (matches nothing), two
 * specific ones at once (ambiguous which wins), or a specific one paired
 * with `default: true` (the two-phase rule gives that combination no
 * coherent meaning — see the module doc) are all malformed alike.
 */
function isMalformed(matcher: SeamMatcher): boolean {
  return discriminatorCount(matcher) !== 1;
}

function isSpecific(matcher: SeamMatcher): boolean {
  return matcher.buildTarget !== undefined || matcher.urlParam !== undefined;
}

function matches(matcher: SeamMatcher, env: SeamContext): boolean {
  if (matcher.buildTarget !== undefined) return matcher.buildTarget === env.buildTarget;
  if (matcher.urlParam !== undefined) return env.urlParams?.[matcher.urlParam] !== undefined;
  return matcher.default === true;
}

export function selectProvider(
  seam: string,
  candidates: SeamCandidate[],
  env: SeamContext,
): { provider: string | null; diagnostics: Diagnostic[] } {
  const forSeam = candidates.filter((c) => c.seam === seam);

  // Malformed matchers are a declaration bug independent of `env` — flag
  // them unconditionally and drop them from the pool being resolved, so
  // a stray bad candidate can't silently participate as either specific
  // or default (see the module doc for why zero and two discriminators
  // are each illegal).
  const diagnostics: Diagnostic[] = [];
  const wellFormed: SeamCandidate[] = [];
  for (const candidate of forSeam) {
    if (isMalformed(candidate.matcher)) {
      diagnostics.push(
        diagnostic(
          'error',
          seam,
          'seam',
          `provider "${candidate.provider}" for seam "${seam}" has an invalid matcher (${describeMatcher(candidate.matcher)}): ` +
            (discriminatorCount(candidate.matcher) === 0
              ? 'sets none of buildTarget, urlParam, or default: true, so it can never match'
              : `sets ${setDiscriminators(candidate.matcher).join(' and ')} — a matcher must declare exactly one discriminator`),
          'declare exactly one of buildTarget, urlParam, or default: true',
        ),
      );
    } else {
      wellFormed.push(candidate);
    }
  }

  const specific = wellFormed.filter((c) => isSpecific(c.matcher));
  const defaults = wellFormed.filter((c) => !isSpecific(c.matcher));

  const matchedSpecific = specific.filter((c) => matches(c.matcher, env));
  if (matchedSpecific.length === 1) {
    return { provider: matchedSpecific[0].provider, diagnostics };
  }
  if (matchedSpecific.length > 1) {
    diagnostics.push(
      diagnostic(
        'error',
        seam,
        'seam',
        `seam "${seam}" has ${matchedSpecific.length} matching providers: ${matchedSpecific
          .map(describeCandidate)
          .join(', ')} — exactly one must match`,
        `narrow the matchers so only one of these applies to this environment`,
      ),
    );
    return { provider: null, diagnostics };
  }

  const matchedDefault = defaults.filter((c) => matches(c.matcher, env));
  if (matchedDefault.length === 1) {
    return { provider: matchedDefault[0].provider, diagnostics };
  }
  if (matchedDefault.length > 1) {
    diagnostics.push(
      diagnostic(
        'error',
        seam,
        'seam',
        `seam "${seam}" has ${matchedDefault.length} default providers: ${matchedDefault
          .map(describeCandidate)
          .join(', ')} — exactly one must be the default`,
        `mark only one provider "default: true" for this seam`,
      ),
    );
    return { provider: null, diagnostics };
  }

  if (forSeam.length > 0 && wellFormed.length === 0) {
    // Every candidate registered for this seam was malformed — each
    // already has its own "invalid matcher" diagnostic above, pushed in
    // the loop that built `wellFormed`. Re-listing them again here under
    // a generic "nothing matched" message would just be the same
    // complaint twice; there is nothing more to add.
    return { provider: null, diagnostics };
  }

  // Nothing matched at all: list every well-formed candidate that was
  // considered for this seam, and its matcher, so a human can tell "not
  // installed" apart from "installed, but the matcher didn't fire". Any
  // malformed candidate was already reported above and is deliberately
  // left out of this listing — it was never a real contender.
  diagnostics.push(
    diagnostic(
      'error',
      seam,
      'seam',
      forSeam.length === 0
        ? `seam "${seam}" has no registered providers`
        : `seam "${seam}" has no matching provider; candidates considered: ${wellFormed
            .map(describeCandidate)
            .join(', ')}`,
      forSeam.length === 0
        ? `install a provider for seam "${seam}"`
        : `add or adjust a provider's matcher so it matches this environment, or mark one "default: true"`,
    ),
  );
  return { provider: null, diagnostics };
}
