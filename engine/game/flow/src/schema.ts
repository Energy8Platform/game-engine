/**
 * The form the IDE draws for the `flow1` row — `e8.runtime.schema` in this
 * package's manifest. Imported by the IDE HOST (a node process), so this
 * module imports `schemastery` and nothing else — `./runtime` pulls in
 * `cordis` and the flow package's own services. The row is `hot: true`:
 * unlike `scenes` this package has no settings at all — the document set,
 * the node kinds and the trace all live on the wire, not in a config a
 * human fills in here.
 */
import Schema from 'schemastery';

export const Config = Schema.object({});
