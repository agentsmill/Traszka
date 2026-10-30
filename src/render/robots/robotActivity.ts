import type { EconomyState } from '@/sim/economy/economy';
import { effectiveOrder } from '@/sim/economy/tycoon/staff';
import type { StaffDuty, StaffTask } from '@/render/staff/types';

// Co w sklepie właśnie szło do przodu, a więc czym zajmowały się roboty. Symulacja liczy pracę zbiorczo (osobominuty), nie ma
// w niej „taśmociąg stoi przy palecie 3”, więc widok odczytuje postęp ze zmian stanu między dwiema synchronizacjami:
// - paleta ubywa (albo znika): rozładunek,
// - zaplecze ubywa towaru: wykładanie (zaplecze tylko przybywa z palet, a ubywa wyłącznie przez wykładanie na półki),
// - ubywa worków: śmieci, a rośnie czystość sali: mycie podłogi,
// - rośnie licznik obsłużonych klientów: kasa.
// Robot ma w przydziale pierwszeństwo przed ludźmi (`allocateStaff`), więc gdzie praca poszła do przodu, tam machina pracowała.
// Nic stąd nie wraca do symulacji, a moduł nie zna zasad przydziału: zmiana reguł w ekonomii nie rozjedzie widoku.

/** Wycinek stanu gry, z którego liczy się postęp (kolejność zadań gracza dochodzi osobno, w `robotDuty`). */
export interface Probe {
  /** Palety z ich zawartością: ubytek albo zniknięcie to rozładunek. */
  pallets: ReadonlyArray<{ id: number; total: number }>;
  /** Towar na zapleczu, razem (sztuki). */
  backroom: number;
  /** Worki ze śmieciami: na zapleczu i w sali. */
  bags: number;
  /** Czystość sali, 0…100. */
  cleanliness: number;
  /** Klienci obsłużeni od początku gry. */
  served: number;
}

/** Które prace poszły do przodu między dwiema próbkami. */
export interface Progress { unload: boolean; restock: boolean; bags: boolean; clean: boolean; till: boolean }

export const NO_PROGRESS: Readonly<Progress> = { unload: false, restock: false, bags: false, clean: false, till: false };

/** Mniej niż to nie jest postępem (zaokrąglenia ułamków sztuk). */
const EPS = 1e-6;

const sumOf = (r: Record<string, number>): number => Object.values(r).reduce((n, v) => n + v, 0);

/** Próbka stanu ekonomii. Czyta tylko pola, które i tak widać w grze; niczego nie zmienia. */
export function probeOf(s: EconomyState): Probe {
  return {
    pallets: s.pallets.map((p) => ({ id: p.id, total: p.total })),
    backroom: sumOf(s.backroom),
    bags: s.tycoon.waste.backroom + s.tycoon.waste.hall,
    cleanliness: s.tycoon.hall.cleanliness,
    served: s.total.customers,
  };
}

/** Postęp między próbkami `before` i `after`. Bez poprzedniej próbki (pierwsza po wczytaniu sklepu) nic nie poszło do przodu. */
export function progressBetween(before: Probe | null, after: Probe): Progress {
  if (!before) return { ...NO_PROGRESS };
  const now = new Map(after.pallets.map((p) => [p.id, p.total]));
  const unload = before.pallets.some((p) => {
    const total = now.get(p.id);
    return total === undefined || total < p.total - EPS;
  });
  return {
    unload,
    restock: after.backroom < before.backroom - EPS,
    bags: after.bags < before.bags - EPS,
    clean: after.cleanliness > before.cleanliness + EPS,
    till: after.served > before.served + EPS,
  };
}

/** Postęp pracy przypisanej do zadania ekonomii. */
const progressed = (p: Progress, task: StaffTask): boolean => {
  switch (task) {
    case 'kasa': return p.till;
    case 'rozladunek': return p.unload;
    case 'wykladanie': return p.restock;
    case 'sprzatanie': return p.bags || p.clean;
  }
};

/**
 * Zadanie eDwarda: pierwsze z kolejności gracza (`effectiveOrder`: profil albo własna), przy którym coś poszło do przodu. Tak samo
 * ekonomia wybiera mu pracę (robot bierze zadania w tej kolejności), a bez pracy stoi i się ładuje (`'wolny'`).
 */
export function robotDuty(p: Progress, order: readonly StaffTask[]): StaffDuty {
  return order.find((t) => progressed(p, t)) ?? 'wolny';
}

/** Kolejność zadań gracza z jego puli ludzi (profil albo własna). */
export const orderOf = (s: EconomyState): readonly StaffTask[] => effectiveOrder(s.tycoon.staff);

/** Pamięta ostatnią próbkę. Jeden na sklep: nowy sklep (remont, nowy seed) to nowy tracker, więc nie ma skoku przez zmianę świata. */
export class ActivityTracker {
  private last: Probe | null = null;

  /** Dodaje próbkę stanu i mówi, co poszło do przodu od poprzedniej. */
  update(s: EconomyState): Progress {
    const now = probeOf(s);
    const progress = progressBetween(this.last, now);
    this.last = now;
    return progress;
  }
}
