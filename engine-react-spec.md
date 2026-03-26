# ТЗ: Интеграция @pixi/react + @pixi/layout в @energy8platform/game-engine

## Контекст

Движок (@energy8platform/game-engine) — чисто императивный PixiJS + TypeScript.
React нигде не присутствует: ни в dependencies, ни в коде. `@pixi/layout` есть как
optional peer dependency — используется в `Layout`, `Panel`, `Modal`.

Задача — дать разработчикам игр возможность писать UI декларативно через @pixi/react
+ @pixi/layout, сохраняя весь lifecycle движка (загрузка, SDK, сцены, viewport scaling).

---

## Проблема: почему нельзя просто использовать @pixi/react

`@pixi/react` v8.0.5:
- `createRoot(target)` принимает ТОЛЬКО `HTMLElement | HTMLCanvasElement`
- Всегда создаёт **свой** `new Application()` внутри
- Нет способа рендерить в существующий PixiJS Container или Application
- Reconciler есть, но не экспортируется публично (`lib/core/reconciler.js`)
- `<Application>` компонент всегда рендерит свой `<canvas>` в DOM

`@pixi/layout` v3.2.0:
- Уже есть React-интеграция: `@pixi/layout/react` добавляет типы для JSX
- `layoutContainer`, `layoutSprite`, `layoutText` и др. — готовые элементы
- Инициализация через side-effect import (`import '@pixi/layout'`)
- Yoga загружается автоматически при инициализации renderer

Движок:
- `Scene.container` — обычный `Container`, не DOM-элемент
- `GameApplication` создаёт свой `Application`, управляет stage
- `ViewportManager` рассчитывает scale/offset для canvas — React overlay должен точно совпадать

---

## Решение: два этапа

### Этап 1 — `createPixiRoot()` (обёртка над reconciler)

Минимальный адаптер, который рендерит React-дерево в любой PixiJS Container,
используя reconciler из @pixi/react напрямую.

### Этап 2 — `ReactScene` (Scene с React рендерингом)

Базовый класс Scene, который автоматически монтирует React-дерево и прокидывает
контекст движка (SDK, Audio, Input, Viewport) в React-компоненты через хуки.

---

## Этап 1: `createPixiRoot()`

### Задача

Создать функцию `createPixiRoot(container: Container)` которая:
1. Использует reconciler из `@pixi/react` для рендеринга React-дерева
2. Рендерит прямо в переданный PixiJS `Container` (не создаёт свой Application)
3. Возвращает объект `{ render(element), unmount() }`

### Файлы

```
src/react/
├── index.ts              # Публичный экспорт: createPixiRoot, ReactScene, хуки
├── createPixiRoot.ts     # Адаптер reconciler → Container
├── EngineContext.ts       # React Context для движка
└── hooks.ts              # useSDK, useAudio, useInput, useViewport, useEngine
```

### API

```typescript
// src/react/createPixiRoot.ts
import type { Container } from 'pixi.js';

interface PixiRoot {
  render(element: React.ReactElement): void;
  unmount(): void;
}

/**
 * Создаёт React root, который рендерит в существующий PixiJS Container.
 * НЕ создаёт свой Application — использует reconciler напрямую.
 */
export function createPixiRoot(container: Container): PixiRoot;
```

### Реализация

```typescript
// createPixiRoot.ts
import { ConcurrentRoot } from 'react-reconciler/constants';

// Deep import reconciler — это единственный способ получить его
// @pixi/react не экспортирует публично, но модуль доступен
import { reconciler } from '@pixi/react/lib/core/reconciler';
import { prepareInstance } from '@pixi/react/lib/helpers/prepareInstance';

export function createPixiRoot(container: Container): PixiRoot {
  const rootContainer = prepareInstance(container);

  const fiberRoot = reconciler.createContainer(
    rootContainer,     // containerInfo
    ConcurrentRoot,    // tag
    null,              // hydrationCallbacks
    false,             // isStrictMode
    null,              // concurrentUpdatesByDefaultOverride
    '',                // identifierPrefix
    (err) => console.error('[ReactScene]', err), // onUncaughtError
    (err) => console.error('[ReactScene]', err), // onCaughtError
    null,              // onRecoverableError
    null,              // transitionCallbacks
  );

  return {
    render(element: React.ReactElement) {
      reconciler.updateContainer(element, fiberRoot, null, () => {});
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, () => {});
    },
  };
}
```

