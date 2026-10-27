import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, it, expect } from 'vitest';

function files(dir: string, ext = '.ts'): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
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

  it('każdy plik .glb w public/assets ma wpis w public/assets/LICENSES.md', () => {
    const licenses = readFileSync('public/assets/LICENSES.md', 'utf8');
    const glbs = files('public/assets', '.glb').map((f) => basename(f));
    expect(glbs.length).toBeGreaterThan(0);
    // nazwa w komórce tabeli z backtickami: `men-suit.glb` nie może przejść dzięki `women-suit.glb`
    const missing = glbs.filter((name) => !licenses.includes('`' + name + '`'));
    expect(missing).toEqual([]);
  });
});
