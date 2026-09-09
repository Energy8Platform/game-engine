// Fixture for `composition.test.ts`'s "a client-only row with no importable
// main produces no schema diagnostic" — the shape `screen-demo` has
// (task 7, "a screen is a plugin"): a package.json declaring `e8.client`
// and nothing else, with no `main` and no `"."` export. Never actually
// served or imported by this test; only its package.json's shape matters.
export function apply() {}
