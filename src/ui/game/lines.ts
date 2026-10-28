import type { Cat } from '@/sim/economy/catalog';

/**
 * Wypowiedzi klientów w dymkach (spec §6.1, ton z §4: ciepła satyra, celujemy w system, nie w ludzi przy kasie).
 * Wybór zależy od sytuacji w sklepie, a w spokojne chwile leci coś z ogólnej puli.
 */
export const LINES = {
  queue: ['Znowu kolejka…', 'Ja tylko po bułkę!', 'Czemu jedna kasa?!', 'Szybciej, autobus mi ucieka', 'Może tam jest samoobsługowa?'],
  pallets: ['Kto tu postawił paletę?', 'Slalom między paletami 🙄', 'Przepraszam, którędy do lodówek?'],
  sco: ['„Nieoczekiwany przedmiot w strefie pakowania”', 'Ta kasa mnie nie lubi', 'O, samoobsługa. Szybko!'],
  happy: ['Kocham Traszdogi 🌭', 'Zawsze pod ręką!', 'Dobrze, że jest otwarte', 'Ogonki wpadły 🦎', 'Kawa i do pracy ☕', 'Jeszcze tylko jedna promocja…'],
  night: ['Jeszcze otwarte? Super!', 'Ostatni hot-dog dnia 🌭'],
  rush: ['Słyszałem, że dziś promocja!', 'Ale tłum!', 'Wszyscy po to samo?'],
} as const;

const MISSING: Record<Cat, string> = {
  napoje: 'Gdzie są napoje?!',
  nabial: 'Mleka nie ma?',
  slodycze: 'Pusto na słodyczach…',
  przekaski: 'Chipsy się skończyły?!',
  pieczywo: 'Bułek nie ma, serio?',
  chemia: 'Papier toaletowy, gdzie?',
  alkohol: 'Piwa brak?!',
};

export function missingLine(c: Cat): string {
  return MISSING[c];
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
