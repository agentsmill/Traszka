import { dayOf } from '@/sim/economy/calendar';
import { isCommand } from '@/sim/economy/commands';
import type { EconomyState } from '@/sim/economy/economy';
import { isRec } from '@/sim/guards';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { freshRun, isLogEntry, isRunRecord, replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { SAVE_SCHEMA, envelopeOf, newRunLog, restoreSessionFrom, type GameSession } from './session';

/**
 * Bieg rankingowy w przeglądarce (spec §14.7): zwykła sesja (`GameSession`) z `mode: 'ranked'`, której dziennik poleceń (`run`)
 * zapisuje `dispatchCommand`, żeby serwer mógł odtworzyć bieg (`replayRun`) i sam policzyć wynik (`seasonScore`). Ten moduł trzyma
 * to, co przeżywa przeładowanie strony:
 * - aktywny bieg: jeden zapis pod `traszka:ranked` (nie per seed), niezależny od zwykłych sklepów (`traszka:save:<seed>`, `traszka:last`);
 * - szufladę niewysłanego biegu (`traszka:ranked:done`): skończony sezon, który czeka na przyjęcie przez serwer. Bieg znika z niej
 *   dopiero po przyjęciu albo na wyraźne „Odrzuć bieg” (`clearFinished`), nie po przeładowaniu ani po porażce sieci; gdy przeglądarka
 *   nie przyjmie szuflady, bieg czeka w pamięci karty (`holdFinished`), a `pendingFinished` oddaje to, co do wysłania;
 * - wybrany tryb gry (`traszka:mode`).
 * Każdy dostęp do `localStorage` jest w `try/catch` (tryb prywatny, brak miejsca, zablokowane dane witryny): zapisy zgłaszają porażkę
 * wartością `false`, odczyty zachowują się tak, jakby klucza nie było. Moduł niczego nie wysyła i nie zna powłoki gry.
 */

export const RANKED_KEYS = {
  active: 'traszka:ranked',
  done: 'traszka:ranked:done',
  broken: 'traszka:ranked:broken',
  mode: 'traszka:mode',
} as const;

/** Schemat zapisu aktywnego biegu (`traszka:ranked`). */
const RANKED_SCHEMA = 1;

/**
 * Zapis aktywnego biegu: koperta stanu jak w zwykłym sklepie (`SaveEnvelope`) i dziennik poleceń osobno, bo `saveSession` stanu
 * dziennika nie zapisuje. `savedAt` to chwila zapisu (ms od epoki), tylko informacyjnie. Wersje biegu (`gameVersion` i
 * `generatorVersion` w kopercie, `simVersion` w `run`) to wersje, w których bieg się zaczął, a nie te, które go akurat zapisują:
 * po aktualizacji gry bieg zostaje przy swoich (patrz `loadRanked`).
 */
interface RankedSave {
  schema: typeof RANKED_SCHEMA;
  seed: string;
  savedAt: number;
  save: ReturnType<typeof envelopeOf>;
  run: { log: LogEntry[]; seq: number; simVersion: number };
}

/** Bieg gotowy do wysłania: dziennik z minutami sprzed końca sezonu i wynik policzony lokalnie tym samym kodem co sędzia. */
export interface FinishedRun {
  v: 1;
  seed: string;
  record: RunRecord;
  score: number;
  finishedAt: number;
}

// --- localStorage bez wyjątków ------------------------------------------------------------------------------------------

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Zapisuje wartość; false, gdy przeglądarka odmówiła (brak miejsca, tryb prywatny). Poprzednia wartość klucza zostaje wtedy, jaka była. */
function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nic
  }
}

// --- Sesja rankingowa ----------------------------------------------------------------------------------------------------

/**
 * Nowy bieg rankingowy z seeda: układ 0, stan startowy dokładnie taki jak w odtworzeniu (`freshRun`), bez premii sieci sklepów
 * (`partner`), z pustym dziennikiem w trybie `ranked`. Seed przychodzi gotowy (kanoniczny: o tym decyduje powłoka gry).
 */