### Риск: deep import `@pixi/react/lib/core/reconciler`

Это приватный путь. Варианты:
1. **Deep import** — работает, но может сломаться при обновлении @pixi/react
2. **Свой reconciler** — форкнуть конфиг reconciler из @pixi/react (50 строк),
   не зависеть от внутренностей
3. **PR в @pixi/react** — предложить экспортировать reconciler или добавить
   `createRoot` с поддержкой Container

**Рекомендация:** начать с (1) deep import, параллельно сделать (3) PR.
Если deep import ломается — переключиться на (2) свой reconciler.

Конфиг reconciler в @pixi/react простой (~80 строк): createElement = new Class(),
appendChild = container.addChild(), removeChild = container.removeChild() + destroy(),
commitUpdate = applyProps(). Можно скопировать.

### Альтернатива: свой reconciler (без зависимости от приватного API)

```typescript
// src/react/reconciler.ts
import Reconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants';
import { Container } from 'pixi.js';
import { applyProps, extend, catalogue } from './pixiElements';

const reconciler = Reconciler({
  isPrimaryRenderer: false,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,

  createInstance(type, props) {
    const Ctor = catalogue[pascalCase(type)];
    if (!Ctor) throw new Error(`Unknown element: ${type}. Call extend() first.`);
    const instance = new Ctor();
    applyProps(instance, {}, props);
    return instance;
  },

  createTextInstance() {
    throw new Error('Text nodes not supported. Use <text> element.');
  },

  appendInitialChild(parent, child) {
    if (child instanceof Container) parent.addChild(child);
  },

  appendChild(parent, child) {
    if (child instanceof Container) parent.addChild(child);
  },

  removeChild(parent, child) {
    if (child instanceof Container) {
      parent.removeChild(child);
      child.destroy({ children: true });
    }
  },

  insertBefore(parent, child, beforeChild) {
    if (child instanceof Container && beforeChild instanceof Container) {
      const index = parent.getChildIndex(beforeChild);
      parent.addChildAt(child, index);
    }
  },

  commitUpdate(instance, type, oldProps, newProps) {
    applyProps(instance, oldProps, newProps);
  },

  // ... остальные обязательные методы reconciler (no-op)
});
```

**Плюс:** нет зависимости от приватного API @pixi/react
**Минус:** ~150 строк кода, нужно поддерживать sync с PixiJS Container API

### Зависимости для engine

```json
// package.json — добавить в peerDependencies (optional)
{
  "peerDependencies": {
    "react": ">=19.0.0",
    "react-dom": ">=19.0.0",
    "@pixi/react": "^8.0.0",
    "react-reconciler": "^0.31.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true },
    "@pixi/react": { "optional": true },
    "react-reconciler": { "optional": true }
  }
}
```

---

## Этап 2: `ReactScene` + Engine Context

### Задача

Базовый класс Scene, который:
1. В `onEnter()` монтирует React-дерево в `this.container` через `createPixiRoot()`
2. Прокидывает контекст движка через React Context
3. Предоставляет хуки: `useSDK()`, `useAudio()`, `useInput()`, `useViewport()`
4. В `onExit()` автоматически анмаунтит React-дерево
5. В `onResize()` обновляет viewport контекст → React-дерево ре-рендерится

### Engine Context

```typescript
// src/react/EngineContext.ts
import { createContext, useContext } from 'react';
import type { CasinoGameSDK, PlayResultData, SessionData } from '@energy8platform/game-sdk';
import type { AudioManager } from '../audio/AudioManager';
import type { InputManager } from '../input/InputManager';
import type { ViewportManager } from '../viewport/ViewportManager';
import type { GameApplication } from '../core/GameApplication';

export interface EngineContextValue {
  app: GameApplication;
  sdk: CasinoGameSDK | null;
  audio: AudioManager;
  input: InputManager;
  viewport: ViewportManager;
  /** Game-specific config from SDK/DevBridge */
  gameConfig: Record<string, unknown> | null;
  /** Current screen dimensions in design units */
  screen: { width: number; height: number; scale: number };
  /** Current orientation */
  isPortrait: boolean;
}

export const EngineContext = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine() must be used inside ReactScene');
  return ctx;
}
```

### Хуки

