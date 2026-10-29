import { isRec, num, whole, type Rec } from '@/sim/guards';
import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '../catalog';
import { rand01 } from '../rand';
import { CH } from './channels';
import type { Weather } from './cleanliness';
import { CIRCULARS, DECK, type CardDef, type CardParams } from './deck';
import type { TrustReason } from './trust';
import { OPEN_MINUTES, clamp, roundNice } from './time';

/**
 * Codzienne decyzje (spec §7.5): zamiast nagród co minutę dzień przynosi 0–2 karty, średnio ok. jednej (decyzja właściciela z 29.10.2026: przy dobie
 * ~3 min 20 s to karta co ~3 min przy ×1 i co ~25 s przy ×8). Każda karta ma 2–3 odpowiedzi
 * z widocznym kosztem: pieniądze, zaufanie, WUT, czas ludzi (i siły franczyzobiorcy). Okólnik Centrali (dawniej paczka
 * co 45–110 s) przychodzi raz na 2–4 dni i zawsze ma haczyk.
 *
 * Karta decyzji zatrzymuje grę i czeka na wybór (decyzja użytkownika z 28.10.2026): nie zamyka się sama i nie wybiera
 * za gracza, także przy ×8. Pętla gry nie wykonuje minuty, dopóki `cardsBlocking` jest prawdą (`notices.ts` opisuje,
 * co zatrzymuje grę, a co jest tylko informacją). Każda karta ma odpowiedź zaznaczoną z góry (`defaultAnswer`, zwykle
 * „nic nie robię”): tę zatwierdza gracz, który nie czyta. Efekty na czas są przypięte do dnia karty. Odpowiedź daje XP.
 *
 * Moduł zmienia tylko swój stan: rozstrzygnięcie zwraca skutki (`CardOutcome`), które integracja księguje w ekonomii.
 * Liczby na karcie są wyliczane raz, przy losowaniu, ze skali sklepu, więc karta w stanie gry to same liczby (JSON).
 */

/** Skutek odpowiedzi. Pieniądze: zmiana gotówki (ujemne to koszt) w podziale na linie raportu. */
export interface CardDelta {
  /** Inne przychody i koszty (zł). */
  cash?: number;
  /** Premia Centrali (zł). */
  bonus?: number;
  /** Mandat albo kara (zł, ujemne). */
  fine?: number;
  /** Opłata logistyczna (zł, ujemne). */
  logistics?: number;
  trust?: number;
  /** Dopisane do WUT (zł; ujemne to odpis z programu refundacyjnego). */
  wut?: number;
  /** Czas ludzi: osobominuty, które zabierze praca z karty. */
  staffMinutes?: number;
  /** Siły franczyzobiorcy (ujemne zużywają). */
  energy?: number;
  reputation?: number;
  ogonki?: number;
}

export const DELTA_KEYS: readonly (keyof CardDelta)[] = [
  'cash', 'bonus', 'fine', 'logistics', 'trust', 'wut', 'staffMinutes', 'energy', 'reputation', 'ogonki',
];

/** Efekty na czas: ruch (mnożnik +value), marża (+value), sklep zamknięty, ludzie na zmianie (+value osób). */
export type ModKind = 'traffic' | 'margin' | 'closed' | 'staff';
export const MOD_KINDS: readonly ModKind[] = ['traffic', 'margin', 'closed', 'staff'];

export interface CardMod {
  kind: ModKind;
  value: number;
  /** Ile minut gry trwa efekt i od której minuty dnia się zaczyna (null: od chwili decyzji). */
  minutes: number;
  from: number | null;
  /** Szacunek skutku w zł (interfejs pokazuje „ok. −120 zł”, boty porównują odpowiedzi). */
  estimate: number;
}

export interface AnswerInstance {
  delta: CardDelta;
  mods: CardMod[];
  /** Ryzyko: z szansą `chance` dochodzi `delta` (np. mandat). */
  risk: { chance: number; delta: CardDelta } | null;
}

export interface CardInstance {
  seq: number;
  id: string;
  day: number;
  /** Minuta gry, od której karta jest widoczna (wcześniej nie da się na nią odpowiedzieć). */
  showAt: number;
  params: CardParams;
  answers: AnswerInstance[];
  /** Odpowiedź zaznaczona z góry w interfejsie (wybór biernego gracza). */
  defaultAnswer: number;
}

