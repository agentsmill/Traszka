import { describe, expect, it } from 'vitest';
import {
  WASTE, addWaste, closeWasteMonth, createWaste, hallObstacle, palletBags, removeWaste, sanitizeWaste, settleWaste,
  wasteDemand, wasteMinute, wasteSpots, wasteWork, type WasteState,
} from './waste';

describe('śmieci z rozładunku', () => {
  it('paleta zostawia jeden worek, a paleta napojów w folii dwa', () => {
    expect(palletBags({ napoje: 80, nabial: 40, slodycze: 50, przekaski: 50, pieczywo: 45, chemia: 15, alkohol: 40 })).toBe(1);
    expect(palletBags({ napoje: 200, nabial: 40, slodycze: 80 })).toBe(2);
    expect(palletBags({})).toBe(1);
  });

  it('worki zajmują miejsca na zapleczu (te same co palety), a nadmiar ląduje w sali', () => {
    const w = createWaste();
    expect(addWaste(w, 3, 2)).toEqual({ backroom: 3, hall: 0 });
    expect(wasteSpots(w)).toBe(1);
    expect(addWaste(w, 7, 2)).toEqual({ backroom: 5, hall: 2 });
    expect(w.backroom).toBe(2 * WASTE.bagsPerSpot);
    expect(w.hall).toBe(2);
    expect(wasteSpots(w)).toBe(2);
    expect(w.month.produced).toBe(10);
  });

  it('pełne zaplecze (palety na wszystkich miejscach): wszystko idzie do sali jako przeszkoda', () => {
    const w = createWaste();
    addWaste(w, 4, 0);
    expect(w.hall).toBe(4);
    expect(hallObstacle(w)).toBe(1);
  });

  it('paleta zajęła miejsce: worki, które się nie mieszczą, przechodzą do sali', () => {
    const w = createWaste();
    addWaste(w, 6, 3);
    expect(settleWaste(w, 3)).toBe(0);
    expect(settleWaste(w, 1)).toBe(2);
    expect(w.backroom).toBe(4);
    expect(w.hall).toBe(2);
  });

  it('wynoszenie zaczyna od sali; prasa do kartonów skraca czas na worek', () => {
    const w = createWaste();
    addWaste(w, 4, 0);
    addWaste(w, 2, 2);
    expect(wasteWork(w, false)).toBe(6 * WASTE.bagMinutes);
    expect(wasteWork(w, true)).toBe(6 * WASTE.pressBagMinutes);
    expect(removeWaste(w, 3 * WASTE.bagMinutes, false)).toBe(3 * WASTE.bagMinutes);
    expect(w.hall).toBe(1);
    expect(w.backroom).toBe(2);
    expect(removeWaste(w, 100, true)).toBe(3 * WASTE.pressBagMinutes);
    expect(w.hall + w.backroom).toBe(0);
    expect(w.month.removed).toBe(6);
  });

  it('zapotrzebowanie: najwyżej jedna osoba naraz, zero, gdy nie ma śmieci', () => {
    const w = createWaste();
    expect(wasteDemand(w, false)).toBe(0);
    addWaste(w, 0.1, 2);
    expect(wasteDemand(w, false)).toBeCloseTo(0.5);
    addWaste(w, 5, 2);
    expect(wasteDemand(w, false)).toBe(WASTE.maxPeople);
  });

  it('miesiąc liczy worko-minuty w sali i zeruje się w raporcie', () => {
    const w = createWaste();
    addWaste(w, 2, 0);
    for (let i = 0; i < 30; i++) wasteMinute(w);
    expect(closeWasteMonth(w)).toEqual({ produced: 2, removed: 0, hallBagMinutes: 60 });
    expect(w.month.hallBagMinutes).toBe(0);
    expect(w.hall).toBe(2);
  });

  it('zapis: JSON w obie strony, śmieci w zapisie dają zero', () => {
    const w = createWaste();
    addWaste(w, 9, 1);
    const copy = JSON.parse(JSON.stringify(w)) as WasteState;
    expect(sanitizeWaste(copy)).toEqual(w);
    expect(sanitizeWaste({ backroom: -3, hall: 'dużo', month: null })).toEqual(createWaste());
  });
});
