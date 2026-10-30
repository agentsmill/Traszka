import { describe, expect, it } from 'vitest';
import { createEconomy } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { ActivityTracker, NO_PROGRESS, orderOf, progressBetween, robotDuty, type Probe } from './robotActivity';

const base: Probe = { pallets: [{ id: 1, total: 40 }, { id: 2, total: 20 }], backroom: 100, bags: 3, cleanliness: 80, served: 500 };

describe('progressBetween', () => {
  it('bez poprzedniej próbki nic nie poszło do przodu', () => {
    expect(progressBetween(null, base)).toEqual(NO_PROGRESS);
  });

  it('ten sam stan to brak postępu', () => {
    expect(progressBetween(base, { ...base })).toEqual(NO_PROGRESS);
  });

  it('ubytek na palecie albo jej zniknięcie to rozładunek, a nowa paleta nim nie jest', () => {
    expect(progressBetween(base, { ...base, pallets: [{ id: 1, total: 34 }, { id: 2, total: 20 }] }).unload).toBe(true);
    expect(progressBetween(base, { ...base, pallets: [{ id: 2, total: 20 }] }).unload).toBe(true);
    expect(progressBetween(base, { ...base, pallets: [...base.pallets, { id: 3, total: 60 }] }).unload).toBe(false);
  });

  it('ubytek towaru na zapleczu to wykładanie, a przyrost (dostawa) nie', () => {
    expect(progressBetween(base, { ...base, backroom: 90 }).restock).toBe(true);
    expect(progressBetween(base, { ...base, backroom: 140 }).restock).toBe(false);
  });

  it('worki ubywają: śmieci; czystość rośnie: mycie; klienci rosną: kasa', () => {
    const p = progressBetween(base, { ...base, bags: 2, cleanliness: 81, served: 503 });
    expect(p).toMatchObject({ bags: true, clean: true, till: true, unload: false, restock: false });
  });

  it('ułamki poniżej progu to zaokrąglenia, nie praca', () => {
    expect(progressBetween(base, { ...base, backroom: 100 - 1e-9, cleanliness: 80 + 1e-9 })).toEqual(NO_PROGRESS);
  });
});

describe('robotDuty', () => {
  const all = { unload: true, restock: true, bags: true, clean: true, till: true };
  it('bierze pierwsze zadanie z kolejności gracza, przy którym coś poszło do przodu', () => {
    expect(robotDuty(all, ['kasa', 'wykladanie', 'rozladunek', 'sprzatanie'])).toBe('kasa');
    expect(robotDuty(all, ['rozladunek', 'kasa', 'wykladanie', 'sprzatanie'])).toBe('rozladunek');
    expect(robotDuty({ ...all, till: false, unload: false }, ['rozladunek', 'kasa', 'wykladanie', 'sprzatanie'])).toBe('wykladanie');
  });

  it('sprzątanie to worki albo podłoga', () => {
    expect(robotDuty({ ...NO_PROGRESS, bags: true }, ['sprzatanie'])).toBe('sprzatanie');
    expect(robotDuty({ ...NO_PROGRESS, clean: true }, ['sprzatanie'])).toBe('sprzatanie');
  });

  it('bez pracy robot jest wolny', () => {
    expect(robotDuty(NO_PROGRESS, ['kasa', 'wykladanie', 'rozladunek', 'sprzatanie'])).toBe('wolny');
  });
});

describe('ActivityTracker', () => {
  const layout = generateStore('kielbasa-42');
  const info = computeStoreInfo(layout);

  it('pierwsza próbka bez postępu, kolejna porównuje ze stanem gry', () => {
    const s = createEconomy('kielbasa-42', info);
    const tracker = new ActivityTracker();
    expect(tracker.update(s)).toEqual(NO_PROGRESS);
    for (const c of Object.keys(s.backroom) as Array<keyof typeof s.backroom>) s.backroom[c] -= 1;
    s.total.customers += 2;
    expect(tracker.update(s)).toMatchObject({ restock: true, till: true });
    expect(tracker.update(s)).toEqual(NO_PROGRESS);
  });

  it('kolejność zadań czyta z puli ludzi gracza', () => {
    const s = createEconomy('kielbasa-42', info);
    expect(orderOf(s)).toEqual(['kasa', 'wykladanie', 'rozladunek', 'sprzatanie']);
  });
});
