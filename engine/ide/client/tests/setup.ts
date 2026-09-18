// Extends vitest's `expect` with jest-dom matchers (`toHaveTextContent`, …)
// used by the composition screen's tests.
import '@testing-library/jest-dom/vitest';

// React Flow (the Flow document's canvas) measures its pane with a
// `ResizeObserver`, unguarded; jsdom has none. A no-op keeps the canvas
// mountable — nothing here is ever measured anyway.
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}