export interface ActiveMod { kind: ModKind; value: number; from: number; until: number; seq: number }

export interface CardLogEntry { seq: number; id: string; day: number; answer: number; riskHit: boolean }

export interface CardsState {
  pending: CardInstance[];
  active: ActiveMod[];
  /** Ostatni dzień, dla którego wylosowano karty. */
  drawnDay: number;
  /** Ostatni dzień, w którym karta wypadła (karty mają przerwę w dniach). */
  lastSeen: Record<string, number>;
  nextCircularDay: number;
  seq: number;
  /** Ostatnie rozstrzygnięcia (najnowsze na końcu). */
  log: CardLogEntry[];
  /** Miesiąc: odpowiedzi, w tym zatwierdzone odpowiedzi domyślne, i ryzyka, które się spełniły. */
  month: { answered: number; defaults: number; riskHits: number };
}

export const CARDS = {
  /** Szanse na 0 i 1 kartę dnia (reszta to 2). Pierwszy dzień gry i dzień okólnika mają co najmniej jedną. */
  none: 0.15,
  one: 0.6,
  /** Okólnik co 2–4 dni. */
  circularGapMin: 2,
  circularGapSpan: 3,
  logMax: 40,
  /** Najwięcej kart naraz na biurku (karty dnia czekające na swoją godzinę i okólnik); straż przed zepsutym zapisem. */
  maxPending: 8,
  /** XP za odpowiedź na kartę (jak dawna paczka od Centrali: okólnik ją zastępuje). */
  xp: { zdarzenie: 10, okolnik: 15 },
} as const;

/** Co karta wie o sklepie przy losowaniu (z tego liczy liczby i warunki). */
export interface CardContext {
  day: number;
  /** Minuta gry, w której losujemy (zwykle północ; na starcie gry 6:00). */
  now: number;
  weekday: number;
  deliveryToday: boolean;
  palletsToday: number;
  staff: number;
  trust: number;
  cleanliness: number;
  sidewalkPallets: number;
  weather: Weather;
  /** Skala sklepu: typowa marża i obrót dnia (zł). */
  dailyMargin: number;
  dailyRevenue: number;
}

export function createCards(day: number): CardsState {
  return {
    pending: [], active: [], drawnDay: day - 1, lastSeen: {}, nextCircularDay: day + CARDS.circularGapMin, seq: 1, log: [],
    month: { answered: 0, defaults: 0, riskHits: 0 },
  };
}

const DEF_BY_ID = new Map<string, CardDef>([...DECK, ...CIRCULARS].map((d) => [d.id, d]));
export const cardDef = (id: string): CardDef | undefined => DEF_BY_ID.get(id);

/** Kwoty na kartach: zaokrąglone do okrągłych liczb, inne pola do jednego miejsca po przecinku. */
function roundDelta(d: CardDelta): CardDelta {
  const out: CardDelta = {};
  for (const k of DELTA_KEYS) {
    const v = d[k];
    if (v === undefined || !Number.isFinite(v) || v === 0) continue;
    out[k] = k === 'cash' || k === 'bonus' || k === 'fine' || k === 'logistics' || k === 'wut' ? roundNice(v) : Math.round(v * 10) / 10;
  }
  return out;
}

