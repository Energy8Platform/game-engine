export * from './context';
export * from './plugins/connection';
// Not `export *`: every plugin module follows the cordis convention of
// exporting top-level `name` and `apply` for `ctx.plugin(module)`, and a
// second (or third) wildcard export of those would collide with
// connection's (TS2308) — exactly as it did for slots in Task 9.
// `context.ts` already consumes `name`/`apply` directly via a namespace
// import, so the barrel only needs to re-export the public surface a
// consumer actually uses.
export { useSlot, type SlotMeta, type SlotEntry, type SlotsService } from './plugins/slots';
export type { ModulesService, ModulesConfig } from './plugins/modules';
