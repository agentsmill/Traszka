import type { EconomyState } from './economy';
import type { StoreInfo } from './storeInfo';

/** Kamienie milowe: cele na najbliższe minuty gry, nagroda w Ogonkach i krótki komunikat. */
export interface Milestone {
  id: string;
  label: string;
  /** Podpowiedź, jak to zrobić (lista celów w zakładce Wyniki). */
  hint: string;
  reward: number;
  done(s: EconomyState, info: StoreInfo): boolean;
}

const sco = (s: EconomyState): number => s.equipment.filter((e) => e.id === 'sco').length;
const lvl = (s: EconomyState, id: keyof EconomyState['upgrades']): number => s.upgrades[id] ?? 0;

export const MILESTONES: readonly Milestone[] = [
  { id: 'pallet1', label: 'Pierwsza paleta rozładowana', hint: 'Stukaj w palety albo w przycisk „Rozładuj”', reward: 5, done: (s) => s.total.palletsUnloaded >= 1 },
  { id: 'upgrade1', label: 'Pierwsze ulepszenie', hint: 'Kup coś w zakładce Sklep → Ulepszenia', reward: 5, done: (s) => Object.values(s.upgrades).some((v) => (v ?? 0) > 0) },
  { id: 'cust500', label: '500 obsłużonych klientów', hint: 'Dbaj o kolejkę i pełne półki', reward: 10, done: (s) => s.total.customers >= 500 },
  { id: 'sco1', label: 'Pierwsza kasa samoobsługowa', hint: 'Stuknij w pomarańczowy slot w sklepie', reward: 10, done: (s) => sco(s) >= 1 },
  { id: 'staff3', label: 'Zespół marzeń: 3 osoby na zmianie', hint: 'Zatrudnij w zakładce Ludzie', reward: 5, done: (s) => s.staff >= 3 },
  { id: 'earned10k', label: '10 000 zł marży', hint: 'Sprzedawaj więcej, gub mniej', reward: 10, done: (s) => s.total.margin >= 10_000 },
  { id: 'month1', label: 'Pierwszy miesiąc na plusie', hint: 'Dotrwaj do raportu z zyskiem', reward: 20, done: (s) => s.history.some((h) => h.profit > 0) },
  { id: 'cust5k', label: '5 000 obsłużonych klientów', hint: 'Ulotki i reputacja ściągają ludzi', reward: 15, done: (s) => s.total.customers >= 5000 },
  { id: 'sco4', label: 'Armia SCO: 4 kasy samoobsługowe', hint: 'Slot 2×2 mieści dwie kasy', reward: 20, done: (s) => sco(s) >= 4 },
  { id: 'remont1', label: 'Pierwszy remont', hint: 'Remont powiększa sklep i daje sloty', reward: 25, done: (s) => s.remontLevel >= 1 },
  { id: 'workshop', label: 'Złota rączka: pierwsza automatyka', hint: 'Warsztat odblokujesz na 10. poziomie', reward: 25, done: (s) => lvl(s, 'tasmociag') >= 1 },
  { id: 'earned250k', label: 'Ćwierć miliona marży', hint: 'Skaluj sklep i automatykę', reward: 40, done: (s) => s.total.margin >= 250_000 },
  { id: 'sco8', label: 'Osiem kas samoobsługowych', hint: 'Po remoncie jest więcej slotów', reward: 40, done: (s) => sco(s) >= 8 },
  { id: 'flagowiec', label: 'Flagowiec', hint: 'Trzeci remont', reward: 60, done: (s) => s.remontLevel >= 3 },
  { id: 'edward', label: 'eDward przejmuje zmianę', hint: 'Humanoid z warsztatu', reward: 100, done: (s) => lvl(s, 'humanoid') >= 1 },
];