export function createRankedSession(seed: string): GameSession {
  const { state, layout, info } = freshRun(seed);
  return {
    seed, mode: 'ranked', econ: state, layout, info, clock: { acc: 0 }, layoutLevel: 0, fromSave: false, loadNotice: null,
    retired: false, ephemeral: false, run: newRunLog(seed, 'ranked'),
  };
}

/**
 * Zapisuje aktywny bieg: kopertę stanu, `run.record.log` i `run.seq`. Zwraca false, gdy nic nie zapisano: przeglądarka odmówiła
 * albo sesja nie nadaje się do zapisu (nie jest rankingowa, albo nie ma dziennika, bo `markOffLog` go wyłączył: bieg bez dziennika
 * jest nie do wysłania, a zapis bez dziennika `loadRanked` uznałby za uszkodzony). Przy porażce poprzedni zapis zostaje, jaki był.
 */
export function saveRanked(s: GameSession): boolean {
  if (s.mode !== 'ranked' || s.run === null) return false;
  try {
    const { record, seq } = s.run;
    const stored: RankedSave = {
      schema: RANKED_SCHEMA, seed: s.seed, savedAt: Date.now(),
      save: { ...envelopeOf(s), gameVersion: record.gameVersion, generatorVersion: record.generatorVersion },   // wersje biegu, nie bieżącej gry
      run: { log: record.log, seq, simVersion: record.simVersion },
    };
    return write(RANKED_KEYS.active, JSON.stringify(stored));
  } catch {
    return false;
  }
}

/**
 * Wynik `loadRanked`: `none` (brak zapisu), `ok` (sesja do gry), `broken` (zapis uszkodzony: kopia w `:broken`, klucz zwolniony)
 * i `incompatible` (zapis zapisała inna wersja gry, której ten kod nie umie odczytać: nowsza albo z innym generatorem sklepów;
 * klucz zostaje nietknięty, a wołający nie dostaje sesji i niczego tu nie kasuje).
 */
export type RankedLoad = { status: 'none' } | { status: 'ok'; session: GameSession } | { status: 'broken' } | { status: 'incompatible' };

/** Liczba całkowita nieujemna (minuta i numer wpisu dziennika oraz `simVersion`, tak jak chce parser serwera). */
const isIndex = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

/** Czy `schema` jest liczbą wyższą od obsługiwanej, czyli zapis napisała nowsza wersja gry (także `Infinity` z `1e999`). */
const isNewer = (schema: unknown, current: number): boolean => typeof schema === 'number' && schema > current;

/** Czy premia sieci sklepów jest zerowa: bieg rankingowy startuje bez niej, a serwer odtwarza bez niej. */
const noPartner = (p: EconomyState['partner'] | undefined): boolean => p === undefined || (p.points === 0 && p.networkIncome === 0 && p.stores === 0);

/**
 * Dziennik z zapisu, jeśli jest wiarygodny: `simVersion` (wersja symulacji, w której bieg się zaczął) to liczba całkowita nieujemna,
 * a `log` to tablica wpisów `{minute, seq, cmd}` z poleceniami o poprawnym kształcie (`isCommand`), liczbami całkowitymi
 * nieujemnymi, w kolejności dziennika (`seq` rośnie ostro, minuta nie maleje); `seq` zapisu jest większe od każdego wpisu. Wpisy
 * są kopiami zawierającymi tylko pola dziennika. Minutę względem stanu sprawdza wołający.
 */
function readRun(run: unknown): { log: LogEntry[]; seq: number; simVersion: number } | null {
  if (!isRec(run) || !Array.isArray(run.log) || !isIndex(run.seq) || !isIndex(run.simVersion)) return null;
  const log: LogEntry[] = [];
  for (const e of run.log as unknown[]) {
    if (!isLogEntry(e) || !isCommand(e.cmd) || !isIndex(e.minute) || !isIndex(e.seq)) return null;
    const prev = log[log.length - 1];
    if (prev && (e.minute < prev.minute || e.seq <= prev.seq)) return null;
    log.push({ minute: e.minute, seq: e.seq, cmd: e.cmd });
  }
  const last = log[log.length - 1];
  if (last && run.seq <= last.seq) return null;
  return { log, seq: run.seq, simVersion: run.simVersion };
}

