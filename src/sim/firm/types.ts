import type { CityState } from '@/sim/city/types';
import type { EconEvent, EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import type { StoreLayout } from '@/sim/store/types';

/*
 * Firma (spec §11, §12, §14.1): lista sklepów jednego franczyzobiorcy na wspólnej gotówce. Warstwa osoby (`PersonState`) trzyma
 * to, co należy do człowieka, a `FirmStore.econ` to rozliczenie umowy jednego sklepu. Gotówka i Ogonki sklepu w `econ` są tylko
 * odbiciem portfela osoby: firma zapisuje je do sklepu przed jego krokiem albo poleceniem i odbiera po nim.
 */

/** Najwyżej tyle sklepów naraz, wliczając budowę (§10.2; w 4a.1 były dwa, od 4a.2 trzy). */
export const MAX_STORES = 3;
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
}

/** Zdarzenie sklepu w tle; `important` czeka na „OK” z nazwą sklepu, resztę UI zamyka samo. */
export interface BackgroundEvent { storeId: number; event: EconEvent; important: boolean }

export type FirmEventKind = 'partner' | 'build' | 'opened' | 'deputy' | 'notice' | 'settlement' | 'closed' | 'network-report' | 'debt' | 'gameover';
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

export type FirmRefusal = 'ranked' | 'status' | 'limit' | 'lot' | 'gotowka' | 'raty' | 'store' | 'single' | 'over';
