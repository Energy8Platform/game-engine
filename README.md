# Energy8 game engine — monorepo

This repository hosts two npm packages that together form the Energy8 platform's game-development stack:

| Package | What it is | Use it when |
| --- | --- | --- |
| [`@energy8platform/platform-core`](packages/platform-core/README.md) | Renderer-agnostic platform core: SDK session orchestration, Lua engine, RTP simulation CLI, DevBridge mock host, branded CSS preloader, Vite plugins. **No pixi / phaser / DOM-rendering deps.** | Building on Phaser, Three.js, Babylon, custom WebGL, or any non-pixi engine — and want the Energy8 platform contract for free. |
| [`@energy8platform/game-engine`](packages/game-engine/README.md) | PixiJS v8 game engine on top of `platform-core`: scenes, viewport scaling, FlexContainer-based UI, animation, audio, input, React reconciler. | Building a Pixi-based slot / casino game — full batteries-included experience. |

`game-engine` depends on `platform-core` and re-exports its public modules through the existing sub-path imports (`/lua`, `/debug`, `/vite`), so games already on `game-engine` keep working without any code change.

---

## Repo layout

```
game-engine/                          ← repo root (this file)
├── package.json                      { "private": true, "workspaces": ["packages/*"] }
├── tsconfig.base.json                shared TS compiler options
├── packages/
│   ├── platform-core/                @energy8platform/platform-core
│   └── game-engine/                  @energy8platform/game-engine
└── examples/                         runnable sample games
```

## Commands

All commands run from the repo root and operate on both workspaces.

```bash
npm install                # install + symlink workspace packages
npm run build              # build both packages (Rollup)
npm run dev                # watch mode (game-engine)
npm test                   # vitest run on both workspaces
npm run typecheck          # tsc --noEmit on both
npm run lint               # ESLint on both

# workspace-scoped
npm run build --workspace @energy8platform/platform-core
npm test --workspace @energy8platform/game-engine

# RTP simulation (binary lives in platform-core)
npm run simulate --workspace @energy8platform/platform-core -- --config dev.config.ts --iterations 1000000
```

---

## Choosing a package

**You're shipping a game on the Energy8 platform with PixiJS** → install [`@energy8platform/game-engine`](packages/game-engine/README.md). `platform-core` comes in as a transitive dep automatically.

**You want to ship on Phaser / Three.js / your own renderer** → install [`@energy8platform/platform-core`](packages/platform-core/README.md) directly. You get the SDK lifecycle, Lua engine, simulation CLI, DevBridge mock host, and the branded CSS preloader without a kilobyte of pixi.

---

## License

MIT