/**
 * Sesja z surowego zapisu biegu, `'incompatible'`, gdy zapis jest z wersji, której ten kod nie czyta, albo null, gdy zapis nie jest
 * wiarygodny (patrz `loadRanked`). Zgodność wersji sprawdzamy przed dziennikiem i stanem: zapis z innego generatora albo nowszego
 * schematu może mieć kształt, którego tu nie rozumiemy, i nie wolno go z tego powodu uznać za uszkodzony.
 */
function restoreRanked(raw: string): GameSession | 'incompatible' | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(data)) return null;
  if (isNewer(data.schema, RANKED_SCHEMA)) return 'incompatible';
  if (data.schema !== RANKED_SCHEMA || typeof data.seed !== 'string') return null;
  const { seed, save } = data;
  if (!isRec(save)) return null;
  if (isNewer(save.schema, SAVE_SCHEMA)) return 'incompatible';
  const { gameVersion, generatorVersion } = save;
  // tylko schemat 2: `restoreSessionFrom` przyjąłby też dawny kształt bez koperty (schemat 1)
  if (save.schema !== SAVE_SCHEMA || typeof gameVersion !== 'string' || !Number.isSafeInteger(generatorVersion)) return null;
  if (generatorVersion !== GENERATOR_VERSION) return 'incompatible';   // inny sklep z tego samego seeda: `replayRun` odrzuciłby ten bieg
  const run = readRun(data.run);
  if (run === null) return null;

  const restored = restoreSessionFrom(save, seed);   // bez `partner`: bieg rankingowy nie ma premii sieci
  if (!restored.ok) return null;
  const { session } = restored;
  if (!noPartner(session.econ.partner)) return null;
  if (run.log.some((e) => e.minute > session.econ.minute)) return null;   // polecenie z przyszłości stanu: dziennik nie pasuje do stanu

  session.mode = 'ranked';
  session.fromSave = true;
  session.run = {
    record: { seed, gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: run.simVersion, mode: 'ranked', log: run.log },
    seq: run.seq,
  };
  return session;
}

/**
 * Wznawia aktywny bieg. Zapis z wersji, której ten kod nie czyta, to `incompatible`: schemat biegu albo koperty wyższy od
 * obsługiwanego (napisała go nowsza gra) albo `generatorVersion` inny niż `GENERATOR_VERSION` (to byłby inny sklep). Klucz zostaje
 * nietknięty, bez kopii w `:broken` i bez sesji, więc nic się nie traci, a wołający może pokazać graczowi, co się stało.
 * Zapis, który nie przeszedł walidacji, to `broken`: surowy tekst trafia do `RANKED_KEYS.broken` (zastępuje starszą kopię), a aktywny
 * klucz jest zwolniony, żeby gracz mógł zacząć nowy bieg. Walidacja: poprawny JSON, schemat 1, koperta stanu w schemacie 2 z napisem
 * `gameVersion` i liczbą całkowitą `generatorVersion`, z tym samym seedem (sprawdza to `restoreSessionFrom`), stan, który przechodzi
 * `restoreSessionFrom` bez premii sieci, `simVersion` biegu i dziennik jak w `readRun` oraz żaden wpis z minutą późniejszą niż minuta
 * stanu. Sesja z wyniku ma `mode: 'ranked'`, `fromSave: true` i dziennik z zapisu (nigdy null), więc kolejne `dispatchCommand`
 * dopisują wpisy od zapisanego `seq`. Wersje rekordu (`gameVersion`, `generatorVersion`, `simVersion`) są wersjami z zapisu, nie
 * bieżącymi: bieg zaczęty przed podbiciem `SIM_VERSION` zostaje przy starej `simVersion` i nie przejdzie na serwerze (`rankedRunStale`),
 * ale gracz może go dograć do końca i zachować w szufladzie.
 */
export function loadRanked(): RankedLoad {
  const raw = read(RANKED_KEYS.active);
  if (raw === null) return { status: 'none' };
  let restored: GameSession | 'incompatible' | null = null;
  try {
    restored = restoreRanked(raw);
  } catch (error) {
    console.error('Zapis biegu rankingowego nie dał się wczytać.', error);
  }
  if (restored === 'incompatible') return { status: 'incompatible' };
  if (restored) return { status: 'ok', session: restored };
  write(RANKED_KEYS.broken, raw);   // brak miejsca na kopię nie przeszkadza: zapisu i tak nie da się użyć
  remove(RANKED_KEYS.active);
  return { status: 'broken' };
}