/** Ile minut otwarcia przypada na efekt od `start` (minuta dnia) przez `minutes`: do szacunku w zł. */
function openShare(start: number, minutes: number): number {
  let open = 0;
  let t = start;
  let left = minutes;
  while (left > 0) {
    const mod = ((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const step = Math.min(left, MINUTES_PER_DAY - mod);
    const a = Math.max(mod, OPEN_FROM);
    const b = Math.min(mod + step, OPEN_TO);
    if (b > a) open += b - a;
    t += step;
    left -= step;
  }
  return open / OPEN_MINUTES;
}

function modEstimate(kind: ModKind, value: number, start: number, minutes: number, c: CardContext): number {
  const days = openShare(start, minutes);
  switch (kind) {
    case 'traffic':
    case 'margin': return roundNice(value * c.dailyMargin * days);
    case 'closed': return roundNice(-c.dailyMargin * days);
    case 'staff': return roundNice(value * 0.2 * c.dailyMargin * days);
  }
}

function instantiate(def: CardDef, c: CardContext, seq: number, seedHash: number): CardInstance {
  const dayStart = c.day * MINUTES_PER_DAY;
  const showAt = Math.max(c.now, dayStart + def.at);
  const params = def.params ? def.params(c, rand01(seedHash, seq, CH.cardParam)) : {};
  const answers = def.answers.map((a): AnswerInstance => ({
    delta: roundDelta(a.delta ? a.delta(c, params) : {}),
    mods: (a.mods ? a.mods(c, params) : []).map((m): CardMod => {
      const from = m.from ?? null;
      const start = from === null ? showAt : dayStart + from;
      return { kind: m.kind, value: m.value, minutes: m.minutes, from, estimate: modEstimate(m.kind, m.value, start, m.minutes, c) };
    }),
    risk: a.risk ? { chance: clamp(a.risk.chance(c, params), 0, 1), delta: roundDelta(a.risk.delta(c, params)) } : null,
  }));
  return { seq, id: def.id, day: c.day, showAt, params, answers, defaultAnswer: Math.min(def.defaultAnswer, answers.length - 1) };
}

const weightOf = (def: CardDef, c: CardContext): number =>
  Math.max(0, typeof def.weight === 'function' ? def.weight(c) : def.weight);

/**
 * Karty, które mogą dziś wypaść: spełniony warunek, waga > 0, nie wypadły dziś i minęła ich przerwa. Gdy przerwy blokują
 * wszystko, zostaje jedna karta, która najdawniej była na biurku (dzień nie zostaje bez karty, a okólnik bez terminu).
 */
function eligible(cs: CardsState, list: readonly CardDef[], c: CardContext): CardDef[] {
  const possible = list.filter((d) => (d.when ? d.when(c) : true) && weightOf(d, c) > 0 && cs.lastSeen[d.id] !== c.day);
  const rested = possible.filter((d) => cs.lastSeen[d.id] === undefined || c.day - cs.lastSeen[d.id] >= d.cooldown);
  if (rested.length > 0 || possible.length === 0) return rested;
  const oldest = possible.reduce((a, b) => ((cs.lastSeen[b.id] ?? -1) < (cs.lastSeen[a.id] ?? -1) ? b : a));
  return [oldest];
}

function pickWeighted(list: readonly CardDef[], c: CardContext, r: number): CardDef | null {
  const total = list.reduce((n, d) => n + weightOf(d, c), 0);
  if (total <= 0) return null;
  let x = r * total;
  for (const d of list) {
    x -= weightOf(d, c);
    if (x < 0) return d;
  }
  return list[list.length - 1];
}

/**
 * Karty dnia (raz na dzień, zwykle o północy). Liczba 0–2 i wybór są deterministyczne z seeda i numeru dnia. Okólnik,
 * gdy przypada, zajmuje jedno z miejsc dnia; gdy biurko jest pełne (tylko po zepsutym zapisie), czeka na miejsce.
 * Zwraca nowe karty (widoczne od `showAt`).
 */
export function drawDayCards(cs: CardsState, c: CardContext, seedHash: number): CardInstance[] {
  if (c.day <= cs.drawnDay) return [];
  cs.drawnDay = c.day;
  const r = rand01(seedHash, c.day, CH.cardCount);
  const drawn = r < CARDS.none ? 0 : r < CARDS.none + CARDS.one ? 1 : 2;
  // Pierwsza karta gry (seq jeszcze 1) przychodzi pierwszego dnia, a okólnik, gdy przypada, nie czeka na dzień z kartą.
  const floor = cs.seq === 1 || c.day >= cs.nextCircularDay ? 1 : 0;
  let count = Math.min(Math.max(drawn, floor), CARDS.maxPending - cs.pending.length);
  const out: CardInstance[] = [];
  const take = (def: CardDef): void => {
    const card = instantiate(def, c, cs.seq++, seedHash);
    cs.lastSeen[def.id] = c.day;
    cs.pending.push(card);
    out.push(card);
    count--;
  };
  if (c.day >= cs.nextCircularDay && count > 0) {
    const def = pickWeighted(eligible(cs, CIRCULARS, c), c, rand01(seedHash, c.day, CH.circularPick));
    if (def) take(def);
    cs.nextCircularDay = c.day + CARDS.circularGapMin + Math.floor(rand01(seedHash, c.day, CH.circularGap) * CARDS.circularGapSpan);
  }
  for (let k = 0; count > 0 && k < 8; k++) {
    const def = pickWeighted(eligible(cs, DECK, c), c, rand01(seedHash, c.day * 16 + k, CH.cardPick));
    if (!def) break;
    take(def);
  }
  return out;
}

/** Karty widoczne dla gracza w minucie `minute` (najstarsze pierwsze). */
export function visibleCards(cs: CardsState, minute: number): CardInstance[] {
  return cs.pending.filter((x) => x.showAt <= minute).sort((a, b) => a.showAt - b.showAt || a.seq - b.seq);
}

/** Czy karta decyzji zatrzymuje grę w minucie `minute`: pętla gry nie wykonuje tej minuty, dopóki gracz nie wybierze. */
export const cardsBlocking = (cs: CardsState, minute: number): boolean => cs.pending.some((x) => x.showAt <= minute);

export interface CardOutcome {
  seq: number;
  id: string;
  answer: number;
  /** Gracz zatwierdził odpowiedź zaznaczoną z góry. */
  isDefault: boolean;
  riskHit: boolean;
  /** Wszystko, co trzeba zaksięgować (z ryzykiem, jeśli się spełniło). */
  delta: CardDelta;
  /** Nowe efekty na czas (już dopisane do `cs.active`). */
  mods: ActiveMod[];
  /** Przyczyna zmiany zaufania do raportu (karta, okólnik albo audyt). */
  trustReason: TrustReason;
  /** XP za decyzję (poziom gracza). */
  xp: number;
  /** Komentarz do skrzynki zdarzeń (bez formatowania liczb; zob. `outcomeText`). */
  text: string;
  params: CardParams;
}

export function addDelta(a: CardDelta, b: CardDelta): CardDelta {
  const out: CardDelta = { ...a };
  for (const k of DELTA_KEYS) if (b[k] !== undefined) out[k] = (out[k] ?? 0) + b[k]!;
  return out;
}

function settle(cs: CardsState, card: CardInstance, answer: number, minute: number, seedHash: number): CardOutcome {
  const def = cardDef(card.id);
  const a = card.answers[answer];
  const riskHit = a.risk !== null && rand01(seedHash, card.seq, CH.cardRisk) < a.risk.chance;
  const delta = riskHit && a.risk ? addDelta(a.delta, a.risk.delta) : { ...a.delta };
  // efekt z godziną („od 17:00”) dotyczy dnia karty: po spóźnionej odpowiedzi zostaje z niego tylko to, co jeszcze trwa
  const mods = a.mods.map((m): ActiveMod => {
    const from = m.from === null ? minute : card.day * MINUTES_PER_DAY + m.from;
    return { kind: m.kind, value: m.value, from, until: from + m.minutes, seq: card.seq };
  }).filter((m) => m.until > minute);
  cs.active.push(...mods);
  cs.pending = cs.pending.filter((x) => x !== card);
  cs.log.push({ seq: card.seq, id: card.id, day: card.day, answer, riskHit });
  if (cs.log.length > CARDS.logMax) cs.log.splice(0, cs.log.length - CARDS.logMax);
  const isDefault = answer === card.defaultAnswer;
  cs.month.answered++;
  if (isDefault) cs.month.defaults++;
  if (riskHit) cs.month.riskHits++;
  const ad = def?.answers[answer];
  const text = (riskHit ? ad?.risk?.text : ad?.result) ?? '';
  return {
    seq: card.seq, id: card.id, answer, isDefault, riskHit, delta, mods, trustReason: def?.trustReason ?? 'karty',
    xp: def?.kind === 'okolnik' ? CARDS.xp.okolnik : CARDS.xp.zdarzenie, text, params: card.params,
  };
}

export type ResolveResult = { ok: true; outcome: CardOutcome } | { ok: false; text: string };

/** Odpowiedź gracza. Ryzyko losuje się z numeru karty, więc ta sama karta daje ten sam los przy każdej odpowiedzi. */
export function resolveCard(cs: CardsState, seq: number, answer: number, minute: number, seedHash: number): ResolveResult {
  const card = cs.pending.find((x) => x.seq === seq);
  if (!card) return { ok: false, text: 'Tej karty już nie ma na biurku.' };
  if (card.showAt > minute) return { ok: false, text: 'Na tę kartę jeszcze za wcześnie.' };
  if (!Number.isInteger(answer) || answer < 0 || answer >= card.answers.length) return { ok: false, text: 'Nie ma takiej odpowiedzi.' };
  return { ok: true, outcome: settle(cs, card, answer, minute, seedHash) };
}

/** Efekty kart po czasie znikają (karty nie: czekają na odpowiedź, a gra na nie). Wołane co minutę albo rzadziej. */
export function pruneCardMods(cs: CardsState, minute: number): void {
  if (cs.active.some((m) => m.until <= minute)) cs.active = cs.active.filter((m) => m.until > minute);
}

export interface CardModifiers {
  /** Mnożnik ruchu klientów. */
  traffic: number;
  /** Mnożnik marży. */
  margin: number;
  closed: boolean;
  /** Zmiana liczby ludzi na zmianie. */
  staff: number;
}

/** Efekty kart działające w minucie `minute`. */
export function cardModifiers(cs: CardsState, minute: number): CardModifiers {
  const out: CardModifiers = { traffic: 1, margin: 1, closed: false, staff: 0 };
  for (const m of cs.active) {
    if (minute < m.from || minute >= m.until) continue;
    if (m.kind === 'traffic') out.traffic *= Math.max(0, 1 + m.value);
    else if (m.kind === 'margin') out.margin *= 1 + m.value;
    else if (m.kind === 'closed') out.closed = true;
    else out.staff += m.value;
  }
  return out;
}

/** Koniec miesiąca: odpowiedzi, w tym zatwierdzone domyślne, i ryzyka, które się spełniły. */
export function closeCardsMonth(cs: CardsState): CardsState['month'] {
  const out = cs.month;
  cs.month = { answered: 0, defaults: 0, riskHits: 0 };
  return out;
}

// --- Ocena odpowiedzi (interfejs i boty) --------------------------------------------------------------

/** Ile wart jest w złotówkach punkt zaufania, złotówka WUT, osobominuta, punkt sił, reputacji i Ogonek. */
export interface Valuation { trust: number; wut: number; staffMinute: number; energy: number; reputation: number; ogonki: number }

export function deltaValue(d: CardDelta, v: Valuation): number {
  return (d.cash ?? 0) + (d.bonus ?? 0) + (d.fine ?? 0) + (d.logistics ?? 0)
    + (d.trust ?? 0) * v.trust - (d.wut ?? 0) * v.wut - (d.staffMinutes ?? 0) * v.staffMinute
    + (d.energy ?? 0) * v.energy + (d.reputation ?? 0) * v.reputation + (d.ogonki ?? 0) * v.ogonki;
}

/** Wartość oczekiwana odpowiedzi: skutek pewny, efekty na czas (szacunek) i ryzyko razy szansa. */
export function answerValue(a: AnswerInstance, v: Valuation): number {
  return deltaValue(a.delta, v) + a.mods.reduce((n, m) => n + m.estimate, 0) + (a.risk ? a.risk.chance * deltaValue(a.risk.delta, v) : 0);
}

/** Najlepsza odpowiedź według wyceny (przy remisie wcześniejsza). */
export function bestAnswer(card: CardInstance, v: Valuation): number {
  let best = 0;
  for (let i = 1; i < card.answers.length; i++) if (answerValue(card.answers[i], v) > answerValue(card.answers[best], v) + 1e-9) best = i;
  return best;
}

/** Tekst karty z liczbami w miejscu {n}; `fmt` formatuje liczby (interfejs podaje polskie). */
export function fillText(text: string, params: CardParams, fmt: (n: number) => string = (n) => String(Math.round(n))): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? fmt(params[k]) : m));
}