```typescript
// src/react/hooks.ts
export function useSDK(): CasinoGameSDK | null {
  return useEngine().sdk;
}

export function useAudio(): AudioManager {
  return useEngine().audio;
}

export function useInput(): InputManager {
  return useEngine().input;
}

export function useViewport(): { width: number; height: number; scale: number; isPortrait: boolean } {
  const { screen, isPortrait } = useEngine();
  return { ...screen, isPortrait };
}

export function useBalance(): number {
  const sdk = useSDK();
  const [balance, setBalance] = useState(sdk?.balance ?? 0);

  useEffect(() => {
    if (!sdk) return;
    const handler = ({ balance }: { balance: number }) => setBalance(balance);
    sdk.on('balanceUpdate', handler);
    return () => sdk.off('balanceUpdate', handler);
  }, [sdk]);

  return balance;
}

export function useSession(): SessionData | null {
  const sdk = useSDK();
  return sdk?.session ?? null;
}

export function useGameConfig<T = Record<string, unknown>>(): T | null {
  return useEngine().gameConfig as T | null;
}
```

### ReactScene

```typescript
// src/react/ReactScene.ts
import { Scene } from '../core/Scene';
import { EngineContext, type EngineContextValue } from './EngineContext';
import { createPixiRoot, type PixiRoot } from './createPixiRoot';

export abstract class ReactScene extends Scene {
  private pixiRoot: PixiRoot | null = null;
  private contextValue: EngineContextValue | null = null;

  /**
   * Implement this to return the React element tree for the scene.
   * Called on mount and re-called on resize.
   */
  abstract render(): React.ReactElement;

  async onEnter(data?: unknown) {
    const app = this.getGameApplication(); // нужен метод доступа — см. ниже

    this.contextValue = {
      app,
      sdk: app.sdk,
      audio: app.audio,
      input: app.input,
      viewport: app.viewport,
      gameConfig: app.gameConfig,
      screen: {
        width: app.viewport.width,
        height: app.viewport.height,
        scale: app.viewport.scale,
      },
      isPortrait: app.viewport.orientation === 'portrait',
    };

    // Import @pixi/layout side-effect (applies mixins)
    await import('@pixi/layout');

    // Create React root in scene container
    this.pixiRoot = createPixiRoot(this.container);
    this.mountReactTree();
  }

  async onExit() {
    this.pixiRoot?.unmount();
    this.pixiRoot = null;
  }

  onResize(width: number, height: number) {
    if (!this.contextValue) return;

    // Update context with new dimensions
    this.contextValue = {
      ...this.contextValue,
      screen: {
        width,
        height,
        scale: this.contextValue.app.viewport.scale,
      },
      isPortrait: height > width,
    };

    // Re-render React tree with updated context
    this.mountReactTree();
  }

  private mountReactTree() {
    if (!this.pixiRoot || !this.contextValue) return;

    // @pixi/layout/react elements require extend()
    // Автоматически регистрируем layout-компоненты
    this.pixiRoot.render(
      React.createElement(
        EngineContext.Provider,
        { value: this.contextValue },
        this.render()
      )
    );
  }
}
```

### Доступ к GameApplication из Scene

Сейчас Scene не знает о GameApplication. Нужно добавить:

```typescript
// Вариант A: передавать через SceneManager при enter
// В SceneManager.ts — при вызове scene.onEnter():
scene.__app = this.app; // internal reference

// Вариант B: Scene получает app в конструкторе (breaking change)
// Не рекомендуется — сломает существующие игры

// Вариант C: статический registry (самый простой)
// В GameApplication.ts:
private static instance: GameApplication | null = null;
static getInstance(): GameApplication | null { return this.instance; }

// В ReactScene:
protected getGameApplication(): GameApplication {
  const app = GameApplication.getInstance();
  if (!app) throw new Error('GameApplication not initialized');
  return app;
}
```

**Рекомендация:** Вариант A — SceneManager прокидывает `app` в scene как internal property
при enter. Не ломает публичный API. ReactScene использует его.

---

## Этап 3 (опционально): extend() с layout-компонентами

Для удобства — экспортировать функцию, которая регистрирует все нужные pixi + layout
элементы для JSX:

