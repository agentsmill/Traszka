import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS } from './assets';

describe('ASSETS', () => {
  it('każda ścieżka wskazuje na istniejący plik w public/', () => {
    const { characters, props } = ASSETS;
    const paths = [
      characters.ubc.male,
      characters.ubc.female,
      ...characters.ubc.hair,
      ...characters.ubc.eyebrows,
      ...characters.modular,
      characters.animations,
      ...Object.values(props),
    ];
    expect(paths.filter((p) => !existsSync(join('public', p)))).toEqual([]);
  });
});
