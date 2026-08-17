<!-- Source: https://docs.artube-888.live/ru/frontend-sdk/packages/artube-loader/ -->

# @artube/loader

## Описание

Решение `@artube/loader` предоставляет возможность играм использовать один и тот же загрузочный экран без необходимости хранения ассетов или кода, относящихся к лоадеру.

Artube loader отображается **ещё до загрузки игрового бандла** (js/css), обеспечивая мгновенную визуальную обратную связь. Начальное состояние не содержит индикатор прогресса - его отображение инициирует игра на старте загрузки ресурсов.

## Макет

Дизайн лоадера представлен в Figma. Визуальное решение обеспечивает брендированный внешний вид, соответствующий стилю платформы Artube.

Figma

Frame 2587.png - макет загрузочного экрана

## Решение

Пакет `@artube/loader` предоставляет **Vite-плагин** для внедрения HTML/CSS в игровой [`index.html`](index.html) во время сборки проекта.

### Ключевые особенности

- **Нулевые накладные расходы** - лоадер не увеличивает размер игрового бандла
- **Мгновенное отображение** - показывается до загрузки любых игровых ресурсов
- **Прогрессивное раскрытие** - индикатор прогресса появляется только тогда, когда игра начинает загрузку
- **Единообразный дизайн** - все игры используют одинаковый брендированный лоадер

## Установка

Установите пакет из внутреннего NPM-реестра:

```bash
npm install @artube/loader
```

> Конфигурация NPM registry — из репозитория Book of Artube
>
> Конфигурация доступа к внутреннему NPM registry для `@artube`-пакетов берётся из эталонного `.npmrc` репозитория **Book of Artube**. Добавьте в корень своего проекта файл `.npmrc` со следующим содержимым:
>
> ```ini
> @artube:registry=https://gitlab.com/api/v4/projects/81086971/packages/npm/
> //gitlab.com/api/v4/projects/81086971/packages/npm/:_authToken="${GITLAB_TOKEN}"
> ```
>
> Переменная `GITLAB_TOKEN` должна быть доступна в окружении при установке пакета (локально — как переменная окружения shell; в CI/CD — через **Settings → CI/CD → Variables** вашего GitLab-проекта). Токен должен иметь как минимум scope/permission **`read_registry`**.
>
> Список опубликованных версий пакета можно посмотреть в веб-интерфейсе GitLab Packages Registry группы `sdk`: `https://gitlab.com/artube-888-group/sdk/packages/-/packages`.

## vite.config.ts

Добавьте плагин [`artuberLoader`](vite.config.ts:7) в конфигурацию Vite:

