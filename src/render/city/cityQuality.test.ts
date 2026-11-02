import { describe, expect, it } from 'vitest';
import { QUALITY, type QualityPresetId } from '@/render/quality';
import { CITY_PROFILES, cityProfile, type CityProfile } from './cityQuality';

/** Profile miasta wg briefu Zadania 12 (spec §19): Niska i telefon bez cieni i aut, z warstwą na start; Średnia i Wysoka z makietą. */
const EXPECTED: Record<QualityPresetId | 'telefon', CityProfile> = {
  telefon: { mockup: true, defaultLayer: 'ruch', cars: false, shadows: 'off', firstDetail: 'prosty', releaseOnExit: true },
  niska: { mockup: true, defaultLayer: 'ruch', cars: false, shadows: 'off', firstDetail: 'prosty', releaseOnExit: true },
  srednia: { mockup: true, defaultLayer: 'makieta', cars: true, shadows: 'static', firstDetail: 'pelny', releaseOnExit: false },
  wysoka: { mockup: true, defaultLayer: 'makieta', cars: true, shadows: 'static', firstDetail: 'pelny', releaseOnExit: false },
};

describe('CITY_PROFILES', () => {
  it('ma dokładnie profile telefon, niska, srednia i wysoka z wartościami z briefu', () => {
    expect(Object.keys(CITY_PROFILES).sort()).toEqual(['niska', 'srednia', 'telefon', 'wysoka']);
    expect(CITY_PROFILES).toEqual(EXPECTED);
  });

  it('każdy preset jakości ma profil miasta', () => {
    for (const id of Object.keys(QUALITY) as QualityPresetId[]) expect(CITY_PROFILES[id], id).toBeDefined();
  });

  it('cienie i auta tylko tam, gdzie jest na nie budżet: preset z mapą cienia 2048+ (średnia, wysoka)', () => {
    for (const id of ['niska', 'srednia', 'wysoka'] as const) {
      expect(CITY_PROFILES[id].shadows === 'static', id).toBe(QUALITY[id].shadowMapSize >= 2048);
      expect(CITY_PROFILES[id].cars, id).toBe(QUALITY[id].shadowMapSize >= 2048);
    }
  });

  it('wolny sprzęt (zwalnianie sceny po wyjściu) startuje na prostej geometrii, mocny od razu na pełnej', () => {
    for (const p of Object.values(CITY_PROFILES)) expect(p.releaseOnExit).toBe(p.firstDetail === 'prosty');
  });

  it('profile są zamrożone: nikt nie przestawi ich w trakcie gry', () => {
    for (const p of Object.values(CITY_PROFILES)) expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(CITY_PROFILES)).toBe(true);
  });
});

describe('cityProfile', () => {
  it('na komputerze profil wynika z presetu', () => {
    for (const id of ['niska', 'srednia', 'wysoka'] as const) expect(cityProfile(id, false), id).toBe(CITY_PROFILES[id]);
  });

  it('telefon wygrywa z presetem: isMobile daje profil telefon, także przy wybranej Wysokiej', () => {
    expect(cityProfile('wysoka', true)).toBe(CITY_PROFILES.telefon);
    for (const id of ['niska', 'srednia', 'wysoka'] as const) expect(cityProfile(id, true), id).toBe(CITY_PROFILES.telefon);
    expect(cityProfile('wysoka', true)).toEqual(EXPECTED.telefon);
  });
});
