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

export interface CardDef {
  id: string;
  kind: 'zdarzenie' | 'okolnik';
  title: string;
  text: string;
  /** Minuta dnia, od której karta jest widoczna, i ile minut gracz ma na decyzję. */
  at: number;
  span: number;
  weight: number | ((c: CardContext) => number);
  /** Ile dni musi minąć, zanim karta wypadnie znowu. */
  cooldown: number;
  when?: (c: CardContext) => boolean;
  /** Liczby karty z kontekstu i losu 0–1 (`r`). */
  params?: (c: CardContext, r: number) => CardParams;
  answers: AnswerDef[];
  /** Odpowiedź, gdy gracz nie zdecyduje do terminu. */
  fallback: number;
  /** Do której pozycji raportu idzie zmiana zaufania (domyślnie „Decyzje dnia”). */
  trustReason?: TrustReason;
}

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
    at: h(18), span: 90, weight: 3, cooldown: 2,
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
        risk: { chance: () => 0.75, delta: (_, p) => ({ wut: p.v }), text: 'Nikt się nie skusił. Kanapki lądują w koszu, a ich wartość w WUT.' },
      },
    ],
    fallback: 2,
  },
  {
    id: 'glitch',
    kind: 'zdarzenie',
    title: 'Glitch kasowy',
    text: 'System kasowy od rana daje {p}% rabatu na wszystko. Klienci już wiedzą: kolejka sięga przystanku, a ktoś dzwoni po kuzyna z busem.',
    at: h(10), span: 60, weight: 1.5, cooldown: 5,
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
    fallback: 2,
  },
  {
    id: 'chory',
    kind: 'zdarzenie',
    title: '„Chory” pracownik w dzień dostawy',
    text: '5:58. Zbyszek dzwoni, że wczoraj zjadł hot-doga z promocji Centrali i „coś go bierze”. Akurat dziś przyjeżdża {n} palet. Centrala nie wierzy w przypadki, tylko w KPI.',
    at: h(6), span: 90, weight: 2, cooldown: 4,
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
    fallback: 2,
  },
  {
    id: 'audyt',
    kind: 'zdarzenie',
    title: 'Zapowiedź audytu',
    text: 'Centrala zapowiada audyt na jutro. Sprawdzą planogram, czystość i to, czy uśmiech kasjera jest zgodny z procedurą 4.2.1. Przy obecnym stanie sali ryzyko wpadki to {p}%.',
    at: h(9), span: 180, weight: (c) => 0.6 * auditWeight(c.trust), cooldown: 5,
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
    fallback: 2,
  },
  {
    id: 'promocja',
    kind: 'zdarzenie',
    title: 'Obowiązkowa promocja Centrali',
    text: 'Centrala ogłasza akcję „Drugi Traszdog za 1 grosz”. Udział obowiązkowy. Dobrowolnie.',
    at: h(7), span: 240, weight: 1.5, cooldown: 5,
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
    fallback: 2,
  },
  {
    id: 'cenowki',
    kind: 'zdarzenie',
    title: 'Kontrola cenówek',
    text: 'Inspektor sprawdza czytelność cenówek. Ma lupę, linijkę i dużo czasu. Ty masz {n} cenówek z ceną sprzed ostatniej promocji.',
    at: h(11), span: 120, weight: 1, cooldown: 8,
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
    fallback: 2,
  },
  {
    id: 'memy',
    kind: 'zdarzenie',
    title: 'Traszkashoposting',
    text: 'Kasjer Krystian prowadzi konto z memami o sklepie. Ma więcej obserwujących niż profil Centrali i ani jednego mema o Centrali. Na razie.',
    at: h(13), span: 240, weight: 0.8, cooldown: 10,
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
    fallback: 2,
  },
  {
    id: 'mecz',
    kind: 'zdarzenie',
    title: 'Mecz reprezentacji',
    text: 'Wieczorem mecz reprezentacji. Osiedle szykuje się, jakby od wyniku zależało życie. Zależy od niego co najwyżej zapas piwa i chipsów.',
    at: h(12), span: 240, weight: 0.8, cooldown: 7,
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
    fallback: 2,
  },
  {
    id: 'widmo',
    kind: 'zdarzenie',
    title: 'Towar-widmo',
    text: 'Kierowca podsuwa WZ do podpisu i patrzy na zegarek. Na papierze jest o {n} zgrzewek więcej, niż widzisz na palecie (razem {v} zł).',
    at: h(7, 10), span: 50, weight: 1.2, cooldown: 4,
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
        result: 'Podpisane. Zgrzewki-widma przeszły do WUT, gdzie straszą do końca miesiąca.',
        delta: (_, p) => ({ wut: p.v }),
      },
    ],
    fallback: 2,
  },
  {
    id: 'sasiad',
    kind: 'zdarzenie',
    title: 'Skarga sąsiadki',
    text: 'Pani Halina z drugiego piętra dzwoni, że palety pod sklepem zasłaniają jej widok na życie. I na parking.',
    at: h(8), span: 180, weight: 1.2, cooldown: 5,
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
    fallback: 2,
  },
  {
    id: 'lodowka',
    kind: 'zdarzenie',
    title: 'Awaria lodówki',
    text: 'Lodówka z nabiałem buczy jak syrena i grzeje jak kaloryfer. W środku {n} jogurtów (razem {v} zł) patrzy z niepokojem.',
    at: h(14), span: 120, weight: 0.8, cooldown: 8,
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
    fallback: 2,
  },
  {
    id: 'influencer',
    kind: 'zdarzenie',
    title: 'Influencer chce nagrać unboxing',
    text: 'Lokalny influencer ({n} tys. obserwujących, w tym podobno ludzie) chce nagrać u Ciebie „unboxing Traszdoga”.',
    at: h(15), span: 180, weight: 0.7, cooldown: 12,
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
    fallback: 2,
  },
  {
    id: 'sejf',
    kind: 'zdarzenie',
    title: 'Utarg na weekend',
    text: 'Sobota wieczór. W sejfie utarg z całego tygodnia, a bank otwiera się w poniedziałek. Sejf ma zamek z 1998 roku i duże poczucie humoru.',
    at: h(21), span: 110, weight: 2, cooldown: 6,
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
    fallback: 1,
  },
  {
    id: 'ulewa',
    kind: 'zdarzenie',
    title: 'Błoto po ulewie',
    text: 'Za oknem leje, a klienci wnoszą na butach pół osiedla. Podłoga przy wejściu przypomina mapę rzeki.',
    at: h(9), span: 240, weight: 2, cooldown: 3,
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
    fallback: 2,
  },
  {
    id: 'wiek',
    kind: 'zdarzenie',
    title: 'Nastolatek po energetyka',
    text: 'Chłopak z wąsem namalowanym flamastrem chce kupić energetyka. Twierdzi, że ma 18 lat od wczoraj, a dowód zostawił w drugich spodniach.',
    at: h(14, 30), span: 120, weight: 1, cooldown: 6,
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
          chance: () => 0.25, delta: (c) => ({ fine: -Math.max(1000, 0.5 * c.dailyMargin), trust: -2 }),
          text: 'Za chłopakiem weszła kontrola. Wąsy kontrolerów były prawdziwe.',
        },
      },
      {
        label: 'Wołam kierownika (czyli siebie)',
        result: 'Kierownik przyszedł, popatrzył i odmówił. Chłopak kupił wodę i wyszedł z godnością.',
        delta: () => ({ staffMinutes: 10, energy: -5 }),
      },
    ],
    fallback: 2,
  },
  {
    id: 'ekspres',
    kind: 'zdarzenie',
    title: 'Bunt ekspresu do kawy',
    text: 'Ekspres wyświetla błąd E-404: „nie znaleziono kawy w kawie”. Kolejka po poranne flat white zaczyna szemrać.',
    at: h(7, 30), span: 120, weight: 1, cooldown: 8,
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
    fallback: 2,
  },
  {
    id: 'wiralowy',
    kind: 'zdarzenie',
    title: 'Drop: lody BANDY XL',
    text: 'Centrala rozdziela lody BANDY XL. Przy Twoim zaufaniu ({t}) dostaniesz {s}% zamówienia. Dzieciaki już wiedzą, ich rodzice jeszcze nie.',
    at: h(10), span: 300, weight: 0.7, cooldown: 10,
    params: (c) => ({ t: Math.round(c.trust), s: Math.round(100 * viralShare(c.trust)) }),
    answers: [
      {
        label: 'Biorę przydział i robię miejsce w zamrażarce',
        result: 'Lody zniknęły w godzinę. Kolejka dzieciaków sięgała przystanku, a jedno dziecko pytało o fakturę.',
        delta: () => ({ staffMinutes: 30, logistics: -PALLET_FEE }),
        mods: (c) => [{ kind: 'traffic', value: 0.25 * viralShare(c.trust), minutes: 2 * DAY }],
        risk: { chance: () => 0.25, delta: (c) => ({ wut: 0.1 * c.dailyMargin }), text: 'Część lodów rozmroziła się przy przekładaniu. WUT lubi lody.' },
      },
      {
        label: 'Odpuszczam, nie mam miejsca',
        result: 'Centrala odnotowała „brak zaangażowania w strategiczne dropy”. Dzieciaki poszły do sąsiedniej Traszki.',
        delta: () => ({ trust: -1 }),
      },
    ],
    fallback: 1,
  },
];