/** Kasuje aktywny bieg (po zamknięciu sezonu, gdy gracz zaczyna nowy, albo gdy bieg trzeba porzucić). Szuflady i kopii `:broken` nie rusza. */
export function discardRanked(): void {
  remove(RANKED_KEYS.active);
}

// --- Szuflada niewysłanego biegu -----------------------------------------------------------------------------------------

/**
 * Bieg, którego szuflada nie przyjęła (przeglądarka odmówiła `saveFinished`), trzymany w pamięci karty: do przeładowania strony nie
 * przepada, więc gracz może go jeszcze wysłać. Nie jest zapisem: po zamknięciu karty znika. Jedna sztuka, bo nowy bieg nie
 * startuje, dopóki poprzedni czeka (`pendingFinished`).
 */
let held: FinishedRun | null = null;

export function holdFinished(f: FinishedRun): void {
  held = f;
}

/**
 * Wkłada gotowy bieg do szuflady. Zwraca false, gdy przeglądarka odmówiła: bieg zostaje wtedy u wołającego (w pamięci karty, `holdFinished`)
 * i aktywny zapis biegu zostaje na miejscu: wołający kasuje go (`discardRanked`) dopiero po `true`, żeby bieg przetrwał przeładowanie strony.
 * Udany zapis zdejmuje z pamięci karty bieg trzymany przez `holdFinished`: szuflada ma teraz najnowszy.
 */
export function saveFinished(f: FinishedRun): boolean {
  try {
    const saved = write(RANKED_KEYS.done, JSON.stringify(f));
    if (saved) held = null;
    return saved;
  } catch {
    return false;
  }
}

/**
 * Bieg z szuflady albo null, gdy jej nie ma albo zawartość nie jest biegiem: napis spoza JSON-a, zła wersja, `record` bez kształtu
 * `RunRecord` lub nie rankingowy, seed niezgodny z `record`, wpisy dziennika bez poprawnego polecenia, wynik albo czas nie będące liczbami
 * skończonymi. Niczego przy tym nie kasuje: nierozpoznaną szufladę zastąpi dopiero następny `saveFinished`.
 */
export function loadFinished(): FinishedRun | null {
  const raw = read(RANKED_KEYS.done);
  if (raw === null) return null;
  try {
    const f: unknown = JSON.parse(raw);
    if (!isRec(f) || f.v !== 1 || typeof f.seed !== 'string' || !isRunRecord(f.record) || f.record.mode !== 'ranked') return null;
    if (f.record.seed !== f.seed || !Number.isFinite(f.score) || !Number.isFinite(f.finishedAt)) return null;
    if (!f.record.log.every((e: unknown) => isLogEntry(e) && isCommand(e.cmd))) return null;
    return { v: 1, seed: f.seed, record: f.record, score: f.score as number, finishedAt: f.finishedAt as number };
  } catch {
    return null;
  }
}

/**
 * Niewysłany bieg: ten z pamięci karty (nowszy z konstrukcji, bo trafia tam dopiero po nieudanym zapisie) albo z szuflady. To jego widzi
 * interfejs (`ui.unsent`) i to on idzie do wysłania; `loadFinished` pokazuje wyłącznie to, co leży w przeglądarce.
 */
export const pendingFinished = (): FinishedRun | null => held ?? loadFinished();

/** Opróżnia szufladę i pamięć karty (`holdFinished`): po przyjęciu biegu przez serwer albo na wyraźne „Odrzuć bieg”. */
export function clearFinished(): void {
  held = null;
  remove(RANKED_KEYS.done);
}

// --- Tryb gry i koniec sezonu --------------------------------------------------------------------------------------------

/** Wybrany tryb gry; wszystko poza tekstem `ranked` (brak klucza, śmieci, odmowa przeglądarki) to zwykła gra. */
export function getPlayMode(): 'casual' | 'ranked' {
  return read(RANKED_KEYS.mode) === 'ranked' ? 'ranked' : 'casual';
}