// --- Zapis -------------------------------------------------------------------------------------------

function delta(v: unknown): CardDelta {
  const r: Rec = isRec(v) ? v : {};
  const out: CardDelta = {};
  for (const k of DELTA_KEYS) if (r[k] !== undefined) out[k] = num(r[k], 0, -1e12, 1e12);
  return out;
}

function answerInstance(v: unknown): AnswerInstance | null {
  if (!isRec(v)) return null;
  const mods = Array.isArray(v.mods) ? v.mods.filter(isRec).filter((m) => MOD_KINDS.includes(m.kind as ModKind)).map((m): CardMod => ({
    kind: m.kind as ModKind,
    value: num(m.value, 0, -10, 10),
    minutes: whole(m.minutes, 0, 0, 30 * MINUTES_PER_DAY),
    from: m.from === null || m.from === undefined ? null : whole(m.from, 0, 0, MINUTES_PER_DAY - 1),
    estimate: num(m.estimate, 0, -1e12, 1e12),
  })) : [];
  const risk = isRec(v.risk) ? { chance: num(v.risk.chance, 0, 0, 1), delta: delta(v.risk.delta) } : null;
  return { delta: delta(v.delta), mods, risk };
}

/** Karta z zapisu; `today` to dzień wczytania (karta z przyszłości wypada, chwila pokazania mieści się w dniu karty). */
function cardInstance(v: unknown, today: number): CardInstance | null {
  if (!isRec(v) || typeof v.id !== 'string' || !cardDef(v.id) || !Array.isArray(v.answers)) return null;
  const answers = v.answers.map(answerInstance);
  if (answers.some((a) => a === null) || answers.length !== cardDef(v.id)!.answers.length) return null;
  const day = whole(v.day, today, 0, 1e7);
  if (day > today) return null;
  const params: CardParams = {};
  if (isRec(v.params)) for (const [k, p] of Object.entries(v.params)) params[k] = num(p, 0, -1e12, 1e12);
  const start = day * MINUTES_PER_DAY;
  return {
    seq: whole(v.seq, 0, 0, 1_073_741_824),
    id: v.id,
    day,
    showAt: num(v.showAt, start, start, start + MINUTES_PER_DAY - 1),
    params,
    answers: answers as AnswerInstance[],
    defaultAnswer: whole(v.defaultAnswer, cardDef(v.id)!.defaultAnswer, 0, answers.length - 1),
  };
}

