import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS, assetUrl } from './assets';

const paths = (): string[] => [...ASSETS.characters.modular, ...ASSETS.characters.special, ...Object.values(ASSETS.props)];

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

  it('assetUrl dokleja ścieżkę do base bez podwójnego ukośnika', () => {
    const url = assetUrl(ASSETS.props.van);
    expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true);
    expect(url.endsWith('assets/props/van-delivery.glb')).toBe(true);
    expect(url.slice(import.meta.env.BASE_URL.length).startsWith('/')).toBe(false);
  });
});

describe('ASSETS.characters.special (stroje tylko dla kasjera gracza)', () => {
  const names = (): string[] => ASSETS.characters.special.map((p) => basename(p));

  it('to dokładnie dziewięć strojów special-<men|women>-<nazwa>.glb: czterech mężczyzn i pięć kobiet', () => {
    expect(names()).toEqual([
      'special-men-spacesuit.glb', 'special-men-king.glb', 'special-men-swat.glb', 'special-men-adventurer.glb',
      'special-women-scifi.glb', 'special-women-adventurer.glb', 'special-women-witch.glb', 'special-women-medieval.glb',
      'special-women-soldier.glb',
    ]);
    for (const path of ASSETS.characters.special) expect(path.startsWith('/assets/characters/special-'), path).toBe(true);
  });

  it('nie mieszają się ze strojami klientów (ASSETS.characters.modular)', () => {
    expect(ASSETS.characters.special.filter((p) => ASSETS.characters.modular.includes(p))).toEqual([]);
  });

  it('każdy plik istnieje i ma własny wiersz tabeli w LICENSES.md (paczka i źródło)', () => {
    const rows = readFileSync(join('public', 'assets', 'LICENSES.md'), 'utf8').split('\n');
    for (const path of ASSETS.characters.special) {
      expect(existsSync(join('public', path)), path).toBe(true);
      const row = rows.find((line) => line.startsWith('| `' + basename(path) + '` |'));
      expect(row, `wiersz ${basename(path)} w LICENSES.md`).toBeDefined();
      expect(row, basename(path)).toMatch(/Ultimate Modular (Men|Women) \| Individual Characters\/glTF\/\w+\.gltf \|$/);
    }
  });
});
