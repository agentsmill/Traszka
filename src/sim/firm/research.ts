import { powInt } from '@/sim/economy/exactMath';
import type { NetMods } from '@/sim/economy/site';
import type { FirmRefusal, FirmState } from './types';

/*
 * Badania Sieci (spec etapu 4b §5.3): poziomy badań leżą w `FirmState.research` i działają na wszystkie sklepy od dwóch otwartych. Każde badanie
 * zmienia jedno pole `NetMods` (`1 ± min(cap, perLevel × poziom × skala)`), a skala zależy od liczby otwartych sklepów i rośnie coraz wolniej
 * (`NET_SCALE`): drugi sklep dokłada najwięcej, każdy kolejny mniej. Płaci się gotówką z portfela osoby, bez rat; poziom zostaje na zawsze,
 * także gdy sieć zmaleje do jednego sklepu (wtedy badania nie działają: `netMods` daje null). Do sklepu badania docierają przez
 * `SiteMods.net` (`refreshSites`), a ekonomia czyta je za gałęzią w sześciu miejscach (`economy.ts`). Moduł nie importuje `firm.ts`, bo ten
 * woła stąd `netMods`; stan sklepów czyta wprost z `FirmState`.
 */

export type ResearchId = 'dostawy' | 'obsada' | 'marketing' | 'magazyn' | 'lojalnosc' | 'media';

/** Badania w kolejności tabeli §5.3; w tej kolejności zapis odtwarza też `FirmState.research`. */
export const RESEARCH_IDS: readonly ResearchId[] = ['dostawy', 'obsada', 'marketing', 'magazyn', 'lojalnosc', 'media'];

/** Najwyższy poziom każdego badania (kolumna „max” tabeli §5.3). */
export const RESEARCH_MAX_LEVEL: Readonly<Record<ResearchId, number>> = {
  dostawy: 3, obsada: 4, marketing: 5, magazyn: 3, lojalnosc: 5, media: 3,
};

/**
 * Definicja badania. `field` to pole `NetMods`, które badanie zmienia, `sign` kierunek (+1 podnosi mnożnik, −1 obniża), `perLevel` zmiana mnożnika
 * na poziom przy skali 1, `cap` największa zmiana mnożnika (po skali), a `baseCost × costMult^poziom` cena kolejnego poziomu (`researchCost`).
 * Tekst `name`, `effect` i `flavor` jest po polsku; angielski tłumaczy `tr` (`src/i18n/en/ui/firm.ts`).
 */
export interface ResearchDef {
  id: ResearchId;
  name: string;
  effect: string;
  flavor: string;
  field: keyof NetMods;
  sign: 1 | -1;
  perLevel: number;
  cap: number;
  maxLevel: number;
  baseCost: number;
  costMult: number;
}

/** Sześć badań z tabeli §5.3, w kolejności `RESEARCH_IDS`. Wartości przepisane z tabeli; `maxLevel` bierze `RESEARCH_MAX_LEVEL`. */
export const RESEARCH: readonly ResearchDef[] = [
  {
    id: 'dostawy', name: 'Wspólne dostawy', effect: 'Niższa opłata za palety ponad przydział we wszystkich sklepach',
    flavor: 'Jeden kierowca, pięć sklepów i ani jednej palety więcej, niż trzeba. Centrala dziwi się, że to w ogóle możliwe.',
    field: 'logistics', sign: -1, perLevel: 0.10, cap: 0.60, maxLevel: RESEARCH_MAX_LEVEL.dostawy, baseCost: 25_000, costMult: 2.0,
  },
  {
    id: 'obsada', name: 'Wspólna obsada (grafik sieci)', effect: 'Niższe płace dnia we wszystkich sklepach',
    flavor: 'Grafik sieci przesuwa ludzi tam, gdzie akurat brakuje rąk. Ludzie dowiadują się o tym w drodze do pracy.',
    field: 'wages', sign: -1, perLevel: 0.03, cap: 0.25, maxLevel: RESEARCH_MAX_LEVEL.obsada, baseCost: 60_000, costMult: 2.0,
  },
  {
    id: 'marketing', name: 'Wspólny marketing', effect: 'Więcej klientów we wszystkich sklepach',
    flavor: 'Jedna ulotka na pięć sklepów, bo drukarnia daje rabat od nakładu. Hasło brzmi: „Traszka jest wszędzie”.',
    field: 'traffic', sign: 1, perLevel: 0.025, cap: 0.30, maxLevel: RESEARCH_MAX_LEVEL.marketing, baseCost: 50_000, costMult: 1.8,
  },
  {
    id: 'magazyn', name: 'Centralny magazyn', effect: 'Większe zaplecze we wszystkich sklepach',
    flavor: 'To, co nie zmieściło się na zapleczu, leży teraz w hali na obrzeżach miasta. Nikt nie wie, gdzie dokładnie.',
    field: 'backroom', sign: 1, perLevel: 0.10, cap: 0.50, maxLevel: RESEARCH_MAX_LEVEL.magazyn, baseCost: 30_000, costMult: 2.2,
  },
  {
    id: 'lojalnosc', name: 'Program lojalnościowy „Traszka+”', effect: 'Większy koszyk: obrót i marża z klienta we wszystkich sklepach',
    flavor: 'Każdy zakup to punkt, a punkty wymienia się na kolejne zakupy. Centrala nazywa to „mechaniką zaangażowania”.',
    field: 'basket', sign: 1, perLevel: 0.015, cap: 0.20, maxLevel: RESEARCH_MAX_LEVEL.lojalnosc, baseCost: 80_000, costMult: 1.9,
  },
  {
    id: 'media', name: 'Grupa zakupowa prądu', effect: 'Niższe rachunki za media we wszystkich sklepach',
    flavor: 'Jeden sklep nie ma siły przebicia u dostawcy prądu, pięć już się liczy. Dostawca też liczy, tylko inaczej.',
    field: 'media', sign: -1, perLevel: 0.05, cap: 0.30, maxLevel: RESEARCH_MAX_LEVEL.media, baseCost: 35_000, costMult: 2.0,
  },
];

