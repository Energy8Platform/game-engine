import { type Diagnostic, diagnostic } from './diagnostic';
import type { PresentationPlan } from './presentation';

/**
 * A stage field's shape, not its meaning. Kept to exactly the three kinds
 * the measured math result actually produces (see the module doc below) —
 * do not add a fourth speculatively; let the mechanic that needs one force
 * the addition.
 */
export type FieldKind = 'number' | 'grid' | 'list';

/**
 * What one mechanic needs from a stage's spin data before it can run, e.g.
 * `classic` needs `{ grid: 'grid', lines: 'list' }` and `cascade` needs
 * `{ cascade_history: 'list' }`. `checkShape` compares this against a
 * sample of the actual measured shape.
 */
export interface SpinShapeRequirement {
  fields: Record<string, FieldKind>;
}

/**
 * A mechanic as the board runs it: it turns one stage's spin data into a
 * `PresentationPlan` (the board's step vocabulary — see `presentation.ts`),
 * and it declares up front what that stage's data must contain via
 * `requires`, so `checkShape` can catch a mismatch before the player ever
 * clicks spin instead of leaving a blank board after.
 */
export interface SpinMechanic {
  id: string;
  requires: SpinShapeRequirement;
  present(data: unknown): PresentationPlan;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isGrid(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((cell) => isFiniteNumber(cell)))
  );
}

function isNonEmptyList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function matchesKind(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case 'number':
      return isFiniteNumber(value);
    case 'grid':
      return isGrid(value);
    case 'list':
      return isNonEmptyList(value);
  }
}

/**
 * Checks a stage's requirement against a sample of the measured spin data,
 * this is the pre-flight §7.1 refers to as "`expects` checked before run":
 * a mechanic declares the fields it needs, and a mismatch becomes a
 * `Diagnostic` naming the mechanic, the stage and the field — not a blank
 * board discovered after the player clicks spin.
 *
 * Reports every mismatched field, not just the first, so the composition
 * screen shows the whole gap in one pass.
 */
export function checkShape(
  req: SpinShapeRequirement,
  sample: Record<string, unknown>,
  mechanicId: string,
  stage: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [field, kind] of Object.entries(req.fields)) {
    if (!(field in sample)) {
      diagnostics.push(
        diagnostic(
          'error',
          mechanicId,
          stage,
          `mechanic "${mechanicId}" needs field "${field}" (${kind}) on stage "${stage}", but it is missing`,
        ),
      );
      continue;
    }

    const value = sample[field];
    if (!matchesKind(kind, value)) {
      diagnostics.push(
        diagnostic(
          'error',
          mechanicId,
          stage,
          `mechanic "${mechanicId}" needs field "${field}" to be a ${kind} on stage "${stage}", but it is not`,
        ),
      );
    }
  }

  return diagnostics;
}