/** Okólniki Centrali: rzadkie (raz na 2–4 dni) i zawsze z haczykiem. */
export const CIRCULARS: readonly CardDef[] = [
  {
    id: 'okolnik-premia',
    kind: 'okolnik',
    title: 'Okólnik: premia za frekwencję',
    text: 'Centrala przyznaje premię {b} zł za frekwencję. Warunek: tydzień ekspozycji napoju „Kraftuś Zero Sensu” przy kasie. Napój ma smak „niebieski”.',
    at: h(8), span: 600, weight: 1, cooldown: 8, trustReason: 'okolnik',
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
    fallback: 1,
  },
  {
    id: 'okolnik-usmiech',
    kind: 'okolnik',
    title: 'Okólnik: KPI uśmiechu',
    text: 'Od poniedziałku kasjer, który wita klienta bez uśmiechu, obniża KPI sklepu. Centrala oferuje szkolenie online „Uśmiech w 4 krokach” (krok 5 płatny).',
    at: h(8), span: 600, weight: 1, cooldown: 10, trustReason: 'okolnik',
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
    fallback: 2,
  },
  {
    id: 'okolnik-witryna',
    kind: 'okolnik',
    title: 'Okólnik: nowa naklejka na witrynę',
    text: 'Centrala dopłaci połowę do nowej naklejki „Zawsze pod ręką”. Druga połowa to {c} zł. Naklejka jest o 3 cm za szeroka na Twoją witrynę.',
    at: h(8), span: 600, weight: 1, cooldown: 12, trustReason: 'okolnik',
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
    fallback: 1,
  },
  {
    id: 'okolnik-refundacja',
    kind: 'okolnik',
    title: 'Okólnik: program refundacyjny WUT',
    text: 'Centrala odpisze {r} zł ubytków z WUT, jeśli wypełnisz formularz R-17 w trzech egzemplarzach. Egzemplarz trzeci trzeba wysłać faksem.',
    at: h(8), span: 600, weight: 1, cooldown: 12, trustReason: 'okolnik',
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
    fallback: 1,
  },
  {
    id: 'okolnik-paleta',
    kind: 'okolnik',
    title: 'Okólnik: konkurs „Paleta miesiąca”',
    text: 'Centrala ogłasza konkurs na najładniej ułożoną paletę. Nagroda: {o} Ogonków i dyplom. Zdjęcie trzeba zrobić na chodniku, w świetle dziennym.',
    at: h(8), span: 600, weight: 1, cooldown: 14, trustReason: 'okolnik',
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
    fallback: 1,
  },
  {
    id: 'okolnik-ankieta',
    kind: 'okolnik',
    title: 'Okólnik: ankieta satysfakcji',
    text: 'Centrala pyta, jak bardzo jesteś zadowolony ze współpracy (skala od 9 do 10). Wypełnienie zajmie 5 minut. Według Centrali.',
    at: h(8), span: 600, weight: 1, cooldown: 14, trustReason: 'okolnik',
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
    fallback: 2,
  },
];
