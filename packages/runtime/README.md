# @energy8engine/runtime

Turns a game's plugin plan into a live session. Built on [`@energy8engine/kernel`](../kernel),
which knows how plugins compose; this package knows what a slot game needs composed.

## The one idea

A **session provider does not return a session.** Every backend here — the dev mock host, Stake,
a replay source — installs itself on the same in-process SDK channel, and then ONE handshake talks
to whatever installed itself. So a provider's job is: put your backend on the channel, hand back a
disposer.

```ts
import { runGame } from '@energy8engine/runtime';
import { project, manifests } from 'virtual:e8-project';

const { session, diagnostics, dispose } = await runGame({
  project,
  manifests,
  url: location.href,
  buildTarget: import.meta.env.BUILD_TARGET,
});

if (diagnostics.some((d) => d.severity === 'error')) showErrorScreen(diagnostics);
```

`runGame` never rejects. A malformed project, a plugin that will not load, a backend whose
installation throws — each arrives as a diagnostic on the returned value.

## Writing your own provider

Put it in your project's `plugins/` folder and list it in `project.json`. Nothing in the engine
changes.

```ts
import { definePlugin } from '@energy8engine/kernel';
import { POINT_SESSION_PROVIDER, provider } from '@energy8engine/runtime';
import { install } from './install';

export default definePlugin({
  id: 'acme-session-replay',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  contributes: {
    'session.provider': [
      {
        id: 'replay',
        schema: { bookFile: { kind: 'asset', label: 'Recorded books', default: 'books/rounds.jsonl' } },
        activateWhen: { urlParam: 'replay' },
        doc: 'Serves rounds from a recorded dump instead of a live backend.',
        // `provider(...)` bridges two contracts: the kernel's create() resolves to a FACTORY
        // (settings -> instance), and our instance is the installer function itself.
        create: async () => provider(install),
      },
    ],
  },
});
```

`activateWhen` is declarative on purpose: the IDE reads `activationLabel` off the resolved plan and
tells a person *when* each provider takes over, without running any of them.

## Getting `project.json` into a bundle

A browser bundle cannot read a file off disk, so the Vite plugin turns the project into a module
with static imports a bundler can see:

```ts
// vite.config.ts
import { projectPlugin } from '@energy8engine/runtime/vite';
export default { plugins: [projectPlugin()] };
```

## Optional peers

`@energy8platform/platform-core` and `@energy8platform/stake-bridge` are **optional** peer
dependencies, reached only through dynamic `import()` inside a provider. A game that never ships to
Stake builds fine without `stake-bridge` installed.

## Tests

```bash
npm test --workspace @energy8engine/runtime
```

Run it with that exact command — `npx vitest run <path>` from the repo root reports false failures
under this workspace layout. Every test in this package runs in Node; nothing here needs a browser.
