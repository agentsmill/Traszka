import type { EconomyState } from '@/sim/economy/economy';
import { UNBUILDABLE_SAVE_NOTICE, createSession, hasStoredSave, withLayoutFromSeed, type GameSession } from './session';

export interface OpenRequest {
  /** Sklep, który gracz chce zobaczyć (adres, ostatnio grany albo losowy). */
  seed: string;
  /** Nowa gra zamiast zapisu (`?new=1`). */
  fresh: boolean;
  /** Premia z sieci sklepów (meta.ts). */
  partner?: EconomyState['partner'];
  randomSeed: () => string;
  /**
   * Buduje świat sesji w scenie (w grze: ustawia ją jako bieżącą i woła `load`). Rzuca, gdy się nie da, i nie zostawia po sobie
   * nic w scenie (`loadStore` sprząta), więc kolejna próba zaczyna od czystej sceny.
   */
  build: (session: GameSession) => void;
}

/** Ile losowych sklepów próbujemy, gdy żaden z oczekiwanych nie wstaje, zanim poddamy się z wyjątkiem. */
const RANDOM_TRIES = 3;

const unableToOpen = (seed: string): string => `Nie udało się otworzyć sklepu „${seed}”. Zaczynamy w nowym.`;

/**
 * Otwiera sklep przy starcie tak, żeby start nigdy nie zapętlił się na wyjątku, a dobry zapis nigdy nie przepadł z powodu
 * świata, który się nie zbudował (błąd renderowania, generator). Kolejność, gdy `build` rzuca:
 * 1. zapis, który przeszedł walidację: jeszcze raz z układem odtworzonym z seeda i poziomu remontu (zapisany układ mógł
 *    być powodem); gdy i to zawiedzie, zapis zostaje na miejscu, jakim był, a gra rusza w sklepie tymczasowym (świeża gra na
 *    tym seedzie, potem na losowym; nic jej nie zapisze) z komunikatem, że zapis jest bezpieczny;
 * 2. sklep tymczasowy (zapis z nowszej wersji gry): tymczasowy sklep o losowym seedzie, ten sam komunikat;
 * 3. nowa gra, której nie zbudował sam seed (zapisu do ochrony nie ma; uszkodzony poszedł już do kopii): losowy sklep.
 * Do kopii `:broken` trafia wyłącznie zapis, który nie przeszedł parsowania ani walidacji (`createSession`). Gdy nic się nie
 * zbuduje, rzuca ostatni wyjątek (renderer nie działa; nic więcej nie da się zrobić).
 */
export function openStore({ seed, fresh, partner, randomSeed, build }: OpenRequest): GameSession {
  let lastError: unknown = null;
  const fail = (what: string, error: unknown): void => {
    lastError = error;
    console.error(what, error);
  };
  const built = (s: GameSession): boolean => {
    try {
      build(s);
      return true;
    } catch (error) {
      fail(`Nie udało się zbudować sklepu „${s.seed}”.`, error);
      return false;
    }
  };
  /** Świeża gra w sklepie `target` (tymczasowa albo zwykła) z komunikatem; null, gdy się nie zbudowała. */
  const standIn = (target: string, ephemeral: boolean, notice: string): GameSession | null => {
    try {
      const s = createSession(target, true, partner, { ephemeral });
      s.loadNotice = notice;
      return built(s) ? s : null;
    } catch (error) {
      fail(`Nie udało się otworzyć sklepu „${target}”.`, error);
      return null;
    }
  };
  const somewhereElse = (ephemeral: boolean, notice: string): GameSession => {
    for (let i = 0; i < RANDOM_TRIES; i++) {
      const s = standIn(randomSeed(), ephemeral, notice);
      if (s) return s;
    }
    throw lastError;
  };

  let first: GameSession;
  try {
    first = createSession(seed, fresh, partner);
  } catch (error) {
    // generator nie daje sklepu z tego seeda (a gdy pod nim leży zapis, to zapis jest cały i zostaje)
    fail(`Nie udało się otworzyć sklepu „${seed}”.`, error);
    const kept = !fresh && hasStoredSave(seed);
    return somewhereElse(kept, kept ? UNBUILDABLE_SAVE_NOTICE : unableToOpen(seed));
  }
  if (built(first)) return first;

  if (first.fromSave && !first.ephemeral) {
    try {
      const again = withLayoutFromSeed(first);
      if (built(again)) return again;
    } catch (error) {
      fail(`Nie udało się odtworzyć układu sklepu „${seed}” z seeda.`, error);
    }
    return standIn(seed, true, UNBUILDABLE_SAVE_NOTICE) ?? somewhereElse(true, UNBUILDABLE_SAVE_NOTICE);
  }
  if (first.ephemeral) return somewhereElse(true, first.loadNotice ?? UNBUILDABLE_SAVE_NOTICE);
  return somewhereElse(false, [first.loadNotice, unableToOpen(seed)].filter(Boolean).join(' '));
}
