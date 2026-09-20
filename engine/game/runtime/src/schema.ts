/**
 * The form the IDE draws for the `mechanics1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else. `stages` binds a
 * stage id to a mechanic id (`MechanicsService.bind`); a binding to a
 * mechanic no row has registered yet is legal, so the value is any string.
 */
import Schema from 'schemastery';

export const Config = Schema.object({
  stages: Schema.dict(Schema.string()).description('stage id → mechanic id'),
  tumble: Schema.boolean()
    .default(false)
    .description('a cascade presents tumbles (gravity + refill) instead of remove + refill'),
});
