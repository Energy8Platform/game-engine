export * from './context';
export * from './plugins/connection';
// Not `export *`: both plugin modules follow the cordis convention of
// exporting top-level `name` and `apply` for `ctx.plugin(module)`, and a
// second wildcard export of those would collide with connection's (TS2308).
// `context.ts` already consumes `name`/`apply` directly via a namespace
// import, so the barrel only needs to re-export the public surface a
// slot-consuming component actually uses.
export { useSlot, type SlotMeta, type SlotEntry, type SlotsService } from './plugins/slots';