/**
 * Wczytanie z zapisu (`day` to dzień wczytania): uszkodzona karta wypada (reszta zostaje), nieznana karta z nowszej
 * wersji też. Dni i minuty są przycinane do dnia wczytania, żeby zepsuty zapis nie zatrzymał losowania na zawsze
 * (np. `drawnDay` z dalekiej przyszłości) ani nie zostawił efektu karty na lata.
 */
export function sanitizeCards(raw: unknown, day: number): CardsState {
  const d = createCards(day);
  if (!isRec(raw)) return d;
  const pending = Array.isArray(raw.pending)
    ? raw.pending.map((c) => cardInstance(c, day)).filter((x): x is CardInstance => x !== null).slice(0, CARDS.maxPending) : [];
  // najdłuższy efekt w talii trwa 3 doby; zapas do 4 dób od dnia wczytania
  const modEnd = (day + 4) * MINUTES_PER_DAY;
  const active = Array.isArray(raw.active) ? raw.active.filter(isRec).filter((m) => MOD_KINDS.includes(m.kind as ModKind)).map((m): ActiveMod => {
    const until = num(m.until, 0, 0, modEnd);
    return { kind: m.kind as ModKind, value: num(m.value, 0, -10, 10), from: num(m.from, 0, 0, until), until, seq: whole(m.seq, 0, 0, 1_073_741_824) };
  }).slice(0, 64) : [];
  const lastSeen: Record<string, number> = {};
  if (isRec(raw.lastSeen)) for (const [k, v] of Object.entries(raw.lastSeen)) if (cardDef(k)) lastSeen[k] = whole(v, 0, 0, day);
  const log = Array.isArray(raw.log) ? raw.log.filter(isRec).filter((e) => typeof e.id === 'string').map((e): CardLogEntry => ({
    seq: whole(e.seq, 0, 0, 1_073_741_824), id: e.id as string, day: whole(e.day, 0, 0, 1e7), answer: whole(e.answer, 0, 0, 2),
    riskHit: e.riskHit === true,
  })).slice(-CARDS.logMax) : [];
  const m: Rec = isRec(raw.month) ? raw.month : {};
  const seq = Math.max(whole(raw.seq, d.seq, 1, 1_073_741_824), 1 + Math.max(0, ...pending.map((c) => c.seq)));
  return {
    pending,
    active,
    drawnDay: whole(raw.drawnDay, d.drawnDay, -1, day),
    lastSeen,
    nextCircularDay: whole(raw.nextCircularDay, d.nextCircularDay, 0, day + CARDS.circularGapMin + CARDS.circularGapSpan),
    seq,
    log,
    month: { answered: whole(m.answered, 0, 0, 1e6), defaults: whole(m.defaults, 0, 0, 1e6), riskHits: whole(m.riskHits, 0, 0, 1e6) },
  };
}
