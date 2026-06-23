import { describe, it, expect } from 'vitest';
import { FreeSpinsSession } from '../../src/slot/freeSpins/FreeSpinsSession';

describe('FreeSpinsSession', () => {
  it('starts with initialSpins and completes after consuming them', () => {
    const s = new FreeSpinsSession({ initialSpins: 3 });
    expect(s.remaining).toBe(3);
    expect(s.total).toBe(3);
    expect(s.isComplete).toBe(false);
    s.consume(); s.consume(); s.consume();
    expect(s.remaining).toBe(0);
    expect(s.isComplete).toBe(true);
  });

  it('award extends remaining and total (retrigger)', () => {
    const s = new FreeSpinsSession({ initialSpins: 2 });
    s.consume();        // 1 left
    s.award(5);
    expect(s.remaining).toBe(6);
    expect(s.total).toBe(7);
  });

  it('accumulates win and honors the isMaxWin exit', () => {
    let capped = false;
    const s = new FreeSpinsSession({ initialSpins: 10, isMaxWin: () => capped });
    s.addWin(2); s.addWin(3);
    expect(s.totalWin).toBe(5);
    expect(s.isComplete).toBe(false);
    capped = true;
    expect(s.isComplete).toBe(true);
  });
});
