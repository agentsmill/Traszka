import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS } from './assets';

const paths = (): string[] => [...ASSETS.characters.modular, ...Object.values(ASSETS.props)];

describe('ASSETS', () => {
  it('każda ścieżka wskazuje na istniejący plik w public/', () => {
    expect(paths().filter((p) => !existsSync(join('public', p)))).toEqual([]);
  });

  it('każdy plik .glb w public/assets/characters i props jest używany (ASSETS): potok nie zostawia martwych plików', () => {
    const used = new Set(paths());
    const onDisk = ['characters', 'props'].flatMap((dir) =>
      readdirSync(join('public', 'assets', dir))
        .filter((name) => name.endsWith('.glb'))   // .DS_Store i inne śmieci systemu nie są assetami
        .map((name) => `/assets/${dir}/${name}`));
    expect(onDisk.filter((p) => !used.has(p))).toEqual([]);
  });
});
