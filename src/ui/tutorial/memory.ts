/*
 * Pamięć samouczka w przeglądarce (`traszka:tutorial`): czy gracz odpowiedział na okno wyboru i jak skończył przelot, które dymki
 * „pierwszy raz” już widział i czy chce je dostawać. Wspólna dla wszystkich sklepów i poza zapisem gry, mety i pakietem kodu
 * odzyskiwania. Każdy odczyt i zapis czyta `globalThis.localStorage` od nowa (testy podmieniają magazyn) i jest w `try/catch`:
 * zepsuty wpis albo przeglądarka bez magazynu dają wartości domyślne, a nieudany zapis jest cichy.
 */

export const TUTORIAL_KEY = 'traszka:tutorial';

/** Dymki „pierwszy raz” w kolejności, w jakiej warstwa je pokazuje (spec samouczka, §5). */
export const TIP_IDS = ['tip-cel', 'tip-przejscia', 'tip-karta', 'tip-wyciag', 'tip-remanent'] as const;
export type TipId = (typeof TIP_IDS)[number];

/** `null`: gracz nie odpowiedział jeszcze na okno wyboru; `started`: wybrał samouczek; `skipped`: pominął; `done`: przeszedł do końca. */
export type TourState = 'started' | 'skipped' | 'done';

export interface TutorialMemory {
  v: 1;
  tour: TourState | null;
  /** Dymki „pierwszy raz”, które już się pokazały (każdy najwyżej raz na przeglądarkę). */
  seen: TipId[];
  /** Pole „Podpowiedzi przy pierwszych zdarzeniach” w ⚙. */
  tips: boolean;
}

const defaults = (): TutorialMemory => ({ v: 1, tour: null, seen: [], tips: true });
const TOURS: readonly string[] = ['started', 'skipped', 'done'];
const isTipId = (x: unknown): x is TipId => typeof x === 'string' && (TIP_IDS as readonly string[]).includes(x);

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;   // dostęp do `localStorage` potrafi rzucić sam (zablokowane ciasteczka)
  }
}

/** Pamięć z przeglądarki, oczyszczona: obce pola znikają, nieznane i powtórzone dymki też. */
export function loadTutorial(): TutorialMemory {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(TUTORIAL_KEY) ?? null;
  } catch {
    return defaults();
  }
  if (raw === null) return defaults();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaults();
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return defaults();
  const d = data as Record<string, unknown>;
  const seen = Array.isArray(d.seen) ? [...new Set(d.seen.filter(isTipId))] : [];
  return {
    v: 1,
    tour: typeof d.tour === 'string' && TOURS.includes(d.tour) ? (d.tour as TourState) : null,
    seen,
    tips: typeof d.tips === 'boolean' ? d.tips : true,
  };
}

/** Zapisuje pamięć; błąd przeglądarki (brak miejsca, tryb prywatny) jest cichy. */
export function saveTutorial(mem: TutorialMemory): void {
  try {
    storage()?.setItem(TUTORIAL_KEY, JSON.stringify(mem));
  } catch {
    // gra działa dalej: najwyżej okno wyboru albo dymek pokaże się jeszcze raz
  }
}

/** Stan przelotu. „Pominięty” nie nadpisuje „przejścia do końca”: gracz, który raz przeszedł samouczek, przeszedł go. */
export function setTour(tour: TourState): void {
  const mem = loadTutorial();
  if (tour === 'skipped' && mem.tour === 'done') return;
  saveTutorial({ ...mem, tour });
}

/** Dymek się pokazał: drugi raz już nie wyskoczy. Nieznany identyfikator nic nie zmienia. */
export function markSeen(id: string): void {
  if (!isTipId(id)) return;
  const mem = loadTutorial();
  if (mem.seen.includes(id)) return;
  saveTutorial({ ...mem, seen: [...mem.seen, id] });
}

/** Pole „Podpowiedzi przy pierwszych zdarzeniach” w ⚙. */
export function setTips(on: boolean): void {
  saveTutorial({ ...loadTutorial(), tips: on });
}
