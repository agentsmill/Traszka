import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS, assetUrl } from './assets';

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

  it('assetUrl dokleja ścieżkę do base bez podwójnego ukośnika', () => {
    const url = assetUrl(ASSETS.props.van);
    expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true);
    expect(url.endsWith('assets/props/van-delivery.glb')).toBe(true);
    expect(url.slice(import.meta.env.BASE_URL.length).startsWith('/')).toBe(false);
  });
});
