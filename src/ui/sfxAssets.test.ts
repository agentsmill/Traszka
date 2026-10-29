import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_KINDS } from './sfxBank';

/**
 * Dane dźwięków w repozytorium: wybór próbek (scripts/audio-map.json), wynik przetwarzania (public/assets/audio, `npm run audio`)
 * i licencje. Nie wymagają assets-src ani ffmpeg, więc działają też w CI.
 */

const MAP_FILE = join('scripts', 'audio-map.json');
const DIR = join('public', 'assets', 'audio');
const LICENSES = join('public', 'assets', 'LICENSES.md');

/** Paczki, z których wolno brać dźwięki; każda musi mieć wiersz w LICENSES.md. */
const PACKS = ['kenney-interface-sounds', 'kenney-impact-sounds', 'kenney-rpg-audio', 'kenney-music-jingles'];

const MAX_TOTAL_BYTES = 400 * 1024;
const MAX_FILE_BYTES = 100 * 1024;

type AudioMap = Record<string, Array<{ pack: string; file: string }>>;
const readMap = (): AudioMap => JSON.parse(readFileSync(MAP_FILE, 'utf8')) as AudioMap;
const readManifest = (): Record<string, string[]> => JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, string[]>;
/** Pliki .mp3 w katalogu (śmieci systemu, jak .DS_Store, nie są assetami). */
const mp3s = (): string[] => readdirSync(DIR).filter((name) => name.endsWith('.mp3')).sort();
const kinds: readonly string[] = SFX_KINDS;

describe('scripts/audio-map.json (wybór próbek)', () => {
  it('klucze to rodzaje dźwięków gry (Sfx)', () => {
    expect(Object.keys(readMap()).filter((kind) => !kinds.includes(kind))).toEqual([]);
  });

  it('każdy wpis to { pack, file }: paczka z listy czterech, plik .ogg ze ścieżką względną wewnątrz paczki', () => {
    for (const [kind, list] of Object.entries(readMap())) {
      expect(Array.isArray(list), kind).toBe(true);
      list.forEach((entry, n) => {
        const where = `${kind}[${n}]`;
        expect(Object.keys(entry).sort(), where).toEqual(['file', 'pack']);
        expect(PACKS, where).toContain(entry.pack);
        expect(entry.file, where).toMatch(/^[^/\\].*\.ogg$/);
        expect(entry.file.split(/[\\/]/), where).not.toContain('..');
      });
    }
  });

  it('ten sam plik nie występuje dwa razy w jednym rodzaju (zmarnowałby budżet i wariant)', () => {
    for (const [kind, list] of Object.entries(readMap())) {
      const ids = list.map((entry) => `${entry.pack}/${entry.file}`);
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
  });
});

describe('public/assets/audio (wynik npm run audio)', () => {
  it('manifest ma tylko rodzaje gry i niepuste listy plików <rodzaj>-<n>.mp3 numerowane od zera', () => {
    for (const [kind, files] of Object.entries(readManifest())) {
      expect(kinds, kind).toContain(kind);
      expect(files.length, kind).toBeGreaterThan(0);
      expect(files, kind).toEqual(files.map((_, n) => `${kind}-${n}.mp3`));
    }
  });

  it('każdy rodzaj z mapy ma w manifeście tyle plików, ile wpisów (po zmianie mapy trzeba puścić npm run audio)', () => {
    const manifest = readManifest();
    const expected = Object.fromEntries(Object.entries(readMap()).filter(([, list]) => list.length > 0).map(([kind, list]) => [kind, list.length]));
    const actual = Object.fromEntries(Object.entries(manifest).map(([kind, files]) => [kind, files.length]));
    expect(actual).toEqual(expected);
  });

  it('każdy plik z manifestu istnieje, a każdy plik .mp3 w katalogu jest w manifeście (brak martwych plików)', () => {
    const listed = Object.values(readManifest()).flat().sort();
    expect(listed.filter((name) => !existsSync(join(DIR, name)))).toEqual([]);
    expect(mp3s()).toEqual(listed);
  });

  it('katalog zawiera tylko pliki .mp3 i manifest.json', () => {
    const others = readdirSync(DIR).filter((name) => !name.startsWith('.') && !name.endsWith('.mp3') && name !== 'manifest.json');
    expect(others).toEqual([]);
  });

  it('pliki to MP3 (MPEG-1 Layer III), mono, 44,1 kHz, bez tagu ID3 na początku', () => {
    for (const name of mp3s()) {
      const bytes = readFileSync(join(DIR, name));
      expect(bytes.subarray(0, 3).toString('latin1'), `${name}: tag ID3`).not.toBe('ID3');
      const [b0, b1, b2, b3] = bytes;
      expect(b0 === 0xff && (b1! & 0xe0) === 0xe0, `${name}: nagłówek ramki MP3`).toBe(true);
      expect((b1! >> 3) & 3, `${name}: MPEG-1`).toBe(3);
      expect((b1! >> 1) & 3, `${name}: Layer III`).toBe(1);
      expect((b2! >> 2) & 3, `${name}: 44,1 kHz`).toBe(0);
      expect((b3! >> 6) & 3, `${name}: mono`).toBe(3);
    }
  });

  it('budżet: łącznie do 400 KB, pojedynczy plik do 100 KB', () => {
    const sizes = mp3s().map((name) => ({ name, bytes: statSync(join(DIR, name)).size }));
    expect(sizes.filter((s) => s.bytes > MAX_FILE_BYTES)).toEqual([]);
    expect(sizes.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(sizes.filter((s) => s.bytes < 500), 'pusty albo uciety plik').toEqual([]);
  });
});

describe('licencje dźwięków', () => {
  const rows = (): string[] => readFileSync(LICENSES, 'utf8').split('\n').filter((line) => line.startsWith('|'));

  it.each(PACKS)('%s ma wiersz w tabeli paczek: autor Kenney, CC0 1.0, adres kenney.nl', (pack) => {
    const slug = pack.replace(/^kenney-/, '');
    const row = rows().find((line) => line.includes(`https://kenney.nl/assets/${slug} `));
    expect(row, `wiersz ${pack} w LICENSES.md`).toBeDefined();
    expect(row).toContain('Kenney (kenney.nl)');
    expect(row).toContain('CC0 1.0');
  });

  it('każda paczka użyta w mapie jest na liście paczek z licencją', () => {
    const used = new Set(Object.values(readMap()).flatMap((list) => list.map((entry) => entry.pack)));
    expect([...used].filter((pack) => !PACKS.includes(pack))).toEqual([]);
  });

  it('LICENSES.md opisuje, skąd biorą się pliki audio (npm run audio, scripts/audio-map.json)', () => {
    const text = readFileSync(LICENSES, 'utf8');
    expect(text).toContain('npm run audio');
    expect(text).toContain('scripts/audio-map.json');
  });
});
