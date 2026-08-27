/**
 * The browser half. The host serves this file byte-for-byte from disk at
 * `GET /plugin-client/:id` (see `engine/ide/host/src/plugins/client-assets.ts`)
 * and the browser runs it as a real ES module via a native `import()` —
 * nothing transpiles it. That means:
 *
 *   - No JSX and no TypeScript syntax here — both are a `SyntaxError` in a
 *     browser with no build step in front of it. Use `React.createElement`
 *     directly instead of `<jsx />`.
 *   - No bare specifiers like `import React from 'react'` — the browser has
 *     no import map and no bundler to resolve them, so that import throws
 *     at parse time. React is not shipped per plugin either: bundling it
 *     into every plugin would load several copies of React at once and
 *     break hooks (they rely on exactly one module instance).
 *
 * Instead, the IDE shell publishes the one React it runs on as a global
 * before it boots its client context: `globalThis.__E8_IDE__ = { React }`
 * (see `engine/apps/web/src/main.tsx`). Every client half reads React from
 * there, so the whole IDE — shell and every plugin's card — shares one
 * instance.
 */
const { React } = globalThis.__E8_IDE__;

/**
 * `apply(ctx)` is called once this module has been imported. The IDE shell
 * never had to know this plugin exists: it only knows the `composition.card`
 * slot, and this plugin is the one deciding what goes into it.
 */
export function apply(ctx) {
  ctx.slots.register({ name: 'composition.card', key: 'probe' }, () =>
    React.createElement(
      'aside',
      { className: 'e8-card' },
      React.createElement('h2', null, 'Проба'),
      React.createElement('p', null, 'Эта карточка пришла из плагина, а не из оболочки.'),
    ),
  );
}
