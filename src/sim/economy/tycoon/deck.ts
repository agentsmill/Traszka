import { FINE_BASE, PALLET_FEE, WAGE_PER_DAY } from '../catalog';
import type { CardContext, CardDelta, ModKind } from './cards';
import { cleanlinessEffects } from './cleanliness';
import { auditWeight, viralShare, type TrustReason } from './trust';
import { clamp, roundNice } from './time';

/**
 * Talia kart decyzji (spec §7.5, §7.1a, §11.3): zdarzenia dnia i okólniki Centrali. Kwoty skalują się z marżą dnia
 * sklepu (`k`), żeby decyzje bolały tak samo w budce i we flagowcu. Wszystkie osoby i firmy są fikcyjne; satyra celuje
 * w Centralę i absurdy systemu, a nie w ludzi przy kasie.
 */

export type CardParams = Record<string, number>;

export interface ModDef { kind: ModKind; value: number; minutes: number; /** Minuta dnia startu (bez: od decyzji). */ from?: number }

export interface AnswerDef {
  label: string;
  /** Komentarz po wyborze ({n} to parametry karty). */
  result: string;
  delta?: (c: CardContext, p: CardParams) => CardDelta;
  mods?: (c: CardContext, p: CardParams) => ModDef[];
  risk?: { chance: (c: CardContext, p: CardParams) => number; delta: (c: CardContext, p: CardParams) => CardDelta; text: string };
}

/**
 * Mandat po kontroli za sprzedaż energetyka nieletniemu (karta `wiek`, odpowiedź „Sprzedaję”): dwie typowe marże dnia, nie mniej niż
 * 4000 zł. To największy pojedynczy koszt losowy w grze, „duży koszt” z decyzji właściciela z 29.10.2026: dwa takie stawiają biernego
 * gracza w strefie ostrzeżenia o debecie, trzy kończą grę (tycoon/debt.test.ts).
 */
export const MINOR_SALE_FINE = { min: 4000, dailyMargins: 2 } as const;
export const minorSaleFine = (c: Pick<CardContext, 'dailyMargin'>): number =>
  Math.max(MINOR_SALE_FINE.min, MINOR_SALE_FINE.dailyMargins * c.dailyMargin);

export interface CardDef {
  id: string;
  kind: 'zdarzenie' | 'okolnik';
  title: string;
  text: string;
  /** Minuta dnia, w której karta się pokazuje (gra staje i czeka na odpowiedź). */
  at: number;
  weight: number | ((c: CardContext) => number);
  /** Ile dni musi minąć, zanim karta wypadnie znowu. */
  cooldown: number;
  when?: (c: CardContext) => boolean;
  /** Liczby karty z kontekstu i losu 0–1 (`r`). */
  params?: (c: CardContext, r: number) => CardParams;
  answers: AnswerDef[];
  /**
   * Odpowiedź zaznaczona z góry: tę zatwierdza gracz, który nie czyta (zwykle „nic nie robię”). Gra stoi na karcie, aż
   * gracz wybierze, więc domyślna nie wybiera się sama; to tylko podpowiedź interfejsu i wybór biernego gracza.
   */
  defaultAnswer: number;
  /** Do której pozycji raportu idzie zmiana zaufania (domyślnie „Decyzje dnia”). */
  trustReason?: TrustReason;
}

/**
 * Waga karty skalowana przez trudnych klientów dzielnicy (spec §8.1, 4a.2): `base` razy `difficult` z kontekstu. Sklep bez aktywnej dzielnicy
 * nie ma `difficult` w kontekście i dostaje dokładnie `base`, bez mnożenia przez 1: jego talia jest taka jak przed 4a.2 co do bitu.
 */
export const difficultWeight = (base: number) => (c: CardContext): number => (c.difficult === undefined ? base : base * c.difficult);

/** Karty tylko dla Dworca (stoją w `DECK` po `wiralowy`, przed kartami 4b): wypadają wyłącznie w sklepie, którego dzielnicą jest Dworzec. */
export const DWORZEC_CARD_IDS = ['dworzec-pociag', 'dworzec-bilon', 'dworzec-walizka'] as const;

/** Waga karty Dworca: `w` na Dworcu, poza nim 0. Waga 0 wypada z `eligible`, więc nowa karta nie przesuwa losowania talii innych sklepów. */
const dworzecOnly = (w: number) => (c: CardContext): number => (c.district === 'dworzec' ? w : 0);

/** Wagi karty w pięciu kontekstach: sklep bez aktywnej dzielnicy (`none`) i cztery dzielnice. */
export interface DistrictWeights { none: number; osiedle: number; srodmiescie: number; dworzec: number; biurowce: number }

/**
 * Waga karty zależna od dzielnicy sklepu (4b, spec §5.5): `none` dla sklepu bez aktywnej dzielnicy (kontekst nie ma wtedy `district`), reszta dla
 * dzielnicy z kontekstu. Waga 0 wypada z `eligible`, tak jak w kartach Dworca (`dworzecOnly`).
 */
export const byDistrict = (w: DistrictWeights) => (c: CardContext): number => (c.district === undefined ? w.none : w[c.district]);

/** Dwanaście kart dnia z etapu 4b (stoją na końcu `DECK`, w tej kolejności; spec §5.5). */
export const NEW_CARD_IDS_4B = [
  'karty-zrzut', 'festyn', 'sanepid', 'awaria-pradu', 'rozkopy', 'koncert',
  'elearning', 'catering-korpo', 'kibice', 'bon-centrali', 'ai-inwentaryzacja', 'wybory',
] as const;

/**
 * Waga decyzji `CARDS.stakes` (cards.ts). Nie importujemy jej, bo cards.ts importuje ten plik; `newCards.test.ts` pilnuje, że to ta sama liczba.
 * Karty 4b podają skutki tak jak spec §5.5, czyli już po tym mnożniku (pieniądze, zaufanie, reputacja, WUT, opłaty logistyczne, ruch i marża),
 * a talia trzyma wartości przed nim, jak starsze karty (rozstrzygnięcie etapu 4b: liczby specu są skuteczne). `eff(0.9)` to ruch +0,9 widoczny w grze, czyli 0,3 w talii.
 * Czas ludzi, siły, Ogonki, mandaty, zamknięcie sklepu i osoby na zmianie nie mają mnożnika i idą bez `eff`.
 */
const STAKES = 3;
const eff = (effective: number): number => effective / STAKES;

const h = (hour: number, min = 0): number => hour * 60 + min;
/** Skala sklepu: 1 przy marży dnia ok. 2000 zł. */
const k = (c: CardContext): number => clamp(c.dailyMargin / 2000, 0.5, 6);
const zl = roundNice;
const DAY = 24 * 60;

