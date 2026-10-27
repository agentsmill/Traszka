import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architektura', () => {
  it('src/sim nie importuje three i nie używa Math.random', () => {
    const offenders = files('src/sim').filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /from ['"]three/.test(src) || /Math\.random/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