- [TypeScript](#tab-panel-10)
- [JavaScript](#tab-panel-11)

```typescript
import { defineConfig, UserConfig } from 'vite';
import { artuberLoader } from '@artube/loader'; // Импорт модуля

export default defineConfig(async (configEnv): Promise<UserConfig> => {
  return {
    plugins: [
      artuberLoader({ useArtubePreloader: false }), // Добавление плагина в список
      // ...остальные плагины
    ],
    // ...остальная конфигурация
  };
});
```

```javascript
import { defineConfig } from 'vite';
import { artuberLoader } from '@artube/loader';

export default defineConfig({
  plugins: [
    artuberLoader({ useArtubePreloader: false }),
    // ...остальные плагины
  ],
  // ...остальная конфигурация
});
```

Важно

Плагин автоматически инжектирует HTML/CSS лоадера в финальную сборку. Никаких дополнительных действий с разметкой не требуется.

## Игра

Пакет `@artube/loader` экспортирует класс [`LoaderViewController`](#loaderviewcontroller), который предоставляет программный API для управления состоянием лоадера.

### LoaderViewController

Контроллер управляет видимостью и состоянием загрузочного экрана:

| Метод | Описание |
| --- | --- |
| [`showLoader()`](#showloader) | Включает отображение индикатора прогресса |
| [`hideLoader()`](#hideloader) | Скрывает лоадер с fade-out анимацией |
| [`updateProgress(progress: number)`](#updateprogress) | Обновляет прогресс (0-100) |

#### showLoader

Активирует отображение индикатора прогресса. По умолчанию лоадер показан без него.

```typescript
artubeLoader.showLoader();
```

Примечание

Вызывайте этот метод когда игра начинает загружать ресурсы и готова предоставлять информацию о прогрессе.

#### updateProgress

Обновляет ширину индикатора прогресса. Принимает значение от 0 до 100.

```typescript
// Параметры:
// progress: number (0-100) - процент загрузки
artubeLoader.updateProgress(progress);
```

**Пример использования:**

```typescript
// Загружено 45%
artubeLoader.updateProgress(45);

// Загрузка завершена
artubeLoader.updateProgress(100);
```

#### hideLoader

Скрывает лоадер с плавной fade-out анимацией. Вызывается, когда все ресурсы загружены и игра готова к запуску.

```typescript
artubeLoader.hideLoader();
```

Рекомендация

Дождитесь завершения анимации скрытия перед запуском игровых систем для плавного перехода.

## Интеграционный флоу

Типичная последовательность использования лоадера в игре:

- [Основной паттерн](#tab-panel-12)
- [С PIXI.js](#tab-panel-13)
- [С React](#tab-panel-14)

```typescript
import { LoaderViewController } from '@artube/loader';

class GameLoader {
  private loaderController = new LoaderViewController();

  async initializeGame(): Promise<void> {
    // 1. Активируем индикатор прогресса при старте загрузки
    this.loaderController.showLoader();

    try {
      // 2. Загрузка ресурсов с обновлением прогресса
      await this.loadGameAssets();

      // 3. Скрытие лоадера после завершения
      this.loaderController.hideLoader();

    } catch (error) {
      console.error('Failed to load game:', error);
      // Обработка ошибок загрузки
    }
  }

  private async loadGameAssets(): Promise<void> {
    const assets = [
      'textures/sprites.png',
      'audio/music.mp3',
      'data/config.json',
      // ...другие ресурсы
    ];

    for (let i = 0; i < assets.length; i++) {
      await this.loadAsset(assets[i]);

      // Обновление прогресса
      const progress = ((i + 1) / assets.length) * 100;
      this.loaderController.updateProgress(progress);
    }
  }

  private async loadAsset(path: string): Promise<void> {
    // Логика загрузки отдельного ресурса
    return new Promise((resolve) => {
      // Имитация загрузки
      setTimeout(resolve, Math.random() * 1000);
    });
  }
}
```

```typescript
import { LoaderViewController } from '@artube/loader';
import { Application, Assets } from 'pixi.js';

class PixiGameLoader {
  private loaderController = new LoaderViewController();
  private app: Application;

  async initializeGame(): Promise<void> {
    // Создание PIXI приложения
    this.app = new Application();
    await this.app.init({ width: 1920, height: 1080 });

    // Отображение индикатора прогресса
    this.loaderController.showLoader();

    // Настройка обработчика прогресса PIXI
    Assets.loader.onProgress.add(this.onLoadProgress.bind(this));

    try {
      // Загрузка bundle с ресурсами
      await Assets.loadBundle('game-assets');

      // Инициализация игровых систем
      await this.setupGameSystems();

      // Скрытие loader
      this.loaderController.hideLoader();

    } catch (error) {
      console.error('Game loading failed:', error);
    }
  }

  private onLoadProgress(progress: number): void {
    // PIXI предоставляет прогресс от 0 до 1
    const progressPercent = progress * 100;
    this.loaderController.updateProgress(progressPercent);
  }

  private async setupGameSystems(): Promise<void> {
    // Дополнительная инициализация после загрузки ассетов
    // (создание сцен, настройка UI и т.п.)
  }
}
```

```typescript
import React, { useEffect, useState } from 'react';
import { LoaderViewController } from '@artube/loader';

const GameApp: React.FC = () => {
  const [gameLoaded, setGameLoaded] = useState(false);
  const [loaderController] = useState(() => new LoaderViewController());

  useEffect(() => {
    const loadGame = async () => {
      // Отображение loader
      loaderController.showLoader();

      try {
        // Загрузка игровых данных
        await loadGameData((progress) => {
          loaderController.updateProgress(progress);
        });

        // Скрытие loader
        loaderController.hideLoader();
        setGameLoaded(true);

      } catch (error) {
        console.error('Failed to load game:', error);
      }
    };

    loadGame();
  }, [loaderController]);

  if (!gameLoaded) {
    return null; // Loader управляется через API
  }

  return (
    <div className="game-container">
      {/* Игровой контент */}
    </div>
  );
};

async function loadGameData(
  onProgress: (progress: number) => void
): Promise<void> {
  const steps = [
    () => loadTextures(),
    () => loadAudio(),
    () => loadConfig(),
    () => initializeGameSystems(),
  ];

  for (let i = 0; i < steps.length; i++) {
    await steps[i]();
    const progress = ((i + 1) / steps.length) * 100;
    onProgress(progress);
  }
}
```

## Best Practices

### Управление прогрессом

Рекомендация

**Показывайте реальный прогресс** - используйте фактические данные о загрузке ресурсов, а не имитацию.

```typescript
// ✅ Хорошо: реальный прогресс на основе loaded/total
const updateProgress = (loaded: number, total: number) => {
  const progress = (loaded / total) * 100;
  loaderController.updateProgress(progress);
};

// ❌ Плохо: фиктивный прогресс
let fakeProgress = 0;
const interval = setInterval(() => {
  fakeProgress += 10;
  loaderController.updateProgress(fakeProgress);
}, 100);
```

### Обработка ошибок

```typescript
class RobustGameLoader {
  private loaderController = new LoaderViewController();
  private readonly RETRY_ATTEMPTS = 3;

  async loadWithRetry(assetUrl: string, attempt = 1): Promise<void> {
    try {
      await this.loadAsset(assetUrl);
    } catch (error) {
      if (attempt < this.RETRY_ATTEMPTS) {
        console.warn(`Retry ${attempt}/${this.RETRY_ATTEMPTS} for ${assetUrl}`);
        return this.loadWithRetry(assetUrl, attempt + 1);
      }
      throw error;
    }
  }

  async safeInitialize(): Promise<void> {
    this.loaderController.showLoader();

    try {
      await this.loadCriticalAssets();
      await this.loadOptionalAssets();

      this.loaderController.updateProgress(100);
      await this.delay(300); // Показать 100% перед скрытием
      this.loaderController.hideLoader();

    } catch (error) {
      console.error('Critical loading error:', error);
      // Показать fallback UI или экран ошибки
      this.showErrorState();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private showErrorState(): void {
    this.loaderController.hideLoader();
    // Показать пользовательское сообщение об ошибке
  }
}
```

### Оптимизация производительности

Производительность

**Батчьте обновления прогресса** - не вызывайте [`updateProgress()`](#updateprogress) слишком часто.

```typescript
class ThrottledProgressLoader {
  private loaderController = new LoaderViewController();
  private lastProgressUpdate = 0;
  private readonly PROGRESS_THROTTLE_MS = 50; // Максимум 20 FPS

  updateProgressThrottled(progress: number): void {
    const now = Date.now();
    if (now - this.lastProgressUpdate >= this.PROGRESS_THROTTLE_MS) {
      this.loaderController.updateProgress(progress);
      this.lastProgressUpdate = now;
    }
  }

  async loadManySmallAssets(urls: string[]): Promise<void> {
    this.loaderController.showLoader();

    for (let i = 0; i < urls.length; i++) {
      await this.loadAsset(urls[i]);

      // Throttled progress update
      const progress = ((i + 1) / urls.length) * 100;
      this.updateProgressThrottled(progress);
    }

    // Обязательно показываем финальный прогресс
    this.loaderController.updateProgress(100);
    this.loaderController.hideLoader();
  }
}
```

## Устранение проблем

### Loader не отображается

**Причина:** Плагин не подключен или подключен неправильно.

**Решение:** Проверьте корректность импорта и добавления в [`vite.config.ts`](vite.config.ts):

```typescript
// Убедитесь в правильном импорте
import { artuberLoader } from '@artube/loader';

export default defineConfig({
  plugins: [
    artuberLoader({ useArtubePreloader: false }), // Должен быть в списке plugins
  ],
});
```

### Индикатор прогресса не появляется

**Причина:** Не вызван метод [`showLoader()`](#showloader).

**Решение:** Убедитесь, что вызываете [`showLoader()`](#showloader) перед началом загрузки:

```typescript
const loader = new LoaderViewController();

// ✅ Правильная последовательность
loader.showLoader();           // Сначала показываем индикатор прогресса
loader.updateProgress(50);     // Затем обновляем прогресс

// ❌ Неправильно
loader.updateProgress(50);     // Индикатор прогресса не будет виден
```

### Loader не скрывается

**Причина:** Не вызван [`hideLoader()`](#hideloader) или произошла ошибка в процессе загрузки.

**Решение:** Всегда вызывайте [`hideLoader()`](#hideloader) в блоке `finally`:

```typescript
const loader = new LoaderViewController();

try {
  loader.showLoader();
  await loadGameAssets();
} catch (error) {
  console.error('Loading failed:', error);
} finally {
  loader.hideLoader(); // Скрываем loader в любом случае
}
```

## API Reference

### LoaderViewController

Основной класс для управления загрузочным экраном.

```typescript
class LoaderViewController {
  /**
   * Показывает progress bar loader'а
   */
  showLoader(): void;

  /**
   * Скрывает loader с fade-out анимацией
   */
  hideLoader(): void;

  /**
   * Обновляет прогресс загрузки
   * @param progress - Прогресс от 0 до 100
   */
  updateProgress(progress: number): void;
}
```

### artuberLoader

Vite-плагин для интеграции loader’а в проект.

```typescript
/**
 * Vite плагин для внедрения Artube Loader
 * @param options - Параметры конфигурации плагина
 * @returns Конфигурация плагина для Vite
 */
function artuberLoader(options?: ArtuberLoaderOptions): Plugin;

interface ArtuberLoaderOptions {
  /**
   * Отключает встроенный прелоадер Artube.
   * Установите `false`, чтобы использовать собственный прелоадер игры.
   * @default true
   */
  useArtubePreloader?: boolean;
}
```

**Использование:**

```typescript
import { artuberLoader } from '@artube/loader';

export default defineConfig({
  plugins: [
    artuberLoader({ useArtubePreloader: false }),
  ],
});
```

Совет

Плагин автоматически определяет режим сборки (development/production) и оптимизирует внедрение соответствующим образом.