export const DECK: readonly CardDef[] = [
  {
    id: 'fefo',
    kind: 'zdarzenie',
    title: 'FEFO o 18:00',
    text: 'W lodówce leży {n} kanapek, którym dziś kończy się termin (razem {v} zł). System FEFO mruga na czerwono, a kanapki patrzą z wyrzutem.',
    at: h(18), weight: 3, cooldown: 2,
    defaultAnswer: 2,
    params: (c, r) => {
      const n = Math.max(4, Math.round((10 + 20 * r) * k(c)));
      return { n, v: zl(n * 9) };
    },
    answers: [
      {
        label: 'Przeceń o 30% z naklejką „NIE marnujeMY”',
        result: 'Naklejki przyklejone. Połowa kanapek zniknęła w kwadrans, druga połowa czeka na cud.',
        delta: (_, p) => ({ cash: -0.3 * p.v, wut: 0.1 * p.v, staffMinutes: 15 }),
      },
      {
        label: 'Paczki-niespodzianki w Traszkapce',
        result: 'Paczki rozeszły się w godzinę. Ktoś w Traszkapce wystawił pięć gwiazdek i zdjęcie kanapki z serduszkiem.',
        delta: (_, p) => ({ cash: -0.45 * p.v, staffMinutes: 25, reputation: 0.5, ogonki: 2 }),
      },
      {
        label: 'Zostaw, może ktoś się skusi',
        result: 'Cud! Ostatni klient wieczoru wykupił wszystkie. Mówił, że to na imprezę, i nikt nie pytał dalej.',
        risk: { chance: () => 0.75, delta: (_, p) => ({ wut: p.v }), text: 'Nikt się nie skusił. Kanapki lądują w koszu, a ich wartość w ubytkach.' },
      },
    ],
  },
  {
    id: 'glitch',
    kind: 'zdarzenie',
    title: 'Glitch kasowy',
    text: 'System kasowy od rana daje {p}% rabatu na wszystko. Klienci już wiedzą: kolejka sięga przystanku, a ktoś dzwoni po kuzyna z busem.',
    at: h(10), weight: 1.5, cooldown: 5,
    defaultAnswer: 2,
    params: (_, r) => ({ p: 20 + 10 * Math.floor(r * 5) }),
    answers: [
      {
        label: 'Zamknij sklep na godzinę i wezwij serwis',
        result: 'Serwisant przyjechał, wyłączył i włączył. Działa. Faktura też działa.',
        delta: (c) => ({ cash: -0.06 * c.dailyMargin, trust: 1 }),
        mods: () => [{ kind: 'closed', value: 1, minutes: 60 }],
      },
      {
        label: 'Sprzedawaj dalej, rabat idzie z Twojej marży',
        result: 'Osiedle Cię kocha. Księgowa trochę mniej.',
        delta: (c, p) => ({ cash: -(p.p / 100) * c.dailyRevenue * (120 / 1020) * 1.3, reputation: 2 }),
        mods: () => [{ kind: 'traffic', value: 0.3, minutes: 120 }],
      },
      {
        label: 'Dzwonię na infolinię Centrali',
        result: '„Twoje połączenie jest dla nas ważne”. Po 45 minutach system naprawił się sam, a rabat zdążył się nacieszyć.',
        delta: (c, p) => ({ cash: -(p.p / 100) * c.dailyRevenue * (90 / 1020), staffMinutes: 45 }),
      },
    ],
  },
  {
    id: 'chory',
    kind: 'zdarzenie',
    title: '„Chory” pracownik w dzień dostawy',
    text: '5:58. Zbyszek dzwoni, że wczoraj zjadł hot-doga z promocji Centrali i „coś go bierze”. Akurat dziś przyjeżdża {n} palet. Centrala nie wierzy w przypadki, tylko w KPI.',
    at: h(6), weight: 2, cooldown: 4,
    defaultAnswer: 2,
    when: (c) => c.deliveryToday && c.staff >= 2,
    params: (c) => ({ n: c.palletsToday }),
    answers: [
      {
        label: 'Stanę za niego sam',
        result: 'Franczyzobiorca na kasie, franczyzobiorca przy paletach, franczyzobiorca w lustrze o 23:00. Ten sam, tylko starszy.',
        delta: () => ({ energy: -60 }),
      },
      {
        label: 'Zastępstwo z agencji pracy',
        result: 'Agencja przysłała panią Mariolę. Pani Mariola zna kasę lepiej niż Ty. Faktura też jest Ci dobrze znana.',
        delta: () => ({ cash: -1.5 * WAGE_PER_DAY }),
      },
      {
        label: 'Jakoś to będzie w mniejszym składzie',
        result: 'Jakoś było. Palety trochę postały, kolejka trochę pooddychała.',
        mods: () => [{ kind: 'staff', value: -1, minutes: h(23) - h(6), from: h(6) }],
      },
    ],
  },
  {
    id: 'audyt',
    kind: 'zdarzenie',
    title: 'Zapowiedź audytu',
    text: 'Centrala zapowiada audyt na jutro. Sprawdzą planogram, czystość i to, czy uśmiech kasjera jest zgodny z procedurą 4.2.1. Przy obecnym stanie sali ryzyko wpadki to {p}%.',
    at: h(9), weight: (c) => 0.6 * auditWeight(c.trust), cooldown: 5,
    defaultAnswer: 2,
    when: (c) => c.day >= 3,
    trustReason: 'audyt',
    params: (c) => ({ p: Math.round(clamp(100 * (1 - cleanlinessEffects(c.cleanliness).score), 15, 85)) }),
    answers: [
      {
        label: 'Generalne porządki po zamknięciu',
        result: 'Audytor przejechał palcem po regale i pokiwał głową. Z uznaniem albo z żalem, że nie ma czego wpisać.',
        delta: () => ({ staffMinutes: 120, trust: 2 }),
        risk: { chance: () => 0.1, delta: () => ({ trust: -8 }), text: 'Audytor znalazł jeden okruszek. Był to okruszek strategiczny.' },
      },
      {
        label: 'Wynajmij firmę sprzątającą',
        result: 'Firma sprzątająca wyszorowała nawet to, czego nie było. Audyt zaliczony.',
        delta: (c) => ({ cash: -0.12 * c.dailyMargin, trust: 2 }),
        risk: { chance: () => 0.05, delta: () => ({ trust: -8 }), text: 'Audytor uznał, że jest „podejrzanie czysto”. Minus za brak autentyczności.' },
      },
      {
        label: 'Będzie, co ma być',
        result: 'Było dobrze. Audytor był zmęczony po poprzednim sklepie i patrzył głównie w telefon.',
        delta: () => ({ trust: 2 }),
        risk: {
          chance: (_, p) => p.p / 100,
          delta: (c) => ({ trust: -8, fine: -0.15 * c.dailyMargin }),
          text: 'Audytor znalazł kurz na kurzu. Raport ma 14 stron, w tym trzy o mopie, i karę na końcu.',
        },
      },
    ],
  },
  {
    id: 'promocja',
    kind: 'zdarzenie',
    title: 'Obowiązkowa promocja Centrali',
    text: 'Centrala ogłasza akcję „Drugi Traszdog za 1 grosz”. Udział obowiązkowy. Dobrowolnie.',
    at: h(7), weight: 1.5, cooldown: 5,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Wchodzę na całego: plakaty, wobler, uśmiech',
        result: 'Promocja hula. Grosze sypią się do kasy, hot-dogi z kasy.',
        delta: () => ({ staffMinutes: 30, trust: 1 }),
        mods: () => [{ kind: 'traffic', value: 0.08, minutes: DAY }, { kind: 'margin', value: -0.1, minutes: DAY }],
      },
      {
        label: 'Wchodzę, ale plakat wisi za regałem z chemią',
        result: 'Promocja formalnie trwa. Wie o niej tylko kasa fiskalna i jeden czujny emeryt.',
        delta: () => ({ staffMinutes: 10, trust: -1 }),
        mods: () => [{ kind: 'margin', value: -0.03, minutes: DAY }],
      },
      {
        label: 'Mail na pewno trafił do spamu',
        result: 'Centrala sprawdziła, czy jej maile trafiają do spamu. Nie trafiają.',
        delta: () => ({ trust: -2 }),
      },
    ],
  },
  {
    id: 'cenowki',
    kind: 'zdarzenie',
    title: 'Kontrola cenówek',
    text: 'Inspektor sprawdza czytelność cenówek. Ma lupę, linijkę i dużo czasu. Ty masz {n} cenówek z ceną sprzed ostatniej promocji.',
    at: h(11), weight: 1, cooldown: 8,
    defaultAnswer: 2,
    params: (_, r) => ({ n: 5 + Math.floor(r * 20) }),
    answers: [
      {
        label: 'Poprawiamy wszystko od ręki',
        result: 'Cenówki jak z drukarni. Inspektor wpisał „bez uwag” wyjątkowo smutnym długopisem.',
        delta: (_, p) => ({ staffMinutes: 40 + 3 * p.n }),
      },
      {
        label: 'Kawa dla pana inspektora i rozmowa o pogodzie',
        result: 'Inspektor wypił kawę, pochwalił pogodę i nie zauważył cenówek. Albo zauważył, ale był już po kawie.',
        delta: () => ({ cash: -10 }),
        risk: { chance: () => 0.4, delta: (c) => ({ fine: -Math.max(300, 0.25 * c.dailyMargin) }), text: 'Inspektor wypił kawę i wypisał mandat. Kawę też wpisał do protokołu.' },
      },
      {
        label: 'Niech sprawdza, mamy dobre intencje',
        result: 'Inspektor nie znalazł nic. Sam był zaskoczony.',
        risk: {
          chance: () => 0.7, delta: (c) => ({ fine: -Math.max(300, 0.25 * c.dailyMargin), reputation: -1 }),
          text: 'Mandat za cenówki. Dobre intencje nie mają kodu kreskowego.',
        },
      },
    ],
  },
  {
    id: 'memy',
    kind: 'zdarzenie',
    title: 'Traszkashoposting',
    text: 'Kasjer Krystian prowadzi konto z memami o sklepie. Ma więcej obserwujących niż profil Centrali i ani jednego mema o Centrali. Na razie.',
    at: h(13), weight: 0.8, cooldown: 10,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Wspieram! Godzina dziennie na nagrania',
        result: 'Mem o „sezonie palet” ma 200 tysięcy wyświetleń. Osiedle przychodzi zobaczyć te palety na żywo.',
        delta: () => ({ staffMinutes: 60, reputation: 3 }),
        mods: () => [{ kind: 'traffic', value: 0.05, minutes: 3 * DAY }],
        risk: { chance: () => 0.15, delta: () => ({ trust: -3 }), text: 'Centrala obejrzała mema o „sezonie palet”. Nie zrozumiała. Potem zrozumiała.' },
      },
      {
        label: 'Zgłaszam Centrali, niech się tym zajmą',
        result: 'Centrala wynajęła agencję, która robi to samo, tylko gorzej i drożej. Krystian robi teraz memy o agencji.',
        delta: () => ({ trust: 1, reputation: -1 }),
      },
      {
        label: 'Udaję, że nie widzę',
        result: 'Konto rośnie, a Ty nic nie wiesz. Oficjalnie.',
        risk: { chance: () => 0.3, delta: () => ({ trust: -1 }), text: 'Centrala znalazła konto i pyta, czemu nikt jej nie zgłosił.' },
      },
    ],
  },
  {
    id: 'mecz',
    kind: 'zdarzenie',
    title: 'Mecz reprezentacji',
    text: 'Wieczorem mecz reprezentacji. Osiedle szykuje się, jakby od wyniku zależało życie. Zależy od niego co najwyżej zapas piwa i chipsów.',
    at: h(12), weight: 0.8, cooldown: 7,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Ekstra paleta piwa i chipsów',
        result: 'Kibice wykupili wszystko przed pierwszym gwizdkiem. Po meczu przyszli po resztę, ale reszty już nie było.',
        delta: () => ({ logistics: -PALLET_FEE }),
        mods: () => [{ kind: 'traffic', value: 0.35, minutes: 240, from: h(17) }],
      },
      {
        label: 'Plakat „Kibicu, tu jest zimne!”',
        result: 'Plakat działa. Zimne było, kibic był, gol nie.',
        delta: () => ({ staffMinutes: 15 }),
        mods: () => [{ kind: 'traffic', value: 0.12, minutes: 240, from: h(17) }],
      },
      {
        label: 'To tylko piłka',
        result: 'Mecz się odbył. Wynik jak zwykle. Kibice kupili piwo w Szopie 24h.',
      },
    ],
  },
  {
    id: 'widmo',
    kind: 'zdarzenie',
    title: 'Towar-widmo',
    text: 'Kierowca podsuwa WZ do podpisu i patrzy na zegarek. Na papierze jest o {n} zgrzewek więcej, niż widzisz na palecie (razem {v} zł).',
    at: h(7, 10), weight: 1.2, cooldown: 4,
    defaultAnswer: 2,
    when: (c) => c.deliveryToday,
    params: (c, r) => {
      const n = 2 + Math.floor(r * 6);
      return { n, v: zl(n * 35 * k(c)) };
    },
    answers: [
      {
        label: 'Przeliczam wszystko przy nim',
        result: 'Przeliczone. Kierowca westchnął, skreślił, podpisał. Zgrzewki-widma wróciły do hurtowni widm.',
        delta: () => ({ staffMinutes: 30 }),
      },
      {
        label: 'Podpisuję z adnotacją, reklamacja później',
        result: 'Reklamacja uznana. Centrala przeprasza i obiecuje, że to się więcej nie powtórzy. Do jutra.',
        delta: () => ({ staffMinutes: 15 }),
        risk: { chance: () => 0.5, delta: (_, p) => ({ wut: p.v }), text: 'Reklamacja odrzucona: „brak dowodu, że zgrzewek nie było”.' },
      },
      {
        label: 'Podpisuję, kierowca się spieszy',
        result: 'Podpisane. Zgrzewki-widma przeszły do ubytków, gdzie straszą do końca miesiąca.',
        delta: (_, p) => ({ wut: p.v }),
      },
    ],
  },
  {
    id: 'sasiad',
    kind: 'zdarzenie',
    title: 'Skarga sąsiadki',
    text: 'Pani Halina z drugiego piętra dzwoni, że palety pod sklepem zasłaniają jej widok na życie. I na parking.',
    at: h(8), weight: 1.2, cooldown: 5,
    defaultAnswer: 2,
    when: (c) => c.sidewalkPallets > 0,
    answers: [
      {
        label: 'Przeprosiny i bombonierka',
        result: 'Pani Halina przyjęła bombonierkę i zapowiedziała, że zadzwoni jutro. Tak dla kontaktu.',
        delta: () => ({ cash: -40, reputation: 1 }),
      },
      {
        label: 'Przestawiamy palety, zanim przyjedzie Straż',
        result: 'Palety przestawione. Pani Halina widzi teraz parking i jest rozczarowana parkingiem.',
        delta: () => ({ staffMinutes: 30 }),
      },
      {
        label: 'Nie odbieram',
        result: 'Pani Halina się obraziła. Na szczęście tylko na Ciebie.',
        risk: {
          chance: () => 0.4, delta: () => ({ fine: -FINE_BASE, trust: -1 }),
          text: 'Pani Halina zadzwoniła gdzie indziej. Straż Miejska przyjechała w 7 minut, rekord dzielnicy.',
        },
      },
    ],
  },
  {
    id: 'lodowka',
    kind: 'zdarzenie',
    title: 'Awaria lodówki',
    text: 'Lodówka z nabiałem buczy jak syrena i grzeje jak kaloryfer. W środku {n} jogurtów (razem {v} zł) patrzy z niepokojem.',
    at: h(14), weight: 0.8, cooldown: 8,
    defaultAnswer: 2,
    params: (c, r) => {
      const n = Math.round((20 + 30 * r) * k(c));
      return { n, v: zl(n * 3.5) };
    },
    answers: [
      {
        label: 'Serwis ekspresowy',
        result: 'Serwisant kopnął agregat w odpowiednie miejsce. Kopnięcie wycenił na fakturze.',
        delta: (c) => ({ cash: -0.12 * c.dailyMargin }),
      },
      {
        label: 'Przenosimy nabiał do drugiej lodówki',
        result: 'Druga lodówka pęka w szwach, ale jogurty przetrwały. Większość.',
        delta: (_, p) => ({ staffMinutes: 40, wut: 0.3 * p.v }),
      },
      {
        label: 'Może przejdzie samo',
        result: 'Nie przeszło. Jogurty przeszły na ciemną stronę daty ważności.',
        delta: (_, p) => ({ wut: p.v, reputation: -1 }),
      },
    ],
  },
  {
    id: 'influencer',
    kind: 'zdarzenie',
    title: 'Influencer chce nagrać unboxing',
    text: 'Lokalny influencer ({n} tys. obserwujących, w tym podobno ludzie) chce nagrać u Ciebie „unboxing Traszdoga”.',
    at: h(15), weight: 0.7, cooldown: 12,
    defaultAnswer: 2,
    params: (_, r) => ({ n: 5 + Math.floor(r * 40) }),
    answers: [
      {
        label: 'Zgoda, hot-dogi dla ekipy na koszt firmy',
        result: 'Film ma 40 tysięcy wyświetleń. Hot-dog wyszedł lepiej niż Ty.',
        delta: () => ({ cash: -60 }),
        mods: () => [{ kind: 'traffic', value: 0.1, minutes: DAY }],
        risk: { chance: () => 0.2, delta: () => ({ reputation: -2 }), text: 'W tle nagrało się zaplecze. Internet ocenił zaplecze na 2/10.' },
      },
      {
        label: 'Tylko za pisemną zgodą Centrali',
        result: 'Centrala odpisała po tygodniu, że wyraża zgodę na nagranie w zeszły czwartek.',
        delta: () => ({ staffMinutes: 20, trust: 1 }),
      },
      {
        label: 'Grzecznie odmawiam',
        result: 'Influencer nagrał unboxing w Kawce Express. Twój hot-dog pozostał nieodpakowany.',
      },
    ],
  },
  {
    id: 'sejf',
    kind: 'zdarzenie',
    title: 'Utarg na weekend',
    text: 'Sobota wieczór. W sejfie utarg z całego tygodnia, a bank otwiera się w poniedziałek. Sejf ma zamek z 1998 roku i duże poczucie humoru.',
    at: h(21), weight: 2, cooldown: 6,
    defaultAnswer: 1,
    when: (c) => c.weekday === 6,
    answers: [
      {
        label: 'Wiozę utarg do wpłatomatu',
        result: 'Wpłatomat przyjął wszystko oprócz jednej pomiętej dwudziestki. Wróciła z Tobą jako pamiątka.',
        delta: () => ({ energy: -15 }),
      },
      {
        label: 'Zostawiam w sejfie',
        result: 'Poniedziałek: sejf cały, utarg cały, kot sąsiadów podejrzanie zadowolony.',
        risk: { chance: () => 0.12, delta: (c) => ({ cash: -0.6 * c.dailyMargin }), text: 'Ktoś odwiedził sejf. Kamera nagrała tylko kota. Kot milczy.' },
      },
    ],
  },
  {
    id: 'ulewa',
    kind: 'zdarzenie',
    title: 'Błoto po ulewie',
    text: 'Za oknem leje, a klienci wnoszą na butach pół osiedla. Podłoga przy wejściu przypomina mapę rzeki.',
    at: h(9), weight: 2, cooldown: 3,
    defaultAnswer: 2,
    when: (c) => c.weather === 'deszcz' || c.weather === 'snieg',
    answers: [
      {
        label: 'Wycieraczka XXL i znak „Uwaga, mokra podłoga”',
        result: 'Znak stoi, wycieraczka chłonie. Klienci omijają znak szerokim łukiem, prosto w kałużę.',
        delta: () => ({ cash: -80 }),
      },
      {
        label: 'Mop w ruch co godzinę',
        result: 'Podłoga lśni co godzinę przez pięć minut. Reszta to sztuka współczesna.',
        delta: () => ({ staffMinutes: 60 }),
      },
      {
        label: 'Przecież wyschnie',
        result: 'Wyschło. Po trzech dniach, ale wyschło.',
        delta: () => ({ reputation: -0.5 }),
        risk: {
          chance: () => 0.2, delta: (c) => ({ cash: -0.2 * c.dailyMargin, reputation: -1 }),
          text: 'Klient poślizgnął się przy lodówce. Nic mu nie jest, ale ma kuzyna prawnika.',
        },
      },
    ],
  },
  {
    id: 'wiek',
    kind: 'zdarzenie',
    title: 'Nastolatek po energetyka',
    text: 'Chłopak z wąsem namalowanym flamastrem chce kupić energetyka. Twierdzi, że ma 18 lat od wczoraj, a dowód zostawił w drugich spodniach.',
    at: h(14, 30), weight: difficultWeight(1), cooldown: 6,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Proszę o dowód osobisty',
        result: 'Chłopak obraził się na cały sklep i nagrał relację. Relacja ma 12 wyświetleń, w tym 11 jego.',
        delta: () => ({ reputation: -0.5 }),
      },
      {
        label: 'Sprzedaję, wąs wygląda przekonująco',
        result: 'Transakcja udana. Wąs rozmazał się przy drzwiach.',
        risk: {
          chance: () => 0.25, delta: (c) => ({ fine: -minorSaleFine(c), trust: -2 }),
          text: 'Za chłopakiem weszła kontrola. Wąsy kontrolerów były prawdziwe.',
        },
      },
      {
        label: 'Wołam kierownika (czyli siebie)',
        result: 'Kierownik przyszedł, popatrzył i odmówił. Chłopak kupił wodę i wyszedł z godnością.',
        delta: () => ({ staffMinutes: 10, energy: -5 }),
      },
    ],
  },
  {
    id: 'ekspres',
    kind: 'zdarzenie',
    title: 'Bunt ekspresu do kawy',
    text: 'Ekspres wyświetla błąd E-404: „nie znaleziono kawy w kawie”. Kolejka po poranne flat white zaczyna szemrać.',
    at: h(7, 30), weight: 1, cooldown: 8,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Serwis, i to szybko',
        result: 'Serwisant wyjął z ekspresu łyżeczkę z 2019 roku. Kawa płynie, faktura też.',
        delta: (c) => ({ cash: -0.08 * c.dailyMargin }),
      },
      {
        label: 'Odkamieniam sam według poradnika z sieci',
        result: 'Ekspres odkamieniony, a Ty dumny. Kawa smakuje lepiej niż przed awarią.',
        delta: () => ({ staffMinutes: 45 }),
        risk: { chance: () => 0.3, delta: (c) => ({ cash: -0.15 * c.dailyMargin }), text: 'Poradnik był do pralki. Ekspres pierze teraz kawę, a serwis liczy podwójnie.' },
      },
      {
        label: 'Kartka „Kawa chwilowo filozoficzna”',
        result: 'Klienci docenili kartkę. Kawę kupili w Kawce Express naprzeciwko.',
        mods: () => [{ kind: 'margin', value: -0.06, minutes: DAY }],
      },
    ],
  },
  {
    id: 'wiralowy',
    kind: 'zdarzenie',
    title: 'Drop: lody BANDY XL',
    text: 'Centrala rozdziela lody BANDY XL. Przy Twoim zaufaniu ({t}) dostaniesz {s}% zamówienia. Dzieciaki już wiedzą, ich rodzice jeszcze nie.',
    at: h(10), weight: 0.7, cooldown: 10,
    defaultAnswer: 1,
    params: (c) => ({ t: Math.round(c.trust), s: Math.round(100 * viralShare(c.trust)) }),
    answers: [
      {
        label: 'Biorę przydział i robię miejsce w zamrażarce',
        result: 'Lody zniknęły w godzinę. Kolejka dzieciaków sięgała przystanku, a jedno dziecko pytało o fakturę.',
        delta: () => ({ staffMinutes: 30, logistics: -PALLET_FEE }),
        mods: (c) => [{ kind: 'traffic', value: 0.25 * viralShare(c.trust), minutes: 2 * DAY }],
        risk: { chance: () => 0.25, delta: (c) => ({ wut: 0.1 * c.dailyMargin }), text: 'Część lodów rozmroziła się przy przekładaniu. Ubytki lubią lody.' },
      },
      {
        label: 'Odpuszczam, nie mam miejsca',
        result: 'Centrala odnotowała „brak zaangażowania w strategiczne dropy”. Dzieciaki poszły do sąsiedniej Traszki.',
        delta: () => ({ trust: -1 }),
      },
    ],
  },
  // --- Karty Dworca (4a.2, spec §8.1): waga 0 poza Dworcem. Satyra celuje w procedury Centrali, nie w podróżnych. Liczby startowe [C]. ---
  {
    id: 'dworzec-pociag',
    kind: 'zdarzenie',
    title: 'Ostatni pociąg odwołany',
    text: 'Odwołano ostatni pociąg i do sklepu weszło {n} osób, którym uciekło połączenie. Procedura Centrali „Klient niebędący klientem” ma 14 stron i ani jednego kaloryfera.',
    at: h(21), weight: dworzecOnly(1), cooldown: 6,
    defaultAnswer: 2,
    params: (_, r) => ({ n: 8 + Math.floor(r * 12) }),
    answers: [
      {
        label: 'Wpuszczam, niech się grzeją',
        result: 'Ludzie się ogrzali, telefony naładowały. Wystawka batoników przy kaloryferze zrobiła się miękka, a procedura Centrali każe księgować ją jako ubytki, nie jako kaloryfer.',
        delta: (c) => ({ wut: 0.03 * c.dailyRevenue, staffMinutes: 20 }),
        mods: () => [{ kind: 'traffic', value: 0.5, minutes: 60 }],
      },
      {
        label: 'Kawa za pół ceny z mojej marży',
        result: 'Kawa za pół ceny rozeszła się w kwadrans. W Traszkapce pojawiło się „dziękujemy, Traszko”, a Centrala zapytała, kto zatwierdził promocję.',
        delta: (c) => ({ cash: -0.05 * c.dailyMargin, reputation: 2, ogonki: 2 }),
      },
      {
        label: 'Regulamin Centrali: bez zakupu nie przebywamy',
        result: 'Regulamin odczytany na głos, tłum rozszedł się w ciszy. Zgodność z procedurą: 100%. Zgodność ze zdrowym rozsądkiem: nie mierzymy.',
        risk: { chance: () => 0.5, delta: () => ({ reputation: -1.5 }), text: 'Ktoś nagrał, jak czytasz regulamin tłumowi przed sklepem. Film ma więcej wyświetleń niż cała Traszkapka.' },
      },
    ],
  },
  {
    id: 'dworzec-bilon',
    kind: 'zdarzenie',
    title: 'Worek groszy',
    text: 'Podróżny płaci za kawę workiem groszy, razem {n} gr, i ma pociąg za siedem minut. „Procedura przyjmowania bilonu” Centrali każe liczyć wszystko dwa razy.',
    at: h(8), weight: dworzecOnly(1.2), cooldown: 5,
    defaultAnswer: 2,
    params: (_, r) => ({ n: 300 + 100 * Math.floor(r * 8) }),
    answers: [
      {
        label: 'Liczę dwa razy, jak każe procedura',
        result: 'Policzone dwa razy i dwa razy wyszło co innego. Trzecie liczenie ruszyło po odjeździe pociągu, ale w protokole wszystko się zgadza.',
        delta: () => ({ staffMinutes: 25, trust: 1 }),
      },
      {
        label: 'Ważę na wadze do bułek',
        result: 'Waga do bułek pokazała, ile pokazała, a podróżny zdążył na pociąg. Procedura bywa elastyczna, kiedy nikt nie patrzy.',
        delta: () => ({ staffMinutes: 5 }),
        risk: {
          chance: () => 0.25, delta: () => ({ trust: -2 }),
          text: 'Audytor Centrali obejrzał nagranie. Waga do bułek nie jest wzorcowana do groszy, a wzorcowanie ma swoją procedurę.',
        },
      },
      {
        label: 'Tylko karta albo banknoty',
        result: 'Podróżny schował worek i zapłacił kartą. Kolejka westchnęła jednym głosem, a procedura bilonowa dalej leży nietknięta w segregatorze.',
        delta: () => ({ reputation: -1 }),
      },
    ],
  },
  {
    id: 'dworzec-walizka',
    kind: 'zdarzenie',
    title: 'Walizka przy wejściu',
    text: 'Przy wejściu stoi walizka bez właściciela, a w Traszkapce czeka trzystronicowy formularz „Zdarzenie nietypowe”. Rubryka 14: „Czy walizka zgłosiła się sama?”.',
    at: h(13), weight: dworzecOnly(1), cooldown: 8,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Ochrona dworca, wejście zamknięte',
        result: 'Ochrona dworca zajrzała, pokiwała głową i zabrała walizkę. W środku były skarpetki. Centrala dopisała do formularza rubrykę „skarpetki”.',
        delta: () => ({ trust: 1 }),
        mods: () => [{ kind: 'closed', value: 1, minutes: 30 }],
      },
      {
        label: 'Wypełniam formularz',
        result: 'Trzy strony, cztery załączniki i zdjęcie walizki z profilu oraz z trzech czwartych. Centrala potwierdziła odbiór po czterech dniach.',
        delta: () => ({ staffMinutes: 30, energy: -5, trust: 2 }),
      },
      {
        label: 'Ktoś po nią wróci',
        result: 'Po godzinie ktoś wrócił po walizkę, podziękował i poszedł. Formularz „Zdarzenie nietypowe” został niewypełniony i słusznie.',
        risk: {
          chance: () => 0.35, delta: () => ({ reputation: -2, trust: -2 }),
          text: 'Nikt nie wrócił, za to wrócił strach: klienci omijali wejście, a Centrala spytała, gdzie formularz „Zdarzenie nietypowe”.',
        },
      },
    ],
  },
  // --- Karty dnia 4b (spec §5.5): waga zależna od dzielnicy (`byDistrict`), skutki podane jako skuteczne (`eff`). Fale ruchu mają godzinę (`from`). ---
  {
    id: 'karty-zrzut',
    kind: 'zdarzenie',
    title: 'Zrzut Traszkomonów',
    text: 'Centrala wypuszcza kolekcjonerskie saszetki Traszkomonów, edycja „Błyszcząca Kasjerka”. W kartonie jest {n} saszetek, a pod drzwiami od 5:40 stoją dzieciaki z plecakami i rodzice z minami ludzi, którzy za to zapłacą. Regulamin akcji ma trzy strony i ani słowa o kolejce.',
    at: h(6), weight: byDistrict({ none: 0.8, osiedle: 1.0, srodmiescie: 0.9, dworzec: 0.6, biurowce: 0.5 }), cooldown: 18,
    defaultAnswer: 0,
    params: (_, r) => ({ n: 60 + 20 * Math.floor(r * 9) }),
    answers: [
      {
        label: 'Limit 2 saszetki',
        result: 'Limit wisi na drzwiach, pisany flamastrem. Dzieciaki liczą na palcach, rodzice na cud, a kolejka i tak sięga przystanku. Kasjerka wyciągnęła z saszetki własną kartę „Błyszcząca Kasjerka”. Tantiem Centrala nie przewidziała.',
        delta: () => ({ staffMinutes: 40, trust: eff(1), reputation: eff(1) }),
        mods: () => [{ kind: 'traffic', value: eff(0.9), minutes: 360, from: h(6) }],
      },
      {
        label: 'Bez limitu',
        result: 'Karton zniknął w kwadrans, a kolejka wyglądała jak przed otwarciem sklepu z telefonami. Jedno dziecko wyciągnęło kartę „Błyszcząca Kasjerka”, a pozostałe sto trzydzieści napisało do Centrali.',
        mods: () => [{ kind: 'traffic', value: eff(1.6), minutes: 240, from: h(6) }],
        risk: {
          chance: () => 0.5, delta: (c) => ({ reputation: eff(-3), wut: eff(0.15 * c.dailyMargin) }),
          text: 'Przy ostatnim kartonie zrobiło się nerwowo: przepychanka, rozdarte saszetki, karty pod regałami. Straty księgujesz w ubytkach, a Centrala pyta, czemu nie było limitu.',
        },
      },
      {
        label: 'Odsyłam karton',
        result: 'Karton wrócił na ciężarówkę, a dzieciaki poszły do Kawki Express. Centrala odnotowała, że Traszka odmówiła Traszkomonom. Zdanie brzmi dziwnie, ale trafiło do akt.',
        delta: () => ({ trust: eff(-2) }),
      },
    ],
  },
  {
    id: 'festyn',
    kind: 'zdarzenie',
    title: 'Festyn osiedlowy z pierogami',
    text: 'Pod blokiem festyn: pierogi, dmuchany zamek i konkurs picia kompotu na czas. Pół osiedla stoi na trawniku, a Centrala przypomina okólnikiem, że „aktywności lokalne zgłasza się z 30-dniowym wyprzedzeniem”. Festyn zgłoszono dziś rano.',
    at: h(9), weight: byDistrict({ none: 0.6, osiedle: 1.4, srodmiescie: 0.4, dworzec: 0.3, biurowce: 0.3 }), cooldown: 21,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Stoisko z hot-dogami',
        result: 'Stoisko stanęło tuż obok dmuchanego zamku. Hot-dogi schodziły szybciej niż pierogi, a Centrala przysłała pismo, że „sprzedaż poza lokalem wymaga aneksu”. Aneks przyjdzie po festynie.',
        delta: (c) => ({ cash: eff(-0.1 * c.dailyMargin), staffMinutes: 90 }),
        mods: () => [{ kind: 'traffic', value: eff(0.3), minutes: 480, from: h(10) }, { kind: 'margin', value: eff(0.15), minutes: 480, from: h(10) }],
      },
      {
        label: 'Plakat „Zimne napoje obok”',
        result: 'Plakat wisi nad stołem z pierogami, a strzałka wskazuje Twoje drzwi. Komitet festynowy udaje, że nie widzi, a dzieciaki biegną po zimne napoje.',
        delta: (c) => ({ cash: eff(-0.02 * c.dailyMargin) }),
        mods: () => [{ kind: 'traffic', value: eff(0.2), minutes: 480 }],
      },
      {
        label: 'Nic nie robię, to nie nasz festyn',
        result: 'Festyn odbył się bez Ciebie. Pierogi skończyły się o drugiej, kompot o trzeciej, a Centrala dowiedziała się o wszystkim z gazetki osiedlowej.',
      },
    ],
  },
  {
    id: 'sanepid',
    kind: 'zdarzenie',
    title: 'Sanepid na rowerze',
    text: 'Do sklepu wjeżdża na rowerze inspektor sanepidu i od progu zagląda do lodówek. Centrala od lat zapewnia, że „każdy sklep jest zawsze gotowy na kontrolę”. Komunikat nie dotarł do mopa.',
    at: h(11), weight: byDistrict({ none: 1, osiedle: 1, srodmiescie: 1, dworzec: 1.2, biurowce: 0.8 }), cooldown: 25,
    defaultAnswer: 0,
    answers: [
      {
        label: 'Oprowadzam',
        result: 'Inspektor obejrzał lodówki, zaplecze i termometr, który pokazuje to, co trzeba. Wpisał „bez uwag” i odjechał, a Ty przez godzinę stałeś na baczność.',
        delta: () => ({ staffMinutes: 30 }),
        risk: {
          chance: (c) => (c.cleanliness < 60 ? 0.6 : 0.1), delta: () => ({ cash: eff(-1.5 * FINE_BASE), trust: eff(-2) }),
          text: 'Pod lodówką leżało coś, czego nikt nie pamięta kupować. Protokół ma cztery strony, mandat ma więcej zer, niż trzeba, a Centrala „oczekuje wyjaśnień”.',
        },
      },
      {
        label: 'Kawa na koszt firmy',
        result: 'Inspektor wypił kawę i pochwalił zaplecze. Rachunek za kawę trafił do kosztów, a paragon do segregatora „Dokumenty, których nikt nie sprawdza”.',
        delta: () => ({ cash: eff(-15) }),
        risk: {
          chance: () => 0.3, delta: () => ({ trust: eff(-3) }),
          text: 'Inspektor wypił kawę i zapytał, czy to nie jest przypadkiem poczęstunek. Zapisał w protokole „próba wpływu na kontrolę”, a Centrala dowiedziała się o tym pierwsza.',
        },
      },
    ],
  },
  {
    id: 'awaria-pradu',
    kind: 'zdarzenie',
    title: 'Awaria prądu na pół dzielnicy',
    text: 'Prąd zgasł na pół dzielnicy, w tym u Ciebie. Lodówki ucichły, kasa zgasła, skaner mruga ostatnim laserem. Infolinia Centrali zapewnia, że „zgłoszenie zostało zarejestrowane i dołączone do pozostałych z roku 2019”.',
    at: h(14), weight: 0.7, cooldown: 30,
    defaultAnswer: 1,
    answers: [
      {
        label: 'Agregat od szwagra',
        result: 'Agregat wyje jak traktor, ale kasa żyje, a lodówki chłodzą. Szwagier wystawił fakturę „za dobre słowo” i prosi o zwrot kanistra.',
        delta: (c) => ({ cash: eff(-0.15 * c.dailyMargin), staffMinutes: 30 }),
      },
      {
        label: 'Zamykam na 2 h',
        result: 'Sklep zamknięty na dwie godziny, na drzwiach kartka „Wracamy z prądem”. Lody lekko zmiękły, a Centrala przysłała ankietę o satysfakcji z awarii.',
        delta: (c) => ({ wut: eff(0.05 * c.dailyMargin) }),
        mods: () => [{ kind: 'closed', value: 1, minutes: 120 }],
      },
      {
        label: 'Sprzedaję po ciemku',
        result: 'Latarki, kalkulator i uczciwość klientów. Sprzedaż na gębę szła zaskakująco sprawnie, a dwa Traszdogi wyszły na kredyt zaufania.',
        mods: () => [{ kind: 'traffic', value: eff(-0.3), minutes: 120 }],
        risk: {
          chance: () => 0.4, delta: (c) => ({ wut: eff(0.2 * c.dailyMargin) }),
          text: 'W ciemności część towaru wyszła razem z klientami, a kalkulator pomylił się dwa razy, zawsze na korzyść kupujących. Ubytki świecą jaśniej niż latarka.',
        },
      },
    ],
  },
  {
    id: 'rozkopy',
    kind: 'zdarzenie',
    title: 'ZDM rozkopał chodnik',
    text: 'Zarząd Dróg Miejskich rozkopał chodnik przed sklepem „w ramach modernizacji”. Zapowiedź wisiała na słupie od marca, tylko że słup stoi dwie ulice dalej. Do drzwi prowadzi wąska ścieżka między rurą a taśmą.',
    at: h(7), weight: byDistrict({ none: 0.8, osiedle: 0.8, srodmiescie: 1.2, dworzec: 0.8, biurowce: 0.8 }), cooldown: 30,
    defaultAnswer: 1,
    answers: [
      {
        label: 'Kładka z palet',
        result: 'Kładka z palet stoi i nawet jest równa. Klienci przechodzą po niej ostrożnie, jak po wiszącym moście, a Straż Miejska patrzy na nią z zainteresowaniem. Na razie tylko patrzy.',
        delta: (c) => ({ cash: eff(-0.08 * c.dailyMargin), staffMinutes: 45 }),
        mods: () => [{ kind: 'traffic', value: eff(-0.1), minutes: 3 * DAY }],
      },
      {
        label: 'Nic nie robię, zajmie się tym miasto',
        result: 'Miasto się tym zajmie, na pewno. Zapowiedź na słupie mówi, że roboty potrwają „do piątku”, ale nie mówi, którego.',
        mods: () => [{ kind: 'traffic', value: eff(-0.3), minutes: 3 * DAY }],
      },
    ],
  },
  {
    id: 'koncert',
    kind: 'zdarzenie',
    title: 'Koncert disco polo na stadionie',
    text: 'Wieczorem na stadionie koncert disco polo, a bilety rozeszły się szybciej niż Traszdogi. Przed koncertem tłum musi się czegoś napić, a po koncercie czegoś zjeść. Centrala przysłała pismo, że „obecność w strefie koncertowej jest zgodna z wizją marki”.',
    at: h(16), weight: byDistrict({ none: 0.5, osiedle: 0.6, srodmiescie: 1.3, dworzec: 1.3, biurowce: 0.4 }), cooldown: 21,
    defaultAnswer: 1,
    answers: [
      {
        label: 'Zatowarowuję napoje',
        result: 'Kolejka sięgała stadionu, a ostatnia zgrzewka wyszła razem z ostatnim refrenem. Centrala dolicza opłatę za dodatkową dostawę, bo „nie było jej w planie”.',
        delta: () => ({ logistics: -eff(PALLET_FEE), staffMinutes: 30 }),
        mods: () => [{ kind: 'traffic', value: eff(0.6), minutes: 300, from: h(18) }, { kind: 'margin', value: eff(0.05), minutes: 300, from: h(18) }],
      },
      {
        label: 'Zamykam o 22',
        result: 'Fala po koncercie przeszła przez sklep jak burza: kolejka, kolejka, nagle cisza. Po 22 rozeszli się nawet ci, którzy mieli „jeszcze tylko jedno piwo”.',
        mods: () => [{ kind: 'traffic', value: eff(0.3), minutes: 240, from: h(18) }],
      },
      {
        label: 'Ochroniarz (szwagier)',
        result: 'Szwagier stanął w drzwiach z miną człowieka, który widział gorsze koncerty. Kolejka stała w rządku, a jedyną interwencją było odebranie komuś zimnych ogni.',
        delta: (c) => ({ cash: eff(-0.04 * c.dailyMargin) }),
        mods: () => [{ kind: 'traffic', value: eff(0.6), minutes: 300, from: h(18) }],
      },
    ],
  },
  {
    id: 'elearning',
    kind: 'zdarzenie',
    title: 'Obowiązkowe e-learningi Centrali',
    text: 'Centrala przypomina o obowiązkowych e-learningach: „Bezpieczeństwo kasjera”, „Higiena uśmiechu” i „Cyfrowa asertywność”. Razem 11 godzin, z czego 9 to lektor czytający przepisy. Termin mija dziś o 23:59, o czym Centrala poinformowała wczoraj o 23:58.',
    at: h(8), weight: 0.8, cooldown: 30,
    defaultAnswer: 2,
    answers: [
      {
        label: 'W godzinach pracy',
        result: 'Kasjerzy klikali „dalej”, a sklep prowadziła kolejka samoobsługowa. Certyfikaty przyszły mailem w formacie, którego nikt nie otworzy.',
        delta: () => ({ staffMinutes: 180, trust: eff(2) }),
      },
      {
        label: 'Klikam za wszystkich',
        result: 'Dziewięć kursów w kwadrans i jedno kliknięcie za dużo. System uznał, że zaliczone wszystko, łącznie z egzaminem z pierwszej pomocy.',
        delta: () => ({ staffMinutes: 20 }),
        risk: {
          chance: () => 0.35, delta: () => ({ trust: eff(-4) }),
          text: 'System wykrył, że pięć osób zaliczyło egzamin z jednego komputera w cztery minuty. Centrala zaprasza na rozmowę o „kulturze organizacyjnej”.',
        },
      },
      {
        label: 'Ignoruję',
        result: 'Termin minął o 23:59. Raport o niezaliczonych szkoleniach trafił do Centrali, gdzie leży obok raportu o raportach.',
        delta: () => ({ trust: eff(-2) }),
      },
    ],
  },
  {
    id: 'catering-korpo',
    kind: 'zdarzenie',
    title: 'Korporacja zamawia kanapki na spotkanie',
    text: 'Biuro obok zamawia {n} kanapek na „spotkanie zespołu z liderem transformacji”. Mają być bez glutenu, bez laktozy i bez poczucia winy. Centrala od razu prosi o raport „synergii z lokalnym otoczeniem biznesowym”.',
    at: h(9), weight: byDistrict({ none: 0.3, osiedle: 0.2, srodmiescie: 0.8, dworzec: 0.3, biurowce: 2.0 }), cooldown: 10,
    defaultAnswer: 0,
    params: (_, r) => ({ n: 40 + Math.floor(r * 61) }),
    answers: [
      {
        label: 'Przyjmuję',
        result: 'Kanapki gotowe i opakowane w trzech kolorach pudełek, bo tak chciał dział marketingu. Płatność przyszła po zaakceptowaniu przez wszystkie trzy działy.',
        delta: (_, p) => ({ cash: eff(4 * p.n), staffMinutes: 60 }),
        risk: {
          chance: () => 0.2, delta: (_, p) => ({ cash: eff(-4 * p.n) }),
          text: 'Spotkanie odwołano mailem o 8:59. Kanapki stoją w trzech kolorach pudełek, a dział marketingu prosi o zdjęcie „do materiałów”.',
        },
      },
      {
        label: 'Odmawiam',
        result: 'Odmowa grzeczna i stanowcza. Biuro zamówiło w sieci z dłuższą nazwą, a Centrala wpisała w notatce, że Traszka „nie wykazała elastyczności”.',
        delta: () => ({ reputation: eff(-1) }),
      },
    ],
  },
  {
    id: 'kibice',
    kind: 'zdarzenie',
    title: 'Pociąg z kibicami',
    text: 'O 16:00 na dworzec wjeżdża pociąg specjalny z kibicami drużyny gości. Policja ustawia kordon, a Centrala przypomina o procedurze „Klient w szaliku”: uśmiech, kontakt wzrokowy i wyjście tylnymi drzwiami.',
    at: h(15), weight: byDistrict({ none: 0.3, osiedle: 0.2, srodmiescie: 0.6, dworzec: 2.0, biurowce: 0.1 }), cooldown: 14,
    defaultAnswer: 2,
    answers: [
      {
        label: 'Ochrona przy wejściu',
        result: 'Dwóch ochroniarzy przy drzwiach, jeden regulamin przy kasie, kolejka równa jak na torach. Kibice kupili, co trzeba, i zaśpiewali tylko trzy razy.',
        delta: (c) => ({ cash: eff(-0.05 * c.dailyMargin) }),
        mods: () => [{ kind: 'traffic', value: eff(0.5), minutes: 180, from: h(16) }],
      },
      {
        label: 'Zamykam do odjazdu',
        result: 'Żaluzje w dół, kartka „Wracamy po meczu”. Za szybą przeszedł tłum w szalikach, a Ty w środku piłeś kawę, zdecydowanie zbyt spokojnie.',
        mods: () => [{ kind: 'closed', value: 1, minutes: 120, from: h(16) }],
      },
      {
        label: 'Normalna praca',
        result: 'Kibice kupili wszystko, co świeci i szumi, a potem poszli dalej. Kasjerka dostała od nich szalik, którego nie chce, ale nie śmie oddać.',
        mods: () => [{ kind: 'traffic', value: eff(0.5), minutes: 180, from: h(16) }],
        risk: {
          chance: () => 0.6, delta: (c) => ({ wut: eff(0.25 * c.dailyMargin), reputation: eff(-2) }),
          text: 'Przy lodówce z napojami zrobiło się tłoczno, potem głośno, a potem w lodówce coś trzasnęło. Straty idą w ubytki, a Centrala pyta, czemu nie było ochrony.',
        },
      },
    ],
  },
  {
    id: 'bon-centrali',
    kind: 'zdarzenie',
    title: 'Bon motywacyjny od Centrali',
    text: 'Centrala przyznaje Ci bon motywacyjny na dodatkowe palety marki własnej: „Chrupki Naturalne w Rozumieniu Prawa” i „Napój o Smaku Lata”. Bon jest ważny, a regulamin jego ważności Centrala dołączy później.',
    at: h(10), weight: 0.6, cooldown: 40,
    defaultAnswer: 1,
    answers: [
      {
        label: 'Biorę palety marki własnej',
        result: 'Palety przyjechały z napisem „Smak jak dawniej”, bez wskazania kiedy to było. Bon wypłacił swoje, a Centrala dolicza opłatę za „obsługę bonu”.',
        delta: (c) => ({ cash: eff(0.2 * c.dailyMargin), logistics: -eff(PALLET_FEE) }),
      },
      {
        label: 'Zostawiam na lepsze czasy',
        result: 'Bon wygasł po 3 dniach, zgodnie z regulaminem ogłoszonym po 2 dniach.',
      },
    ],
  },
  {
    id: 'ai-inwentaryzacja',
    kind: 'zdarzenie',
    title: 'Centrala testuje AI do liczenia towaru',
    text: 'Centrala wdraża „inteligentną inwentaryzację”: kamera pod sufitem ma sama liczyć towar, a Ty możesz zgłosić sklep do pilotażu. Centrala zapewnia, że algorytm „uczy się na błędach”. Twoich.',
    at: h(6), weight: 0.5, cooldown: 45,
    defaultAnswer: 1,
    answers: [
      {
        label: 'Zgłaszam sklep do pilotażu',
        result: 'Kamera wisi, dioda mruga, a Centrala dostała w prezentacji nowy slajd. Pierwszy raport brzmi: „stan magazynu: dużo”.',
        delta: () => ({ trust: eff(3) }),
        risk: {
          chance: () => 0.5, delta: (c) => ({ wut: eff(0.1 * c.dailyMargin) }),
          text: 'AI policzyło kota jako 14 batonów, a półkę z wodą jako jeden duży baton. Różnice trafiły do ubytków i na spotkanie zespołu w Centrali.',
        },
      },
      {
        label: 'Grzecznie odmawiam',
        result: 'Centrala przyjęła odmowę ze zrozumieniem i notatką „wymaga edukacji technologicznej”. Na pocieszenie wysłała zaproszenie na webinar.',
        delta: () => ({ trust: eff(-1) }),
      },
    ],
  },
  {
    id: 'wybory',
    kind: 'zdarzenie',
    title: 'Lokal wyborczy w szkole obok',
    text: 'W szkole obok urządzono lokal wyborczy i od rana stoją przed nim ludzie z dowodami w ręku. Cisza wyborcza zakazuje agitacji, ale nie kupowania bułek. Centrala przypomina, że sklep ma pozostać „neutralny politycznie i smakowo”.',
    at: h(7), weight: byDistrict({ none: 1.0, osiedle: 1.3, srodmiescie: 0.8, dworzec: 0.5, biurowce: 0.5 }), cooldown: 60,
    defaultAnswer: 1,
    answers: [
      {
        label: 'Promocja „Kawa obywatelska”',
        result: 'Kawa za złotówkę dla każdego z naklejką „Głosowałem”. Naklejek rozdano więcej niż głosów, ale to już sprawa komisji, nie Twoja.',
        mods: () => [{ kind: 'traffic', value: eff(0.25), minutes: 600, from: h(7) }, { kind: 'margin', value: eff(-0.05), minutes: 600, from: h(7) }],
      },
      {
        label: 'Nic nie robię, głosujący sami przyjdą',
        result: 'Głosujący przychodzili sami, jedni z kartą do urny, drudzy z listą zakupów. Frekwencja w sklepie wysoka, w komisji średnia.',
        mods: () => [{ kind: 'traffic', value: eff(0.15), minutes: 600, from: h(7) }],
      },
    ],
  },
];