export function setPlayMode(mode: 'casual' | 'ranked'): void {
  write(RANKED_KEYS.mode, mode);
}

/**
 * Czy bieg zaczęto w innej wersji symulacji niż ta, którą liczy ten kod (`SIM_VERSION`): serwer takiego biegu nie przyjmie
 * (`old-version`), więc gracz może go dograć i zobaczyć wynik, ale wysłać się go nie da. Sesja bez dziennika nie jest „nieaktualna”,
 * tylko nie do wysłania (`finishRun` daje null).
 */
export const rankedRunStale = (s: GameSession): boolean => s.run !== null && s.run.record.simVersion !== SIM_VERSION;

/** Czy sezon się skończył: pierwsza minuta po zamknięciu 30 listopada (`RANKED_SEASON_END_MINUTE`) i każda późniejsza. */
export const seasonOver = (econ: Pick<EconomyState, 'minute'>): boolean => econ.minute >= RANKED_SEASON_END_MINUTE;

/** Ile dni ma sezon rankingowy (od 1 września do 30 listopada): numer dnia ostatniej minuty sezonu, licząc od 1. */
export const RANKED_DAYS = dayOf(RANKED_SEASON_END_MINUTE - 1) + 1;

/** Dzień sezonu, w którym stoi bieg: od 1, najwyżej `RANKED_DAYS` (po końcu sezonu zostaje ostatni). */
export const rankedDayOf = (econ: Pick<EconomyState, 'minute'>): number => Math.min(dayOf(econ.minute) + 1, RANKED_DAYS);

/**
 * Co w przeglądarce stoi na przeszkodzie nowemu biegowi: niewysłany bieg (szuflada albo pamięć karty; pierwszeństwo) albo aktywny zapis
 * biegu, także z innej wersji gry (nie da się go wznowić, ale nie wolno go po cichu skasować). Uszkodzony zapis nie blokuje: `loadRanked`
 * oddaje go do kopii. Nie zna bieżącej sesji, więc nie widzi biegu, którego przeglądarka nie dała zapisać: to dopowiada powłoka gry
 * (`rankedStartBlock` w actions.ts), a przed powstaniem powłoki (ekran startowy przy wejściu na stronę) wystarcza ta funkcja.
 */
export function storedRankedBlock(): 'unsent' | 'active' | null {
  if (pendingFinished() !== null) return 'unsent';
  const { status } = loadRanked();
  return status === 'ok' || status === 'incompatible' ? 'active' : null;
}

/**
 * Kończy bieg: wynik sezonu liczy lokalnie `seasonScore(replayRun(record, RANKED_SEASON_END_MINUTE))`, czyli tym samym kodem co sędzia na
 * serwerze, a nie ze stanu żywej gry. Dziennik w wyniku to kopia samych wpisów z minutą mniejszą od końca sezonu (parser serwera
 * nie przyjmuje innych), więc gra żywa zostaje nietknięta. Zwraca null, gdy sesja nie ma dziennika (`markOffLog`, sesja z
 * zapisu zwykłego, przekroczony `RUN_LOG_MAX`): taki bieg jest nie do wysłania. Pełne odtworzenie sezonu trwa ok. 0,6 s, więc to
 * nie jest funkcja do pętli klatek. Nie zapisuje szuflady (robi to wołający: `saveFinished`) i nie rzuca z powodu dziennika;
 * rzucić może tylko `replayRun` przy niezgodnej wersji generatora, której dziennik tej sesji mieć nie może.
 */
export function finishRun(s: GameSession, now: number): FinishedRun | null {
  if (s.run === null) return null;
  const log = s.run.record.log
    .filter((e) => e.minute < RANKED_SEASON_END_MINUTE)
    .map((e) => ({ minute: e.minute, seq: e.seq, cmd: { ...e.cmd } }));   // pola poleceń są płaskie: kopia płytka wystarcza
  const record: RunRecord = { ...s.run.record, mode: 'ranked', log };
  return { v: 1, seed: s.seed, record, score: seasonScore(replayRun(record, RANKED_SEASON_END_MINUTE)), finishedAt: now };
}
