/**
 * The form the IDE draws for the `playloop1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else — `./runtime` pulls in
 * cordis and the composition's services. The row is `hot: false`, so an
 * edit here restarts the game.
 */
import Schema from 'schemastery';

export const Config = Schema.object({
  skipEvents: Schema.array(String)
    .default(['ui.skip'])
    .description('flow-bus events that collapse the running presentation'),
  pendingMs: Schema.natural()
    .default(30000)
    .description('how long a plan waits at its end on its wait: false steps before reporting them and moving on (ms, 0 = forever)'),
});
