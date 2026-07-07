# Energy8 game engine — monorepo

This repository hosts the npm packages that together form the Energy8 platform's game-development stack:

| Package | What it is | Use it when |
| --- | --- | --- |
| [`@energy8platform/platform-core`](packages/platform-core/README.md) | Renderer-agnostic platform core: SDK session orchestration, the SpinML math runtime (`e8` engine binaries + Vite `spinPlugin`), game-spec derivation, RTP simulation CLI, DevBridge mock host, branded CSS preloader. **No pixi / phaser / DOM-rendering deps.** | Building on Phaser, Three.js, Babylon, custom WebGL, or any non-pixi engine — and want the Energy8 platform contract for free. |
| [`@energy8platform/game-engine`](packages/game-engine/README.md) | PixiJS v8 game engine on top of `platform-core`: scenes, viewport scaling, FlexContainer-based UI, animation, audio, input, React reconciler. | Building a Pixi-based slot / casino game — full batteries-included experience. |
| [`@energy8platform/create-slot`](packages/create-slot) | Scaffolder: `npm create @energy8platform/slot` generates a complete slot project (spec, `.spin` math, scenes, math pipeline). | Starting a new game. |
| [`@energy8platform/stake-math-tools`](packages/stake-math-tools) | Book-bundle pipeline: `e8-math` sim → pool → curate → publishable Stake books. | Producing/tuning the RGS math for a game. |
| [`@energy8platform/stake-kit`](packages/stake-kit) | Stake dev harness (local RGS emulation, book replay). | Testing Stake builds locally. |

`game-engine` depends on `platform-core` and re-exports its public modules through the existing sub-path imports (`/debug`, `/vite`, legacy `/lua` types), so games already on `game-engine` keep working without any code change.

## Game math: SpinML

Game logic is written in **SpinML** (`.spin`) — a statically-typed, Lua-flavored
DSL JIT-compiled to native code by the `e8` engine. The engine binaries are
downloaded by `platform-core`'s postinstall from this repo's GitHub Releases
(tag `e8-v<version>`); engine sources live in the private casino-platform repo.

- **Language guide**: [docs/spinml.md](docs/spinml.md)
- **Migrating a Lua game**: [docs/lua-to-spin-migration.md](docs/lua-to-spin-migration.md)
- **Platform contract** (config, actions, deploy): [game_development_guide.md](game_development_guide.md)

Legacy fengari/Lua games: stay on published `platform-core ≤ 0.28.x` /
`game-engine ≤ 0.27.x` / `stake-math-tools ≤ 0.8.x`; upgrading means porting.

---

## Repo layout

```
game-engine/                          ← repo root (this file)
├── package.json                      { "private": true, "workspaces": ["packages/*"] }
├── tsconfig.base.json                shared TS compiler options
├── docs/                             SpinML language guide, migration playbook
├── packages/
│   ├── platform-core/                @energy8platform/platform-core
│   ├── game-engine/                  @energy8platform/game-engine
│   ├── create-slot/                  @energy8platform/create-slot
│   ├── stake-math-tools/             @energy8platform/stake-math-tools
│   ├── stake-kit/                    @energy8platform/stake-kit
│   └── …                             game-sdk, shell, stake-bridge, harness
└── examples/                         runnable sample games
```

## Commands

All commands run from the repo root and operate on all workspaces.

```bash
npm install                # install + symlink workspace packages
npm run build              # build packages (Rollup)
npm run dev                # watch mode (game-engine)
npm test                   # vitest run on all workspaces
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint

# workspace-scoped
npm run build --workspace @energy8platform/platform-core
npm test --workspace @energy8platform/game-engine

# RTP simulation (e8 binary lives in platform-core)
npm run simulate --workspace @energy8platform/platform-core -- --config dev.config.ts --iterations 1000000
```

---

## Choosing a package

**You're shipping a game on the Energy8 platform with PixiJS** → install [`@energy8platform/game-engine`](packages/game-engine/README.md). `platform-core` comes in as a transitive dep automatically.

**You want to ship on Phaser / Three.js / your own renderer** → install [`@energy8platform/platform-core`](packages/platform-core/README.md) directly. You get the SDK lifecycle, the SpinML math runtime, simulation CLI, DevBridge mock host, and the branded CSS preloader without a kilobyte of pixi.

---

## License

MIT
