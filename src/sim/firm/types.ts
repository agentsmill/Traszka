import type { CityState } from '@/sim/city/types';
import type { EconEvent, EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import type { StoreLayout } from '@/sim/store/types';
import type { ResearchId } from './research';

/*
 * Firma (spec §11, §12, §14.1): lista sklepów jednego franczyzobiorcy na wspólnej gotówce. Warstwa osoby (`PersonState`) trzyma
 * to, co należy do człowieka, a `FirmStore.econ` to rozliczenie umowy jednego sklepu. Gotówka i Ogonki sklepu w `econ` są tylko
 * odbiciem portfela osoby: firma zapisuje je do sklepu przed jego krokiem albo poleceniem i odbiera po nim.
 */

/** Twardy sufit sklepów naraz, wliczając budowę (§10.2; w 4a.1 były dwa, w 4a.2 trzy, od 4b pięć). Ile wolno teraz, mówi `FirmState.storeLimit`. */
export const MAX_STORES = 5;
/** Limit placówek na start (wliczając budowy): tyle Centrala zgadza się dać bez wyników sieci (4a.2). */
export const BASE_STORE_LIMIT = 3;
/**
 * Miesięczny obrót sieci (suma `counters.revenue` raportów jednego zamknięcia miesiąca), przy którym Centrala podnosi limit z klucza o jedną
 * placówkę (spec 4b §5.4): 3 → 4 od 1 mln zł, 4 → 5 od 1,6 mln zł. Klucz to obecny `storeLimit`.
 */
export const STORE_UNLOCK_TURNOVER: Readonly<Record<number, number>> = { 3: 1_000_000, 4: 1_600_000 };
/** Tyle wpisów trzyma skrzynka zastępcy; starsze odpadają. */
export const INBOX_MAX = 30;

/**
 * Sklep firmy. `id` rośnie od 1 (sklep startowy) i nie wraca po zamknięciu; `notice`: wypowiedzenie przez gracza (ostatni dzień umowy).
 * `reopened`: sklep po ponownym wynajmie lokalu „po Traszce” (§13.3), ten sam wpis co przed zamknięciem. Taki sklep nigdy nie jest „sklepem jak
 * dziś”: ma flagę `extra` (bez gwarancji, §11.2), także w lokalu startowym i jako jedyny otwarty. Flaga zostaje po zamknięciu, a kolejny
 * ponowny wynajem ustawia ją znów; brak klucza to sklep, który nigdy nie był wynajęty ponownie (też w zapisie).
 */
export interface FirmStore {
  id: number;
  lotId: number;
  econ: EconomyState;
  layout: StoreLayout;
  info: StoreInfo;
  closed: boolean;
  notice: { endDay: number } | null;
  reopened?: true;
}

/** Budowa nowego sklepu: pakiet otwarcia zapłacony (`pay`), sklep otwiera się o `OPEN_FROM` w dniu `readyDay`. */
export interface FirmBuild { lotId: number; readyDay: number; price: number; pay: 'gotowka' | 'raty' }

/** Warstwa osoby (§14.1): to, co zostaje przy franczyzobiorcy, gdy sklepy się zmieniają. */
export interface PersonState { wallet: number; ogonki: number; partner: boolean; remanentKnown: boolean }

/** Wpis skrzynki: zastępca odpowiedział w sklepie w tle na kartę `card` (id karty) odpowiedzią `answer`. */
export interface FirmNote { day: number; storeId: number; card: string; answer: number }

export interface FirmState {
  seed: string;
  ranked: boolean;
  /** `city` i `FirmStore.info` nie trafiają do zapisu: to czyste funkcje seeda i układu. */
  city: CityState;
  person: PersonState;
  /** Rosnąco po `id`; zamknięte sklepy zostają na liście z `closed`. */
  stores: FirmStore[];
  activeId: number;
  builds: FirmBuild[];
  /** Pakiety otwarcia zapłacone gotówką od ostatniego podsumowania sieci (zeruje je `network-report`). */
  monthInvest: number;
  inbox: FirmNote[];
  /** Skrót pogody miasta: `seedHash` sklepu startowego (pogodę losuje sklep #1, §11.1). */
  weatherHash: number;
  /** Dlaczego gra się skończyła na poziomie firmy: debet całej gotówki albo zamknięcie ostatniego sklepu. */
  over: null | 'debt' | 'closed';
  /** Poziomy badań Sieci (4b §5.3); brak klucza to poziom 0. Zostają na zawsze, także przy jednym sklepie (wtedy nie działają). */
  research: Partial<Record<ResearchId, number>>;
  /** Ile placówek Centrala pozwala mieć naraz, licząc budowy: od `BASE_STORE_LIMIT` do `MAX_STORES`, nigdy nie maleje (4b §5.4). */
  storeLimit: number;
  /** Cele firmy (4b §5.6): spełnione czekają na odbiór w `ready`, odebrane leżą w `claimed`. */
  goals: { ready: string[]; claimed: string[] };
  /** Pierwszy milion w zwykłej grze (4b §5.7): dzień gry i gotówka z chwili, gdy portfel go przekroczył; null, dopóki nie przekroczył. */
  fame: { day: number; cash: number } | null;
}

/** Zdarzenie sklepu w tle; `important` czeka na „OK” z nazwą sklepu, resztę UI zamyka samo. */
export interface BackgroundEvent { storeId: number; event: EconEvent; important: boolean }

export type FirmEventKind =
  | 'partner' | 'build' | 'opened' | 'deputy' | 'notice' | 'settlement' | 'closed' | 'network-report' | 'debt' | 'gameover'
  | 'unlock' | 'research' | 'goal' | 'million';
/** Zdarzenie firmy to rodzaj i parametry; tekst składa UI (też adres: „ul. Lipowa 3” i „3 Lipowa St.”). */
export interface FirmEvent { kind: FirmEventKind; storeId?: number; params?: Record<string, number | string>; summary?: NetworkSummary }

/**
 * Podsumowanie sieci przy zamknięciu miesiąca w kilku sklepach: wynik (`profit`, do statusu) i „Zostaje Ci” (`net`) każdego sklepu,
 * pakiety otwarcia zapłacone gotówką w tym miesiącu (`invest`), rozliczenie końcowe sklepu, któremu w tej minucie skończyła się umowa
 * (`settlement`, razem; 0, gdy nie było; zeszło już z gotówki), `total` to „Zostaje Ci” razem (suma `net`), a `wallet` gotówka po zamknięciu
 * (po rozliczeniu), więc razem z `total`, `invest` i `settlement` liczby w podsumowaniu się zgadzają.
 */
export interface NetworkSummary {
  label: string; wallet: number; stores: { id: number; profit: number; net: number }[]; invest: number; settlement: number; total: number;
}

/** Zdarzenia jednej minuty firmy: aktywnego sklepu bez zmian, sklepów w tle z id i ważnością, firmy jako rodzaj z parametrami. */
export interface FirmStepOut { active: EconEvent[]; background: BackgroundEvent[]; firm: FirmEvent[] }

/** Odmowa polecenia firmy. Od 4b: `siec` (badanie wymaga dwóch otwartych sklepów), `max` (badanie na najwyższym poziomie), `goal` (celu nie da się odebrać). */
export type FirmRefusal = 'ranked' | 'status' | 'limit' | 'lot' | 'gotowka' | 'raty' | 'store' | 'single' | 'over' | 'siec' | 'max' | 'goal';
