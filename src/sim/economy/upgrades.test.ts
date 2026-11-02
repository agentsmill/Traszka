import { describe, expect, it } from 'vitest';
import { REMONTS, UPGRADES, UPGRADE_BY_ID, remontTrafficMult, upgradeCost, type UpgradeId } from './upgrades';

describe('remonty (spec 4b §5.1)', () => {
  it('REMONTS: ceny 35k/100k/200k/450k/900k, poziomy 1–3 bez zmian poza ceną', () => {
    expect(REMONTS.map((r) => r.cost)).toEqual([35_000, 100_000, 200_000, 450_000, 900_000]);
    expect(REMONTS.map((r) => [r.grow, r.slots, r.minLevel, r.days])).toEqual([
      [[4, 2, 1], 4, 8, 2], [[8, 4, 2], 5, 14, 3], [[12, 6, 3], 7, 20, 4], [[14, 7, 4], 8, 28, 5], [[16, 8, 4], 9, 34, 6]]);
    expect(REMONTS.map((r) => r.level)).toEqual([1, 2, 3, 4, 5]);
    expect(REMONTS.map((r) => r.name)).toEqual([
      'Remont: dokupienie lokalu obok', 'Remont: wersja Premium', 'Remont: Flagowiec', 'Remont: Flagowiec Plus', 'Remont: Traszka Max Pro Ultra']);
  });

  it('remontTrafficMult: 0–3 bit w bit jak 1 + 0.1 × poziom, potem 1.45 i 1.6', () => {
    for (const l of [0, 1, 2, 3]) expect(Object.is(remontTrafficMult(l), 1 + 0.1 * l)).toBe(true);
    expect(remontTrafficMult(4)).toBeCloseTo(1.45, 12);
    expect(remontTrafficMult(5)).toBeCloseTo(1.6, 12);
  });
});

describe('ulepszenia późnej gry (spec 4b §5.2)', () => {
  it('maxLevel: szkolenie 8, klima 3, scoSoft 5, wozek 5, regaly 5, ulotki 8, kawa 5, traszkapka 5, tasmociag 5, wykladacz 5', () => {
    const max = (id: UpgradeId): number => UPGRADE_BY_ID[id].maxLevel;
    expect(max('szkolenie')).toBe(8);
    expect(max('klima')).toBe(3);
    expect(max('scoSoft')).toBe(5);
    expect(max('wozek')).toBe(5);
    expect(max('regaly')).toBe(5);
    expect(max('ulotki')).toBe(8);
    expect(max('kawa')).toBe(5);
    expect(max('traszkapka')).toBe(5);
    expect(max('tasmociag')).toBe(5);
    expect(max('wykladacz')).toBe(5);
  });

  it('pozostałe maxLevel bez zmian', () => {
    const max = (id: UpgradeId): number => UPGRADE_BY_ID[id].maxLevel;
    expect([max('drugaKasa'), max('asystent'), max('nocne'), max('rampa'), max('dostawy2'), max('kamery'), max('prasa'), max('humanoid')])
      .toEqual([2, 2, 1, 1, 1, 2, 1, 1]);
  });

  it('nowe ulepszenia z tabeli §5.2: grupa, maxLevel, baseCost, costMult, requires', () => {
    const row = (id: UpgradeId): unknown => {
      const u = UPGRADE_BY_ID[id];
      return [u.group, u.maxLevel, u.baseCost, u.costMult, u.requires];
    };
    expect(row('kasaEkspres')).toEqual(['kasa', 3, 45_000, 2.4, { remont: 3, upgrade: [['szkolenie', 5]] }]);
    expect(row('ekrany')).toEqual(['klienci', 5, 60_000, 2.1, { remont: 3 }]);
    expect(row('barHot')).toEqual(['klienci', 4, 50_000, 2.3, { remont: 3, upgrade: [['kawa', 3]] }]);
    expect(row('magazynWys')).toEqual(['palety', 3, 80_000, 2.5, { remont: 4, upgrade: [['regaly', 3]] }]);
    expect(row('dron')).toEqual(['warsztat', 3, 70_000, 2.4, { remont: 3, upgrade: [['wykladacz', 2]] }]);
    expect(UPGRADES.map((u) => u.id).slice(-5)).toEqual(['kasaEkspres', 'ekrany', 'barHot', 'magazynWys', 'dron']);
  });

  it('koszt rośnie szybciej niż efekt: każdy poziom drożeje co najmniej 1,8 raza (z zaokrągleniem do 50 zł ≥ 1,75)', () => {
    for (const def of UPGRADES) {
      if (def.maxLevel < 2) continue;
      expect(def.costMult, def.id).toBeGreaterThanOrEqual(1.8);
      for (let l = 0; l < def.maxLevel - 1; l++) {
        expect(upgradeCost(def, l + 1) / upgradeCost(def, l), `${def.id} @${l}`).toBeGreaterThanOrEqual(1.75);
      }
    }
    for (const id of ['kasaEkspres', 'ekrany', 'barHot', 'magazynWys', 'dron'] as const) {
      const def = UPGRADE_BY_ID[id];
      for (let l = 0; l < def.maxLevel - 1; l++) expect(upgradeCost(def, l + 1) / upgradeCost(def, l), `${id} @${l}`).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('ceny: ostatni poziom nowych ulepszeń liczy się z baseCost × costMult^(poziom − 1), zaokrąglone do 50 zł', () => {
    expect(upgradeCost(UPGRADE_BY_ID.kasaEkspres, 0)).toBe(45_000);
    expect(upgradeCost(UPGRADE_BY_ID.kasaEkspres, 2)).toBe(259_200);   // 45 000 × 2,4²
    expect(upgradeCost(UPGRADE_BY_ID.dron, 1)).toBe(168_000);   // 70 000 × 2,4
    for (const def of UPGRADES) for (let l = 0; l < def.maxLevel; l++) expect(upgradeCost(def, l) % 50, `${def.id} @${l}`).toBe(0);
  });

  it('każde UPGRADES.names ma co najmniej tyle wpisów co maxLevel, a nazwy są niepuste i różne', () => {
    for (const def of UPGRADES) {
      expect(def.names.length, def.id).toBeGreaterThanOrEqual(def.maxLevel);
      expect(def.names.every((n) => n.trim().length > 0), def.id).toBe(true);
      expect(new Set(def.names).size, `${def.id}: powtórzona nazwa`).toBe(def.names.length);
    }
  });

  it('identyfikatory ulepszeń są unikalne', () => {
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });
});
