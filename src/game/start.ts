import { DEFAULT_CASHIER_LOOK, type CashierLook } from './cashier';
import type { Meta, Player } from './meta';
import { normalizeNick } from './nick';
import type { OpenRequest } from './openStore';
import { chooseStore, type SeedDeps } from './seeds';

/**
 * Ekran startowy „Twój kasjer”: co z niego wychodzi. Czysta logika bez DOM i three (widok: ui/start/StartScreen.tsx), żeby
 * zasady, które chronią zapisy i nie pozwalają utknąć na dziwnym seedzie, miały testy.
 */

/** Pola ekranu startowego. */
export interface StartForm {
  /** Tekst z pola „Nazwa gracza” (jeszcze niesprawdzony). */
  nick: string;
  /** Tekst z pola „Seed sklepu” (dowolny, jeszcze niesprawdzony). */
  seed: string;
  look: CashierLook;
  /** „Stroje specjalne w losowaniu”. */
  specialOutfits: boolean;
}

/** Wybór gracza gotowy do uruchomienia gry: nick po `normalizeNick`, seed po `chooseStore`, komunikat dla gracza albo null. */
export interface StartChoice {
  nick: string;
  seed: string;
  look: CashierLook;
  specialOutfits: boolean;
  notice: string | null;
}

export type StartSubmit = { ok: true; choice: StartChoice } | { ok: false; nickError: string };

/**
 * Pola przy otwarciu ekranu. Gracz z meta dostaje swój nick, wygląd i przełącznik; pierwsze wejście pusty nick, kasjera
 * domyślnego i przełącznik włączony. Seed podaje wołający: `?seed=` albo ostatnio grany sklep przy wejściu na stronę, wolny
 * losowy seed przy „Nowy sklep” z ⚙. Wygląd w polach to kopia, więc zmiany na ekranie niczego nie ruszają, dopóki gracz nie zatwierdzi.
 */
export function initialStartForm(meta: Meta, seed: string): StartForm {
  const player = meta.player;
  const look = player?.look ?? DEFAULT_CASHIER_LOOK;
  return {
    nick: player?.nick ?? '',
    seed,
    look: { outfit: look.outfit, appearanceSeed: look.appearanceSeed },
    specialOutfits: player?.specialOutfits ?? true,
  };
}

/**
 * „Otwieramy sklep!”: sprawdza nick (zły: komunikat pod polem, nic więcej się nie dzieje, seed i zapisy nietknięte), potem
 * wybiera sklep dla wpisanego seeda (`chooseStore`: zapis pod seedem wygrywa i nigdy nie jest nadpisywany, generator, który nie
 * składa sklepu, daje sąsiedni lokal, dziwny tekst zawsze daje seed, z którego da się zagrać).
 */
export function submitStart(f: StartForm, deps: Partial<SeedDeps> = {}): StartSubmit {
  const nick = normalizeNick(f.nick);
  if (!('nick' in nick)) return { ok: false, nickError: nick.error };
  const store = chooseStore(f.seed, deps);
  return {
    ok: true,
    choice: {
      nick: nick.nick, seed: store.seed, look: { outfit: f.look.outfit, appearanceSeed: f.look.appearanceSeed },
      specialOutfits: f.specialOutfits, notice: store.notice,
    },
  };
}

/** Gracz do zapisania w meta z wyboru na ekranie startowym. */
export const playerOf = (choice: StartChoice): Player => ({
  nick: choice.nick,
  look: { outfit: choice.look.outfit, appearanceSeed: choice.look.appearanceSeed },
  specialOutfits: choice.specialOutfits,
});

/**
 * Prośba o otwarcie sklepu wybranego na ekranie startowym. Nigdy `fresh`: nowa gra pomija zapis, więc pierwszy zapis po niej
 * nadpisałby zapis z nowszej wersji gry albo taki, którego świata nie dało się zbudować (R47). Bez `fresh` seed z zapisem wczytuje
 * ten zapis, a zapis, którego nie wolno ruszyć, daje sklep tymczasowy (`openStore`, `createSession`). Od nowa zaczyna się tylko
 * przez ⚙ w tym sklepie.
 */
export const openRequestFor = (choice: StartChoice, rest: Omit<OpenRequest, 'seed' | 'fresh'>): OpenRequest =>
  ({ ...rest, seed: choice.seed, fresh: false });
