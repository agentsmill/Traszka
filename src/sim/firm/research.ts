/*
 * Badania Sieci (spec etapu 4b §5.3): poziomy badań leżą w `FirmState.research` i działają na wszystkie sklepy od dwóch otwartych. Tu na razie
 * tylko identyfikatory i najwyższe poziomy z tabeli §5.3, których potrzebuje odczyt zapisu (przycinanie poziomów). Definicje badań (pole
 * `NetMods`, efekt, ceny) dochodzą osobno i mają brać `maxLevel` stąd, żeby zapis i gra znały ten sam sufit.
 */

export type ResearchId = 'dostawy' | 'obsada' | 'marketing' | 'magazyn' | 'lojalnosc' | 'media';

/** Badania w kolejności tabeli §5.3; w tej kolejności zapis odtwarza też `FirmState.research`. */
export const RESEARCH_IDS: readonly ResearchId[] = ['dostawy', 'obsada', 'marketing', 'magazyn', 'lojalnosc', 'media'];

/** Najwyższy poziom każdego badania (kolumna „max” tabeli §5.3). */
export const RESEARCH_MAX_LEVEL: Readonly<Record<ResearchId, number>> = {
  dostawy: 3, obsada: 4, marketing: 5, magazyn: 3, lojalnosc: 5, media: 3,
};
