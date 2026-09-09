// Extends vitest's `expect` with jest-dom matchers (`toHaveTextContent`, …)
// used by App's own tests. Copied from `ide-client`'s `tests/setup.ts` —
// its sibling package, same reason to have one.
import '@testing-library/jest-dom/vitest';
