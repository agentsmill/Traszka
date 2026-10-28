import { DEFAULT_CASHIER_LOOK, type CashierLook } from './cashier';
import type { Meta, Player } from './meta';
import { normalizeNick } from './nick';
import type { OpenRequest } from './openStore';
import { EXISTING_STORE_NOTICE, chooseStore, type SeedDeps } from './seeds';
import type { GameSession } from './session';

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

/** Pola sesji, od których zależy, czy komunikat z wyboru sklepu jest prawdziwy (cała `GameSession` nie jest tu potrzebna). */
type OpenedStore = Pick<GameSession, 'seed' | 'fromSave' | 'ephemeral' | 'loadNotice'>;

/**
 * Komunikat z wyboru sklepu (`ResolvedStore.notice`), o ile po otwarciu sklepu nadal jest prawdziwy; inaczej null. Wybór powstaje
 * PRZED otwarciem, więc nie wie, czy zapis się wczytał: „Wczytujemy Twój sklep spod tego seeda” pada tylko wtedy, gdy sklep wstał
 * z zapisu normalnie (nie sklep tymczasowy, nie uszkodzony zapis poszedł do kopii, nie sklep, którego nie dało się zbudować, i nie
 * inny sklep niż wybrany), bo inaczej stałby obok „Zapis sklepu był uszkodzony” albo „odśwież stronę”. Pozostałe komunikaty (sąsiedni
 * lokal) są prawdziwe, dopóki otworzył się właśnie wybrany sklep; obok nich mogą stać komunikaty o zapisie, bo się nie wykluczają.
 */
export function noticeAfterOpen(choice: Pick<StartChoice, 'seed' | 'notice'>, session: OpenedStore | null): string | null {
  if (session === null || session.seed !== choice.seed) return null;
  if (choice.notice === EXISTING_STORE_NOTICE && !(session.fromSave && !session.ephemeral && session.loadNotice === null)) return null;
  return choice.notice;
}

/** Co `openChosen` potrzebuje od gry: przejście na sklep (`setSeed` powłoki gry, actions.ts), bieżąca sesja i krótki komunikat dla gracza. */
export interface StoreSwitch {
  /** Przechodzi do sklepu `seed` (zapis obecnego, budowa świata nowego, powrót do poprzedniego, gdy nowy się nie otworzy); zwraca, czy się udało. */
  setSeed(seed: string, fresh: boolean): boolean;
  /** Sesja otwartego sklepu (po udanym `setSeed` to nowy sklep). */
  session(): GameSession | null;
  toast(text: string): void;
}

/**
 * Otwiera w trakcie gry sklep wybrany na ekranie „Nowy sklep” albo wpisany w ⚙ („Otwórz”): jedno miejsce, przez które idą oba,
 * żeby zasada R46/R47 miała test. NIGDY `fresh`: seed z zapisem wczytuje ten zapis, a zapisu z nowszej wersji gry (sklep tymczasowy)
 * ani uszkodzonego (kopia `:broken`) nic nie nadpisze; od nowa zaczyna się tylko przez ⚙ w danym sklepie. Gdy nowy sklep się nie
 * otworzy, `setSeed` zostawia gracza w poprzednim (ruling R55) i nie ma komunikatu. Zwraca, czy sklep się otworzył.
 */
export function openChosen(choice: Pick<StartChoice, 'seed' | 'notice'>, game: StoreSwitch): boolean {
  if (!game.setSeed(choice.seed, false)) return false;
  const notice = noticeAfterOpen(choice, game.session());
  if (notice) game.toast(notice);
  return true;
}
