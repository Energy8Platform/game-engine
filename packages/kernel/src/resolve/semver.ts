/**
 * The smallest semver that does this job. The kernel takes no dependencies, and plugin ranges only
 * ever need four forms. Anything else is reported invalid rather than quietly accepted — a range
 * nobody can evaluate is worse than one that is refused with a message.
 *
 * Pre-release and build metadata are deliberately unsupported.
 */

export type Version = [number, number, number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const RANGE = /^(\^|~|>=)?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v: string): Version | null {
  if (typeof v !== 'string') return null;
  const m = VERSION.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isValidRange(range: string): boolean {
  if (typeof range !== 'string') return false;
  return range === '*' || RANGE.test(range);
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function satisfies(version: string, range: string): boolean {
  if (typeof version !== 'string' || typeof range !== 'string') return false;
  if (range === '*') return parseVersion(version) !== null;

  const v = parseVersion(version);
  const m = RANGE.exec(range);
  if (!v || !m) return false;

  const operator = m[1] ?? '';
  const target: Version = [Number(m[2]), Number(m[3]), Number(m[4])];

  switch (operator) {
    case '':
      return compare(v, target) === 0;
    case '>=':
      return compare(v, target) >= 0;
    case '~':
      // Patch-level changes only.
      return v[0] === target[0] && v[1] === target[1] && compare(v, target) >= 0;
    case '^':
      // Minor and patch, except below 1.0.0 where npm treats the minor as the breaking digit.
      if (compare(v, target) < 0) return false;
      return target[0] === 0 ? v[0] === 0 && v[1] === target[1] : v[0] === target[0];
    default:
      return false;
  }
}