export const RESEARCH_BY_ID: Readonly<Record<ResearchId, ResearchDef>> = Object.fromEntries(RESEARCH.map((d) => [d.id, d])) as Record<ResearchId, ResearchDef>;

/** Skala badań po liczbie otwartych sklepów (indeks): 0 i 1 sklep nie dają nic, każdy kolejny dokłada coraz mniej, od 5 w górę 2. */
export const NET_SCALE = [0, 0, 1, 1.5, 1.8, 2] as const;

/** Skala badań dla `open` otwartych sklepów: z tabeli `NET_SCALE`, od jej końca stała. Liczba spoza dodatnich liczb całkowitych to 0. */
export function netScale(open: number): number {
  const n = Math.floor(open);
  if (!(n > 0)) return 0;
  return NET_SCALE[Math.min(n, NET_SCALE.length - 1)]!;
}

/** Cena kolejnego poziomu badania, gdy ma ono poziom `level`: `baseCost × costMult^level` zaokrąglone do 100 zł (potęga pętlą, `powInt`). */
export function researchCost(def: ResearchDef, level: number): number {
  return Math.round(def.baseCost * powInt(def.costMult, level) / 100) * 100;
}

/** Satyryczna opłata koordynacyjna Centrali: 20% ceny badania, co 100 zł. To tylko opis w interfejsie, symulacja jej nie pobiera osobno. */
export function coordinationFee(cost: number): number {
  return Math.round(cost * 0.2 / 100) * 100;
}

/**
 * Mnożniki badań dla firmy z poziomami `research` i `open` otwartymi sklepami albo null, gdy nic nie działa (mniej niż dwa sklepy albo żadnego
 * badania). Pole każdego kupionego badania to `1 ± min(cap, perLevel × poziom × skala)`, reszta pól 1. Null znaczy, że gałąź `net` w ekonomii
 * jest pominięta: gra jednym sklepem jest wtedy co do bitu taka jak bez badań.
 */
export function netMods(research: FirmState['research'], open: number): NetMods | null {
  const scale = netScale(open);
  if (scale === 0) return null;
  let mods: NetMods | null = null;
  for (const def of RESEARCH) {
    const level = research[def.id] ?? 0;
    if (!(level > 0)) continue;
    mods ??= { traffic: 1, basket: 1, wages: 1, media: 1, logistics: 1, backroom: 1 };
    mods[def.field] = 1 + def.sign * Math.min(def.cap, def.perLevel * level * scale);
  }
  return mods;
}

/**
 * Powód odmowy kupna badania albo null, po kolei: koniec gry, bieg rankingowy, mniej niż dwa otwarte sklepy (`siec`), badanie na najwyższym
 * poziomie (`max`), gotówka (po zapłacie nie mniej niż zero, jak przy wynajmie lokalu). Cenę daje `researchCost` dla obecnego poziomu.
 */
export function researchRefusal(f: FirmState, id: ResearchId): FirmRefusal | null {
  const def = RESEARCH_BY_ID[id];
  if (f.over !== null || f.stores.find((s) => s.id === f.activeId)?.econ.gameOver) return 'over';
  if (f.ranked) return 'ranked';
  if (f.stores.filter((s) => !s.closed).length < 2) return 'siec';
  const level = f.research[id] ?? 0;
  if (level >= def.maxLevel) return 'max';
  if (f.person.wallet - researchCost(def, level) < 0) return 'gotowka';
  return null;
}
