// Fixture for `composition.test.ts`'s "a hoisted client-only row with an
// exports map and no '.' key produces no schema diagnostic" (task 7, "a
// screen is a plugin", fix round 3). Never actually served or imported by
// that test; only this package's manifest shape matters — a real
// `node_modules` entry (via `file:./tests/fixtures/client-only-hoisted` in
// this workspace's own package.json) whose `exports` map has no `"."` key,
// the hoisted twin of `plugins/client-only`'s project-local shape.
export function apply() {}