```typescript
// src/react/extendAll.ts
import { extend } from '@pixi/react';
import { Container, Sprite, Graphics, Text, AnimatedSprite,
         NineSliceSprite, TilingSprite, Mesh } from 'pixi.js';

// @pixi/layout components (если установлен)
let layoutComponents: Record<string, any> = {};
try {
  const layout = await import('@pixi/layout/components');
  layoutComponents = {
    LayoutContainer: layout.LayoutContainer,
    LayoutView: layout.LayoutView,
    LayoutSprite: layout.LayoutSprite,
    LayoutText: layout.LayoutText,
    LayoutGraphics: layout.LayoutGraphics,
  };
} catch { /* @pixi/layout не установлен */ }

export function extendPixiElements() {
  extend({
    Container, Sprite, Graphics, Text, AnimatedSprite,
    NineSliceSprite, TilingSprite, Mesh,
    ...layoutComponents,
  });
}
```

---

## Изменения в существующем коде движка

### 1. `SceneManager.ts` — прокинуть app reference

```diff
+ private app: GameApplication;
+
+ constructor(app: GameApplication) {
+   this.app = app;
+ }

  async goto(key: string, data?: unknown) {
    const scene = this.createScene(key);
+   (scene as any).__engineApp = this.app;
    // ... existing logic
  }
```

### 2. `GameApplication.ts` — передать себя в SceneManager

```diff
- this.scenes = new SceneManager();
+ this.scenes = new SceneManager(this);
```

### 3. `package.json` — optional peer dependencies

```diff
  "peerDependencies": {
    "pixi.js": "^8.16.0",
+   "react": ">=19.0.0",
+   "react-dom": ">=19.0.0",
+   "@pixi/react": "^8.0.0",
+   "react-reconciler": "^0.31.0",
    "@pixi/layout": "^3.2.0",
    "@pixi/ui": "^2.3.0",
    "yoga-layout": "^3.0.0"
  },
  "peerDependenciesMeta": {
+   "react": { "optional": true },
+   "react-dom": { "optional": true },
+   "@pixi/react": { "optional": true },
+   "react-reconciler": { "optional": true },
    "@pixi/layout": { "optional": true },
    "@pixi/ui": { "optional": true },
    "yoga-layout": { "optional": true }
  }
```

### 4. `src/index.ts` — условный экспорт

```typescript
// React exports — отдельный entry point чтобы не тянуть react для imperative users
// Файл: src/react/index.ts (экспортируется через package.json exports)
export { createPixiRoot } from './createPixiRoot';
export { ReactScene } from './ReactScene';
export { EngineContext, useEngine } from './EngineContext';
export { useSDK, useAudio, useInput, useViewport,
         useBalance, useSession, useGameConfig } from './hooks';
export { extendPixiElements } from './extendAll';
```

```json
// package.json exports field
{
  "exports": {
    ".": "./dist/index.js",
    "./react": "./dist/react/index.js",
    "./vite": "./dist/vite/index.js"
  }
}
```

### 5. `defineGameConfig` (Vite plugin) — добавить React в dedupe

```diff
  resolve: {
    dedupe: [
      'pixi.js',
      '@pixi/layout', '@pixi/layout/components', '@pixi/ui',
      'yoga-layout', 'yoga-layout/load',
+     'react', 'react-dom', '@pixi/react',
    ],
  },
```

---

## Использование (как будет выглядеть для разработчика игры)

### Установка

```bash
npm install react react-dom @pixi/react react-reconciler
# движок уже в зависимостях, layout уже есть
```

### main.ts

```typescript
import { GameApplication, ScaleMode } from '@energy8platform/game-engine';
import { GameScene } from './scenes/GameScene';

const game = new GameApplication({
  container: '#game',
  designWidth: 1920,
  designHeight: 1080,
  scaleMode: ScaleMode.FILL,
  sdk: { devMode: true, debug: true },
  // ... assets, audio, etc.
});

game.scenes.register('game', GameScene);
await game.start('game');
```

### scenes/GameScene.tsx

```tsx
import { ReactScene } from '@energy8platform/game-engine/react';
import { GameRoot } from '../components/GameRoot';

export class GameScene extends ReactScene {
  render() {
    return <GameRoot />;
  }

  // Можно миксовать с императивным кодом
  async onEnter(data?: unknown) {
    await super.onEnter(data);
    // Добавить императивные элементы поверх React-дерева
    // this.container.addChild(someImperativeThing);
  }
}
```

### components/GameRoot.tsx

