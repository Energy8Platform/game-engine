// What `src/main.ts` reads that no package declares: the row map `e8 build`
// bundles (`@energy8engine/ide-host`'s `vite-rows.ts` — `{}` under `e8 dev`)
// and the build target it bakes in. `import.meta.env` itself comes from
// `vite/client` (tsconfig `types`); this only adds one field to it.
declare module 'virtual:e8-rows' {
  export const rows: Record<string, () => Promise<unknown>>;
}

interface ImportMetaEnv {
  /** `e8 build --target <name>` — `createGame`'s `buildTarget`; unset under `e8 dev`. */
  readonly E8_TARGET?: string;
}
