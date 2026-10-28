import { describe, expect, it } from 'vitest';
import { GAME_VERSION } from './version';

describe('GAME_VERSION', () => {
  it('w Vitest to "test" (vite.config.ts wstawia wersję w czasie budowania)', () => {
    expect(GAME_VERSION).toBe('test');
  });
});
