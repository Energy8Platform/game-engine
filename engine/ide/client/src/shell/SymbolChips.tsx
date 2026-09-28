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
 * `FieldProps`' `id`/`commit`/`ariaLabel`/`describedBy`/`path` ride
 * along unused (`node` only for its default): `triggerSymbols`/`onlyOnSymbols` are both `array` nodes,
 * which `ObjectFields` already wraps in its own `<fieldset><legend>` (no
 * `<label for>` this component needs to be the target of), and the
 * override is reached before any node-specific rendering — see `Field`.
 *
 * Keyed and removed by POSITION, not by id: `triggerSymbols`/`onlyOnSymbols`
 * are plain string arrays, and nothing stops the same symbol id appearing
 * twice (hand-authored YAML, or two separate adds before a write lands).
 * Keying by id would hand React two chips with the same key (React warns
 * and may drop/duplicate one), and removing by VALUE (`!== id`) would
 * delete every matching entry at once instead of just the one clicked —
 * both chips still share `data-testid`/`aria-label` (the id is what a
 * sighted or assistive reading of the chip actually says), so a test
 * reaching for "the first one" uses `getAllBy…()[0]`, same as a real user
 * clicking the chip they can see.
 */
export function SymbolChips({
  value,
  node,
  onChange,
  known,
}: FieldProps & { known: readonly { id: string; name: string }[] }) {
  // An override gets the RAW value (see `SchemaForm.fieldOverrides`): an
  // unset field shows — and an add builds on — the schema default, which is
  // what the row actually runs with.
  const current = value ?? node.meta?.default;
  const list = Array.isArray(current) ? (current as string[]) : [];
  const knownIds = new Set(known.map((s) => s.id));
  const remaining = known.filter((s) => !list.includes(s.id));

  const add = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) onChange([...list, id]);
  };

  return (
    <span className="e8-chips">
      {list.map((id, index) => (
        <span
          key={index}
          className={`e8-chip${knownIds.has(id) ? '' : ' e8-chip-unknown'}`}
          data-testid={`symbol-chip-${id}`}
          title={knownIds.has(id) ? undefined : 'not a symbol of this project'}
        >
          {id}
          <button
            type="button"
            className="e8-chip-remove"
            aria-label={`remove ${id}`}
            onClick={() => onChange(list.filter((_, i) => i !== index))}
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
