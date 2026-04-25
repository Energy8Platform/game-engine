import { ConcurrentRoot } from 'react-reconciler/constants';
import type { Container } from 'pixi.js';
import type { ReactElement } from 'react';
import { reconciler } from './reconciler';

export interface PixiRoot {
  render(element: ReactElement): void;
  unmount(): void;
}

export function createPixiRoot(container: Container): PixiRoot {
  const fiberRoot = reconciler.createContainer(
    container,       // containerInfo
    ConcurrentRoot,  // tag
    null,            // hydrationCallbacks
    false,           // isStrictMode
    null,            // concurrentUpdatesByDefaultOverride
    '',              // identifierPrefix
    (err: Error) => console.error('[PixiRoot]', err),
    null,            // transitionCallbacks
  );

  return {
    render(element: ReactElement) {
      reconciler.updateContainer(element, fiberRoot, null, () => {});
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, () => {});
    },
  };
}
