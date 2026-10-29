import type { PalletRef, StaffAssignment, StaffDuty } from '@/render/staff/types';
import { isOpenAt, minuteOfDay } from '@/sim/economy/calendar';
import { CATS, STAFF_MAX } from '@/sim/economy/catalog';
import type { EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';

// Tymczasowy most między ekonomią sprzed etapu 2C2 a warstwą ludzi. Tylko czyta stan: to, kto co robi, ma być obrazem
// tego, co robi `stepMinute`, a nie drugim źródłem prawdy, więc nic tu nie wolno zapisać do `EconomyState`.

/** Półka zapełniona w mniej niż tej części pojemności jest pilna: `doWork` wykłada ją przed rozładunkiem palet (economy.ts, krok 1). */
const URGENT_FILL = 0.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Pilne wykładanie: jakaś kategoria ma pustą połowę półki i towar na zapleczu (kategoria bez półki nie liczy się). */
const hasUrgentRestock = (s: EconomyState, info: StoreInfo): boolean =>
  CATS.some((c) => info.shelfCap[c] > 0 && s.shelf[c] / info.shelfCap[c] < URGENT_FILL && s.backroom[c] > 0);

/** Dokładanie do pełna: jakaś kategoria ma wolne miejsce na półce i towar na zapleczu. */
const hasRestockWork = (s: EconomyState, info: StoreInfo): boolean =>
  CATS.some((c) => s.shelf[c] < info.shelfCap[c] && s.backroom[c] > 0);

/**
 * Tymczasowy adapter: ekonomia sprzed etapu 2C2 → lista osób na zmianie. Po C2 zastąpi go `staffOnShift(state)`.
 * Odzwierciedla kolejność z `doWork`: kasa, pilne wykładanie, rozładunek palet, na końcu dokładanie do pełna.
 */
export function staffFromEconomy(s: EconomyState, info: StoreInfo): StaffAssignment[] {
  // personel pracuje tylko w godzinach otwarcia, także w czasie remontu (wtedy nikt nie stoi na kasie)
  if (!isOpenAt(minuteOfDay(s.minute))) return [];

  // zatrudnienie dodaje osobę o największym id, a zwolnienie zabiera tę o największym
  const n = clamp(Math.floor(s.staff), 0, STAFF_MAX);
  // `doWork` zapisuje przydział w każdej minucie, także zamkniętej (wtedy 0 i 0), więc w pierwszej minucie po otwarciu
  // `lastCashiers` pochodzi jeszcze z nocy. Bez żadnego przydziału na kasie staje pierwsza osoba, żeby rano nikt nie zaczynał na zapleczu.
  const allocated = s.lastCashiers > 0 || s.lastWorkers > 0;
  const cashiers = allocated ? clamp(s.lastCashiers, 0, n) : Math.min(n, 1);
  const pallets = s.pallets.filter((p) => p.total > 0).length;
  const urgent = hasUrgentRestock(s, info);
  const topUp = hasRestockWork(s, info);

  const out: StaffAssignment[] = [];
  let unloading = 0;
  for (let id = 0; id < n; id++) {
    let task: StaffDuty;
    if (id < cashiers) {
      task = 'kasa';
    } else if (urgent && id === cashiers) {
      task = 'wykladanie';
    } else if (unloading < pallets) {
      unloading++;
      task = 'rozladunek';
    } else {
      task = topUp ? 'wykladanie' : 'wolny';
    }
    out.push({ id, task });
  }
  return out;
}

/** Palety z niezerowym towarem, z miejscami z `info.spots` (palety bez znanego miejsca pomijamy). Tylko odczyt. */
export function palletRefsOf(s: EconomyState, info: StoreInfo): PalletRef[] {
  const out: PalletRef[] = [];
  for (const p of s.pallets) {
    if (p.total <= 0) continue;
    const spot = info.spots[p.loc][p.spot];
    // kopia, żeby widok nie miał w ręku obiektu, który należy do informacji o sklepie
    if (spot) out.push({ loc: p.loc, spot: { ...spot }, since: p.since });
  }
  return out;
}