/** Okólniki Centrali: rzadkie (raz na 2–4 dni) i zawsze z haczykiem. */
export const CIRCULARS: readonly CardDef[] = [
  {
    id: 'okolnik-premia',
    kind: 'okolnik',
    title: 'Okólnik: premia za frekwencję',
    text: 'Centrala przyznaje premię {b} zł za frekwencję. Warunek: tydzień ekspozycji napoju „Kraftuś Zero Sensu” przy kasie. Napój ma smak „niebieski”.',
    at: h(8), weight: 1, cooldown: 8, trustReason: 'okolnik',
    defaultAnswer: 1,
    params: (c) => ({ b: zl(0.4 * c.dailyMargin) }),
    answers: [
      {
        label: 'Biorę premię (i Kraftusia)',
        result: 'Premia na koncie, Kraftuś przy kasie. Klienci pytają, co znaczy „niebieski”. Nikt nie wie.',
        delta: (_, p) => ({ bonus: p.b, staffMinutes: 45, wut: 0.5 * p.b }),
      },
      {
        label: 'Dziękuję, nie skorzystam',
        result: 'Centrala przyjęła odmowę ze zrozumieniem i notatką w aktach. Na razie tylko notatką.',
      },
    ],
  },
  {
    id: 'okolnik-usmiech',
    kind: 'okolnik',
    title: 'Okólnik: KPI uśmiechu',
    text: 'Od poniedziałku kasjer, który wita klienta bez uśmiechu, obniża KPI sklepu. Centrala oferuje szkolenie online „Uśmiech w 4 krokach” (krok 5 płatny).',
    at: h(8), weight: 1, cooldown: 10, trustReason: 'okolnik',
    defaultAnswer: 2,
    answers: [
      {
        label: 'Zapisuję cały zespół',
        result: 'Zespół uśmiecha się zgodnie z procedurą. Klienci trochę się boją.',
        delta: () => ({ staffMinutes: 120, trust: 2, cash: -80 }),
      },
      {
        label: 'Zapisuję tylko siebie',
        result: 'Szkolenie ukończone. Certyfikat uśmiecha się za Ciebie.',
        delta: () => ({ energy: -20, trust: 1 }),
      },
      {
        label: 'Przeczytam w weekend',
        result: 'Weekend minął. Okólnik też. Centrala nie.',
        delta: () => ({ trust: -1 }),
      },
    ],
  },
  {
    id: 'okolnik-witryna',
    kind: 'okolnik',
    title: 'Okólnik: nowa naklejka na witrynę',
    text: 'Centrala dopłaci połowę do nowej naklejki „Zawsze pod ręką”. Druga połowa to {c} zł. Naklejka jest o 3 cm za szeroka na Twoją witrynę.',
    at: h(8), weight: 1, cooldown: 12, trustReason: 'okolnik',
    defaultAnswer: 1,
    params: (c) => ({ c: zl(0.1 * c.dailyMargin) }),
    answers: [
      {
        label: 'Zamawiam i docinam',
        result: 'Naklejka docięta. Napis „Zawsze pod ręk” budzi powszechną sympatię.',
        delta: (_, p) => ({ cash: -p.c, staffMinutes: 30, reputation: 1.5, trust: 1 }),
      },
      {
        label: 'Zostaję przy starej',
        result: 'Stara naklejka trzyma się dzielnie. Głównie na taśmie.',
      },
    ],
  },
  {
    id: 'okolnik-refundacja',
    kind: 'okolnik',
    title: 'Okólnik: program refundacyjny ubytków',
    text: 'Centrala odpisze {r} zł z Twoich ubytków, jeśli wypełnisz formularz R-17 w trzech egzemplarzach. Egzemplarz trzeci trzeba wysłać faksem.',
    at: h(8), weight: 1, cooldown: 12, trustReason: 'okolnik',
    defaultAnswer: 1,
    params: (c) => ({ r: zl(0.2 * c.dailyMargin) }),
    answers: [
      {
        label: 'Wypełniam (i szukam faksu)',
        result: 'Formularz przyjęty. Faks znaleziony w muzeum techniki. Odpis zaksięgowany.',
        delta: (_, p) => ({ staffMinutes: 60, energy: -10, wut: -p.r }),
      },
      {
        label: 'Szkoda czasu',
        result: 'Formularz R-17 leży na zapleczu. Patrzy.',
      },
    ],
  },
  {
    id: 'okolnik-paleta',
    kind: 'okolnik',
    title: 'Okólnik: konkurs „Paleta miesiąca”',
    text: 'Centrala ogłasza konkurs na najładniej ułożoną paletę. Nagroda: {o} Ogonków i dyplom. Zdjęcie trzeba zrobić na chodniku, w świetle dziennym.',
    at: h(8), weight: 1, cooldown: 14, trustReason: 'okolnik',
    defaultAnswer: 1,
    params: () => ({ o: 15 }),
    answers: [
      {
        label: 'Zgłaszam paletę',
        result: 'Twoja paleta zajęła trzecie miejsce. Pierwsze zajęła paleta Centrali.',
        delta: (_, p) => ({ staffMinutes: 30, ogonki: p.o, trust: 1 }),
        risk: { chance: () => 0.25, delta: () => ({ fine: -FINE_BASE }), text: 'Zdjęcie wyszło pięknie. Straż Miejska też je zrobiła.' },
      },
      {
        label: 'Moje palety są piękne prywatnie',
        result: 'Paleta zostaje anonimowa. Tak jest bezpieczniej.',
      },
    ],
  },
  {
    id: 'okolnik-ankieta',
    kind: 'okolnik',
    title: 'Okólnik: ankieta satysfakcji',
    text: 'Centrala pyta, jak bardzo jesteś zadowolony ze współpracy (skala od 9 do 10). Wypełnienie zajmie 5 minut. Według Centrali.',
    at: h(8), weight: 1, cooldown: 14, trustReason: 'okolnik',
    defaultAnswer: 2,
    answers: [
      {
        label: 'Wypełniam szczerze',
        result: 'Szczerość doceniona. Centrala zaplanowała z Tobą „rozmowę rozwojową”.',
        delta: () => ({ staffMinutes: 40, trust: -1 }),
      },
      {
        label: 'Wypełniam na 10',
        result: 'Dziękujemy! Twoja opinia pomoże nam utrzymać obecny poziom.',
        delta: () => ({ staffMinutes: 40, trust: 1 }),
      },
      {
        label: 'Nie wypełniam',
        result: 'Ankieta zamknięta. Średnia ocena sieci: 9,8. Bez Ciebie.',
      },
    ],
  },
];
