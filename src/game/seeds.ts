/** Ile razy losujemy seed, zanim zaczniemy numerować ostatnie losowanie. Seedów jest 45 000, więc kolizja jest rzadka. */
const DRAWS = 20;

/** Najwyższy numer dopisywany do seeda. Prawdziwy magazyn ma skończenie wiele zapisów; ten limit tylko chroni przed zawieszeniem strony, gdyby `isTaken` kłamało. */
const MAX_NUMBER = 1000;

/**
 * Seed nowego sklepu, pod którym nic jeszcze nie leży: nowa gra (`fresh`) nie czyta zapisu, a pierwszy zapis po otwarciu
 * zastąpiłby cudzy, więc losowy seed nie może trafić w seed z zapisem (poprawnym, uszkodzonym ani z nowszej wersji gry).
 * Losuje do 20 razy; gdy każdy z 20 jest zajęty, dopisuje do ostatniego `·2`, `·3`… i bierze pierwszy wolny (po `MAX_NUMBER`
 * numerach oddaje ostatni, żeby nie zawiesić strony przy magazynie, który twierdzi, że zajęte jest wszystko).
 * `draw` to losowanie seeda (`randomSeed`), `isTaken` mówi, czy pod seedem leży zapis (`hasStoredSave`).
 */
export function freeSeed(draw: () => string, isTaken: (seed: string) => boolean): string {
  let last = '';
  for (let i = 0; i < DRAWS; i++) {
    last = draw();
    if (!isTaken(last)) return last;
  }
  let numbered = last;
  for (let n = 2; n <= MAX_NUMBER; n++) {
    numbered = `${last}·${n}`;
    if (!isTaken(numbered)) return numbered;
  }
  return numbered;
}
