import type { PluginManifest, PointDef, Schema } from '@energy8engine/kernel';

/** Where rounds come from. Exactly one provider is active per launch. */
export const POINT_SESSION_PROVIDER = 'session.provider';

/** Build-time targets — a Vite plugin, an output bundle, a deploy artifact. Several may apply. */
export const POINT_BUILD_TARGET = 'build.target';

/**
 * The game-domain hook vocabulary.
 *
 * The kernel takes this list from a caller rather than owning it, because naming `beforeSpin`
 * inside a package that must know nothing about slots would be exactly the leak it was built to
 * avoid. This file is that caller.
 */
export const HOOK_IDS = ['bootstrap', 'dispose', 'beforeSpin', 'afterSpin', 'beforeRender'] as const;

export type HookId = (typeof HOOK_IDS)[number];

/**
 * Settings every session provider shares. A provider adds its own fields on top; the kernel
 * merges the two into the effective schema the IDE renders.
 *
 * Note what is NOT here: `enabled`. That is the structural flag on the contribution in
 * project.json, and a schema field of the same name silently shadows it.
 */
export const SESSION_PROVIDER_SCHEMA: Schema = {
  label: {
    kind: 'text',
    label: 'Display name',
    doc: 'Shown in the IDE when this provider is the active one.',
    default: '',
  },
};

const SESSION_PROVIDER_POINT: PointDef = {
  phase: 'runtime',
  arity: 'one',
  schema: SESSION_PROVIDER_SCHEMA,
  doc:
    'A backend that installs itself on the in-process SDK channel before the handshake. ' +
    'DevBridge, Stake and a replay source are all providers. Exactly one wins per launch, ' +
    'chosen by its activateWhen matcher.',
};

const BUILD_TARGET_POINT: PointDef = {
  phase: 'build',
  arity: 'many',
  schema: {
    outDir: {
      kind: 'text',
      label: 'Output directory',
      doc: 'Where this target writes its bundle, relative to the project root.',
      default: 'dist',
    },
  },
  doc: 'A build-time target: a Vite plugin, an output bundle, a deployable artifact.',
};

/**
 * The built-in plugin. It declares the two points that more than one plugin fills — someone has
 * to own a shared door — and contributes nothing of its own. Points filled by exactly one plugin
 * (a renderer, a shell) are declared by that plugin instead, which is why they are absent here.
 */
export const hostPlugin: PluginManifest = {
  id: '@e8/host',
  version: '0.1.0',
  engine: '^0.1.0',
  points: {
    [POINT_SESSION_PROVIDER]: SESSION_PROVIDER_POINT,
    [POINT_BUILD_TARGET]: BUILD_TARGET_POINT,
  },
} satisfies PluginManifest;