```tsx
import { useSDK, useAudio, useViewport, useBalance } from '@energy8platform/game-engine/react';
import '@pixi/layout';

export const GameRoot = () => {
  const { width, height, isPortrait } = useViewport();
  const balance = useBalance();
  const sdk = useSDK();

  return (
    <container layout={{
      width,
      height,
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <TopBar balance={balance} />
      <ReelGrid isPortrait={isPortrait} />
      <BottomControls
        isPortrait={isPortrait}
        onSpin={async () => {
          const result = await sdk?.play({ action: 'spin', bet: currentBet });
          // ... animate, then playAck
          sdk?.playAck(result!);
        }}
      />
    </container>
  );
};
```

---

## Критерии приёмки

### Этап 1: createPixiRoot

- [ ] `createPixiRoot(container)` рендерит React-дерево в PixiJS Container
- [ ] Дочерние `<container>`, `<sprite>`, `<text>`, `<graphics>` создаются как PixiJS объекты
- [ ] `layout` prop на элементах работает (Yoga flex)
- [ ] Props изменяются → PixiJS объекты обновляются (reconciliation)
- [ ] `unmount()` удаляет все дочерние объекты, не течёт память
- [ ] Event props работают (`onClick`, `onPointerDown`, etc.)
- [ ] Не создаёт свой Application — рендерит в существующий
- [ ] Работает без @pixi/react (собственный reconciler) ИЛИ с deep import
- [ ] React — optional peer dependency, императивные игры не ломаются
- [ ] Отдельный entry point (`@energy8platform/game-engine/react`),
      не попадает в основной бандл

### Этап 2: ReactScene + hooks

- [ ] `ReactScene` extends `Scene`, автоматически монтирует React в onEnter
- [ ] `render()` — abstract метод, возвращает JSX
- [ ] `useSDK()` возвращает `CasinoGameSDK` — `play()`, `playAck()`, `session` работают
- [ ] `useAudio()` возвращает `AudioManager` — `play()`, `playMusic()`, etc.
- [ ] `useInput()` возвращает `InputManager`
- [ ] `useViewport()` возвращает `{ width, height, scale, isPortrait }`
- [ ] `useBalance()` реактивно обновляется при `balanceUpdate` от SDK
- [ ] `useSession()` возвращает текущую сессию
- [ ] `onResize()` обновляет viewport context → React-дерево ре-рендерится
- [ ] `onExit()` анмаунтит React-дерево, очищает ресурсы
- [ ] Можно миксовать: `this.container.addChild(imperativeThing)` после super.onEnter()
- [ ] DevBridge работает как обычно — `dev.config.ts`, `onPlay` handler
- [ ] Session restore работает — `useSession()` возвращает pending session в onEnter

### Интеграция

- [ ] `extendPixiElements()` регистрирует стандартные PixiJS + @pixi/layout компоненты
- [ ] Vite plugin `defineGameConfig` корректно дедуплицирует react/react-dom
- [ ] Существующие императивные игры (sweet-cascade) продолжают работать без изменений
- [ ] TypeScript strict mode, полные типы для всех хуков и API
- [ ] Пример: минимальная игра с ReactScene + @pixi/layout flex

---

## Оценка трудозатрат

| Задача | Оценка |
|--------|--------|
| `createPixiRoot` (свой reconciler) | 2-3 дня |
| `createPixiRoot` (deep import) | 0.5-1 день |
| `EngineContext` + hooks | 1 день |
| `ReactScene` | 1-2 дня |
| SceneManager → app reference | 0.5 дня |
| `extendPixiElements` + Vite config | 0.5 дня |
| Тесты + пример | 2-3 дня |
| **Итого (свой reconciler)** | **~8-10 дней** |
| **Итого (deep import)** | **~5-7 дней** |

---

## Порядок реализации

```
1. SceneManager: прокинуть app reference в Scene         (0.5 дня)
   ↓
2. createPixiRoot: reconciler → Container                 (1-3 дня)
   ↓
3. EngineContext + hooks: useSDK, useAudio, useViewport   (1 день)
   ↓
4. ReactScene: mount/unmount/resize lifecycle             (1-2 дня)
   ↓
5. extendPixiElements + Vite config                        (0.5 дня)
   ↓
6. Пример: простой слот на ReactScene                     (2-3 дня)
   ↓
7. Обновить engine-patterns.md и SKILL.md                  (0.5 дня)
```
