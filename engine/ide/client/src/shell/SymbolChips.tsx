import type { ChangeEvent } from 'react';
import type { FieldProps } from '../schema-form/fields';

/**
 * A `fieldOverrides` entry for a `string[]` field whose values are (meant
 * to be) the project's symbol ids — `anticipation1`'s `triggerSymbols`,
 * `reels1`'s `win.frameShake.onlyOnSymbols` once switched on (see
 * `ReelsDocument`). Draws the current value as one removable chip per id,
 * plus an `<select>` of the known ids not yet chosen — picking one appends.
 * A chip whose id isn't among `known` (a symbol renamed or deleted after
 * the field was set, or hand-authored bundle YAML) still draws — the value
 * is not silently dropped — but is marked `e8-chip-unknown` with a title
 * explaining why, same "don't corrupt, flag it" rule `fields.tsx`'s own
 * unparsable-draft handling follows.
 *
 * `FieldProps`' `id`/`node`/`commit`/`ariaLabel`/`describedBy`/`path` ride
 * along unused: `triggerSymbols`/`onlyOnSymbols` are both `array` nodes,
 * which `ObjectFields` already wraps in its own `<fieldset><legend>` (no
 * `<label for>` this component needs to be the target of), and the
 * override is reached before any node-specific rendering — see `Field`.
 */
export function SymbolChips({
  value,
  onChange,
  known,
}: FieldProps & { known: readonly { id: string; name: string }[] }) {
  const list = Array.isArray(value) ? (value as string[]) : [];
  const knownIds = new Set(known.map((s) => s.id));
  const remaining = known.filter((s) => !list.includes(s.id));

  const add = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) onChange([...list, id]);
  };

  return (
    <span className="e8-chips">
      {list.map((id) => (
        <span
          key={id}
          className={`e8-chip${knownIds.has(id) ? '' : ' e8-chip-unknown'}`}
          data-testid={`symbol-chip-${id}`}
          title={knownIds.has(id) ? undefined : 'not a symbol of this project'}
        >
          {id}
          <button
            type="button"
            className="e8-chip-remove"
            aria-label={`remove ${id}`}
            onClick={() => onChange(list.filter((existing) => existing !== id))}
          >
            ×
          </button>
        </span>
      ))}
      {/* Fully controlled to a constant `""`: after `add` fires, the picked
          id disappears from `remaining` on the next render regardless, and
          holding this at `""` means the select shows its placeholder again
          right away rather than needing a separate reset. */}
      <select data-testid="symbol-chips-add" aria-label="add symbol" value="" onChange={add}>
        <option value="" />
        {remaining.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id}
          </option>
        ))}
      </select>
    </span>
  );
}
