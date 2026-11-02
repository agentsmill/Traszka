#!/usr/bin/env node
/*
 * Smoke miasta i drugiego sklepu w headless Chromium (plan 4a.1, Zadanie 16): `vite preview` na zbudowanym `dist`, dwa rozmiary okna
 * (390×844 z dotykiem i 1280×800), czysta przeglądarka w każdym scenariuszu, każdy kontekst z `locale: 'pl-PL'`. Osiem kroków:
 *   1. stary zapis `save-v2-remont2.json` z metą gracza: jeden sklep, mapa i karta działają, „Biorę lokal” zablokowany tekstem Centrali;
 *   2. fixture „przed statusem” + `skip(30)`: okno „OK” ze statusem Partnera;
 *   3. wynajem (Miasto, kartka, karta, zapłata, „Biorę lokal”; telefon na raty, komputer gotówką), pinezka budowy z licznikiem
 *      i okno „Traszka #2 otwarta” po `skip` do dnia otwarcia;
 *   4. chip: przełączenie na #2 (inny seed sceny) i z powrotem;
 *   5. `skip` do końca miesiąca: okno „Sieć” i dwa wyciągi;
 *   6. (komputer) „Wypowiedz umowę” na #2 i `skip` do końca następnego miesiąca: rozliczenie końcowe, jeden sklep;
 *   7. (telefon) brak poziomego przewijania na każdym ekranie, pasek zakładek bez ucinania, angielski w ⚙, FPS widoku warstw;
 *   8. konsola i `pageerror` bez błędów (także z kroków 9–12).
 * Plan 4a.2 (Zadanie 9) dokłada na fixture „po Traszce” (`save-v3-po-traszce.json`: #1 i #3 otwarte, #2 zamknięty z remontem 1 i kasą samoobsługową):
 *   2. (dopisek, telefon) pinezka „lokal obok” nie zasłania innych pinezek i nie ma napisu (390 px, fixture „przed statusem”);
 *   9. pinezka „po Traszce”, lista i karta z ceną `rentPrice`, blokiem wyposażenia i wykresem 17 słupków, ponowny wynajem (telefon na raty,
 *      komputer gotówką), okno „Traszka #2 znów otwarta” z poziomem 1, zaufaniem 65 i wyposażeniem z fixture'a, chip z trzema sklepami;
 *  10. karta innego wolnego lokalu: „Biorę lokal” zablokowany tekstem o progu obrotu sieci do czwartej placówki („Centrala zgodzi się na kolejną placówkę, gdy obrót sieci …”);
 *  11. koniec miesiąca: okno „Sieć” i trzy wyciągi (cztery zakładki), zaufanie przy każdym sklepie, ostrzeżenia zaufania na chipie;
 *  12. (telefon) szerokość 390 px na nowych ekranach (karta z wykresem, karta „po Traszce”, lista chipa z trzema sklepami, okno sieci
 *      z czterema zakładkami) po polsku i po angielsku (ponowny wynajem i miesiąc rozegrane od nowa w angielskim interfejsie).
 * Do tego jeden przebieg na telefonie z włączonymi dymkami (`tips: true`): `tip-miasto` i `tip-lokal` (Zadanie 14).
 * Plan 4b (Zadanie 10) dokłada kroki `4b-a`…`4b-g` (komputer 1440×900, telefon 390×844), same: `--etap 4b`:
 *  4b-a. kopia `save-v3-dwa-sklepy.json` (schemat 3) z remontem 5 i poziomem 34 sklepu #2: migracja firmy, sklep i ulica (zrzut z kadru i po oddaleniu);
 *  4b-b. po otwarciu budowy #3: sekcja „Sieć: badania” (6 wierszy z opłatą koordynacyjną), kupno „Wspólnych dostaw” za 25 000 zł;
 *  4b-c. limit 4 i 400 000 zł: dwa lokale za gotówkę, cztery otwarte sklepy na liście chipa;
 *  4b-d. 999 500 zł i gra do „Milion!”: Galeria nieczynna przy przerwanym `/api/**`, zakładka Galerii, potem atrapa `/api/fame/*` w przeglądarce (wpis i lista);
 *  4b-e. ta sama sekcja badań po angielsku;
 *  4b-f. kopia „po Traszce” z remontem 4 sklepu startowego: sklep i ulica;
 *  4b-g. „Zrzut Traszkomonów”: talia z kopii zapisu, w której jutro może wypaść tylko ta karta.
 * Plan 4b (Zadanie 11), krok f (komputer, jakość „średnia”): zapis „przed statusem” z zrzutem Traszkomonów wymuszonym w kopercie (`saveWithCardDrop`: ruch +1,6
 * od 6:00 do 10:00 następnej doby), przewinięcie do 7:30 i puszczenie czasu: przed wejściem staje kolejka 12 postaci, razem z salą mieści się w puli postaci
 * presetu, zrzut kadru na chodnik, a po 10:00 kolejka się rozchodzi.
 *
 * Bezpieczeństwo: nic nie wychodzi poza `localhost` na porcie smoke'a. Zapytania do `/api/**` są przerywane (smoke niczego nie wysyła
 * do rankingu, ani lokalnego, ani prawdziwego), a każde inne zapytanie poza localhost jest blokowane i liczone. Zapisy gry i metę
 * wstawia skrypt do `localStorage` czystego kontekstu; nic nie trafia do prawdziwej przeglądarki użytkownika.
 *
 * Użycie: `npm run build`, potem `npm run city:smoke` (albo `node scripts/city-smoke.mjs [--only phone|desktop]`). Zrzuty i `smoke.json` idą do
 * `.smoke/city/` (katalog jest w .gitignore); wybrane zrzuty do raportu kopiuje się ręcznie do `docs/superpowers/reports/`.
 * Playwright nie jest zależnością projektu: skrypt bierze go z `PLAYWRIGHT_ROOT` (domyślnie `/opt/node-tools`, jak `scripts/tutorial-smoke.mjs`; może to
 * być katalog pakietu `playwright-core`, katalog `node_modules` albo katalog, w którego `node_modules` leży `playwright`), a gdy tam go nie ma,
 * z `node_modules` projektu, np. `PLAYWRIGHT_ROOT=/ścieżka/do/node_modules npm run city:smoke`. Chromium bierze z `CITY_SMOKE_CHROMIUM`
 * albo z cache'u Playwrighta (`chromium_headless_shell-*`). Okna przeglądarki nie ma: to czysty headless, bez panelu w aplikacji.
 *
 * Kliknięcia w sterowanie gry (karta lokalu, ⚙, przyciski okien, dymek „OK”) są zwykłymi kliknięciami Playwrighta i porażką, gdy cel jest
 * zasłonięty albo poza ekranem (to właśnie błąd, który smoke ma łapać na telefonie). Awaryjne `click()` w DOM ma tylko pętla zamykająca okna
 * (`settle`, `pause`), a każde takie użycie ląduje w `smoke.json` (`fallbacks`).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FIXTURES_DIR = join(ROOT, 'src', 'game', 'fixtures');

// ——— stałe i czyste pomocniki (testy: tests/citySmoke.test.ts) ———

/** Domyślne miejsce Playwrighta poza projektem (jak w `scripts/tutorial-smoke.mjs`); `PLAYWRIGHT_ROOT` je nadpisuje. */
export const DEFAULT_PLAYWRIGHT_ROOT = '/opt/node-tools';
/** Flagi Chromium: grafika programowa (swiftshader), bo headless nie ma GPU. */
export const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** Rozmiary okna: telefon z dotykiem i komputer. */
export const VIEWPORTS = [
  { name: 'telefon', size: { width: 390, height: 844 }, mobile: true },
  { name: 'desktop', size: { width: 1280, height: 800 }, mobile: false },
];
/**
 * Fixtures z `src/game/fixtures/`: stary zapis schematu 2 (po dwóch remontach), zapis schematu 3 tuż przed statusem Partnera i zapis schematu 3
 * „po Traszce” (plan 4a.2: #1 i #3 otwarte, #2 zamknięty z remontem 1 i kasą samoobsługową, lokal #2 do wzięcia znów).
 */
export const FIXTURES = {
  stary: 'save-v2-remont2.json',
  przedStatusem: 'save-v3-przed-statusem.json',
  poTraszce: 'save-v3-po-traszce.json',
  dwaSklepy: 'save-v3-dwa-sklepy.json',
};
/** Pamięć samouczka: przelot pominięty, dymki „pierwszy raz” wyłączone (albo włączone w przebiegu z dymkami). */
export const tutorialMemory = (tips) => ({ v: 1, tour: 'skipped', seen: [], tips });
/**
 * Kroki smoke'a (numeracja z Zadania 16 i 9 planu 4a.2) i rozmiary, na których biegną: 6 tylko na komputerze (wypowiedzenie), 7 i 12 tylko na telefonie
 * (poziome przewijanie, angielski, FPS, nowe ekrany). Na pozostałym rozmiarze krok jest „nie dotyczy” i nie liczy się jako porażka.
 */
export const STEPS = [
  { id: 1, name: 'stary zapis: jeden sklep, mapa, karta, „Biorę lokal” zablokowany', sizes: ['telefon', 'desktop'] },
  { id: 2, name: 'fixture przed statusem + skip(30): okno ze statusem Partnera (390 px: pinezka „lokal obok” pod innymi)', sizes: ['telefon', 'desktop'] },
  { id: 3, name: 'wynajem, pinezka budowy z licznikiem, okno „Traszka #2 otwarta”', sizes: ['telefon', 'desktop'] },
  { id: 4, name: 'chip: przełączenie na #2 (inny seed sceny) i z powrotem', sizes: ['telefon', 'desktop'] },
  { id: 5, name: 'koniec miesiąca: okno „Sieć” i dwa wyciągi', sizes: ['telefon', 'desktop'] },
  { id: 6, name: 'wypowiedzenie #2: rozliczenie końcowe, jeden sklep', sizes: ['desktop'] },
  { id: 7, name: '390 px: bez poziomego przewijania, zakładki, angielski, FPS warstw', sizes: ['telefon'] },
  { id: 8, name: 'konsola i pageerror bez błędów', sizes: ['telefon', 'desktop'] },
  { id: 9, name: 'fixture po Traszce: pinezka, lista i karta z wykresem, ponowny wynajem, okno „Traszka #2 znów otwarta”, trzy sklepy', sizes: ['telefon', 'desktop'] },
  { id: 10, name: 'trzy placówki: „Biorę lokal” zablokowany tekstem Centrali', sizes: ['telefon', 'desktop'] },
  { id: 11, name: 'koniec miesiąca przy trzech sklepach: „Sieć” i trzy wyciągi, zaufanie przy każdym, podgląd końca miesiąca (390 px)', sizes: ['telefon', 'desktop'] },
  { id: 12, name: '390 px: nowe ekrany bez poziomego przewijania, po polsku i po angielsku', sizes: ['telefon'] },
];
/** Dodatkowy przebieg z dymkami miasta (Zadanie 14): tylko telefon. */
export const TIPS_STEP = { id: 'T', name: 'dymki miasta (tip-miasto, tip-lokal) na 390 px', sizes: ['telefon'] };
/**
 * Kroki etapu 4b (plan 4b, Zadanie 10): na kopii `save-v3-dwa-sklepy.json` (schemat 3, sklep #1 zamknięty, #2 aktywny, budowa #3 na jutro) z remontem 5
 * i poziomem 34 sklepu #2 oraz na kopii „po Traszce” z remontem 4 sklepu startowego i talią, która jutro może dać tylko „Zrzut Traszkomonów”.
 * Komputer w tych krokach ma 1440×900 (`DESKTOP_4B`), telefon 390×844 jak w całym smoke'u.
 */
export const STEPS_4B = [
  { id: '4b-a', name: 'zapis schematu 3 z remontem 5 i poziomem 34: wczytany bez :broken, sklep i ulica bez błędów konsoli', sizes: ['telefon', 'desktop'] },
  { id: '4b-b', name: 'dwa sklepy: „Sieć: badania” (6 wierszy, opłata koordynacyjna), kupno „Wspólne dostawy” za 25 000 zł', sizes: ['telefon', 'desktop'] },
  { id: '4b-c', name: 'limit 4 i 400 000 zł: wynajem 3. i 4. lokalu za gotówkę, cztery sklepy na liście chipa', sizes: ['telefon', 'desktop'] },
  { id: '4b-d', name: '999 500 zł do miliona: „Milion!”, Galeria nieczynna przy przerwanym /api/**, gra idzie dalej; atrapa /api/fame/*: wpis i lista', sizes: ['telefon', 'desktop'] },
  { id: '4b-e', name: 'po angielsku: sekcja badań Sieci', sizes: ['telefon', 'desktop'] },
  { id: '4b-f', name: 'zapis po Traszce z remontem 4 sklepu startowego: sklep i ulica bez błędów konsoli', sizes: ['telefon', 'desktop'] },
  { id: '4b-g', name: 'karta „Zrzut Traszkomonów” z talii, w której jutro może wypaść tylko ona', sizes: ['telefon', 'desktop'] },
];
/** Rozmiar komputera w krokach 4b (plan 4b, Zadanie 10, Step 5). */
export const DESKTOP_4B = { width: 1440, height: 900 };
/** Cena pierwszego poziomu „Wspólnych dostaw” (spec 4b §5.3) i gotówka, limit placówek oraz portfel przed milionem z kroków 4b-c i 4b-d. */
export const RESEARCH_DOSTAWY_COST = 25_000;
export const WALLET_4B_RENT = 400_000;
export const WALLET_4B_MILLION = 999_500;
export const FAME_TITLE = 'Milion!';
export const FAME_CLOSED = 'Galeria jest teraz nieczynna';
/** Krok f (plan 4b, Zadanie 11): kolejka przed sklepem przy zrzucie Traszkomonów, karta wymuszona kopertą zapisu; tylko komputer. */
export const QUEUE_STEP = { id: 'f', name: 'zrzut Traszkomonów: kolejka 6–12 postaci przed sklepem rano, po 10:00 pusto, w ramach puli postaci', sizes: ['desktop'] };

/**
 * Zapis z zrzutem Traszkomonów w toku, bez grania karty: do `econ.tycoon.cards.active` sklepu #1 dochodzi efekt ruchu `value`
 * („Bez limitu” to +1,6) od 6:00 następnej doby przez `hours` godzin, jak po odpowiedzi gracza. Zapis wczytuje się zwykłą drogą
 * (`sanitizeCards`), a smoke przewija grę do rana tej doby. Zwraca nowy tekst koperty, dobę efektu i jego minuty (`from`, `until`).
 */
export function saveWithCardDrop(saveText, { value = 1.6, hours = 4 } = {}) {
  const save = JSON.parse(saveText);
  const store = save.stores.find((s) => s.id === 1);
  if (!store) throw new Error('zapis bez sklepu #1');
  const cards = store.econ.tycoon.cards;
  const day = Math.floor(store.econ.minute / 1440) + 1;
  const from = day * 1440 + 6 * 60;
  const until = from + hours * 60;
  cards.active.push({ kind: 'traffic', value, from, until, seq: cards.seq });
  return { text: JSON.stringify(save), day, from, until };
}

/** Opcje kontekstu Playwrighta dla rozmiaru okna: zawsze `pl-PL`, dotyk tylko na telefonie. */
export function contextOptions(vp) {
  return { locale: 'pl-PL', viewport: vp.size, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile };
}

/**
 * Meta gracza z ekranu startowego, bez której gra zaczyna od ekranu „Twój kasjer”: nick, domyślny kasjer, dźwięk i wibracje wyłączone.
 * `lastSeen` to „teraz”, więc nie ma zarobku za nieobecność, a seria dni wymaga odebrania premii („Odbierz!”).
 */
export const metaFor = (now) => ({
  version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: now, sound: false, vibration: false,
  player: { nick: 'Smoke', specialOutfits: true },
});

/** Wpisy `localStorage` czystego kontekstu: meta, pamięć samouczka i zapis sklepu pod jego seedem. */
export function storageEntries({ seed, saveText, tips, now }) {
  return {
    'traszka:meta': JSON.stringify(metaFor(now)),
    'traszka:tutorial': JSON.stringify(tutorialMemory(tips)),
    [`traszka:save:${seed}`]: saveText,
  };
}

/** Zapis z fixture'a (tekst i seed z koperty): skrypt nie powtarza seedów, bierze je z pliku. */
export function fixtureSave(file, dir = FIXTURES_DIR) {
  const text = readFileSync(join(dir, file), 'utf8');
  const seed = JSON.parse(text).seed;
  if (typeof seed !== 'string' || seed === '') throw new Error(`fixture ${file} nie ma seeda`);
  return { text, seed };
}

/**
 * Wybór pakietu Playwrighta: `root` bywa katalogiem samego pakietu (`.../node_modules/playwright-core`), katalogiem `node_modules` z `playwright` lub
 * `playwright-core` albo katalogiem, w którego `node_modules` któryś z nich leży. Na końcu pakiet zainstalowany w projekcie. Zwraca moduł z `chromium`, a bez niego rzuca błąd
 * z listą prób. `makeRequire` do podmiany w testach.
 */
export function loadPlaywright(root = process.env.PLAYWRIGHT_ROOT ?? DEFAULT_PLAYWRIGHT_ROOT, makeRequire = createRequire) {
  const tries = [
    () => makeRequire(`${root}/`)(root),
    () => makeRequire(`${root}/`)('playwright'),
    () => makeRequire(`${root}/`)('playwright-core'),
    () => makeRequire(import.meta.url)('playwright'),
    () => makeRequire(import.meta.url)('playwright-core'),
  ];
  const errors = [];
  for (const attempt of tries) {
    try {
      const mod = attempt();
      if (mod?.chromium) return mod;
      errors.push('moduł bez chromium');
    } catch (error) {
      errors.push(error instanceof Error ? error.message.split('\n')[0] : String(error));
    }
  }
  throw new Error(`Nie znalazłem Playwrighta (ustaw PLAYWRIGHT_ROOT na katalog pakietu playwright-core). Próby: ${errors.join(' | ')}`);
}

/** Gdzie szukać Chromium (headless shell z cache'u Playwrighta): najnowsza wersja pierwsza. */
export function chromiumCandidates(home = homedir(), list = (dir) => readdirSync(dir)) {
  const cache = join(home, 'Library', 'Caches', 'ms-playwright');
  let dirs = [];
  try {
    dirs = list(cache).filter((d) => d.startsWith('chromium_headless_shell-'));
  } catch {
    return [];
  }
  const build = (d) => Number(d.slice('chromium_headless_shell-'.length)) || 0;
  return dirs.sort((a, b) => build(b) - build(a)).flatMap((d) => [
    join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
    join(cache, d, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
  ]);
}

/** Ścieżka do Chromium: `CITY_SMOKE_CHROMIUM`, a bez niego pierwszy istniejący kandydat; `undefined` zostawia wybór Playwrightowi. */
export function chromiumExecutable(env = process.env, exists = existsSync, candidates = chromiumCandidates()) {
  if (env.CITY_SMOKE_CHROMIUM) {
    if (!exists(env.CITY_SMOKE_CHROMIUM)) throw new Error(`CITY_SMOKE_CHROMIUM wskazuje brakujący plik: ${env.CITY_SMOKE_CHROMIUM}`);
    return env.CITY_SMOKE_CHROMIUM;
  }
  return candidates.find((c) => exists(c));
}

/** Czy adres to `/api/…` na localhost na porcie smoke'a (komunikat Chromium o przerwanym zapytaniu z kroków 4b). */
export function isApiUrl(href, port) {
  try {
    const u = new URL(href);
    return u.hostname === 'localhost' && u.port === String(port) && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Co zrobić z zapytaniem strony: `allow` (http na localhost i porcie smoke'a, `blob:` i `data:`), `api` (`/api/**`: przerywamy, ranking jest poza
 * smoke'em) albo `external` (każdy inny host: blokujemy i liczymy). Host liczy się ze sparsowanego adresu.
 */
export function requestVerdict(href, port) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return 'external';
  }
  if (url.protocol === 'blob:' || url.protocol === 'data:' || url.protocol === 'about:') return 'allow';
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === String(port);
  if (!local) return 'external';
  return url.pathname === '/api' || url.pathname.startsWith('/api/') ? 'api' : 'allow';
}

/** Odczyt nakładki FPS: pary etykieta → liczba z jej wierszy (`[['FPS', '12'], ['Klatka', '83.3 ms'], ...]`). */
export function parsePerf(rows) {
  const num = (s) => Number(String(s).replace(/[^0-9.,-]/g, '').replace(/\s/g, '').replace(',', '.'));
  const [fps, ms, calls, tris] = rows.map(([, v]) => num(v));
  return { fps, ms, calls, tris };
}

export const median = (xs) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Zakres pomiarów szerokości na telefonie: ekrany, na których `scrollWidth` ma się mieścić w 390 px. */
export const PHONE_WIDTH = 390;

/** Wynik kroku: `ok`, lista nieudanych sprawdzeń, uwagi (dowody) i, gdy kroku nie było na tym rozmiarze, `na`. */
export const stepResult = (patch = {}) => ({ ok: true, failed: [], notes: [], na: false, ...patch });

/**
 * Tabela wyników do raportu: wiersz na krok i rozmiar (`ok`, `FAIL`, `n/d`) z pierwszą przyczyną porażki. `results`: nazwa rozmiaru →
 * identyfikator kroku → `stepResult`.
 */
export function summarize(results, steps = [...STEPS, TIPS_STEP, ...STEPS_4B]) {
  const rows = [];
  for (const [size, byStep] of Object.entries(results)) {
    if (byStep.exception) rows.push({ size, step: '!', name: 'wyjątek poza krokiem', status: 'FAIL', detail: byStep.exception.failed[0] ?? '' });
    for (const step of steps) {
      if (!step.sizes.includes(size)) continue;
      const r = byStep[step.id];
      const status = !r ? 'FAIL' : r.na ? 'n/d' : r.ok ? 'ok' : 'FAIL';
      rows.push({ size, step: step.id, name: step.name, status, detail: !r ? 'krok się nie wykonał' : r.failed[0] ?? '' });
    }
  }
  return { rows, ok: rows.every((r) => r.status !== 'FAIL') };
}

export const USAGE = `Smoke miasta i drugiego sklepu w headless Chromium (po \`npm run build\`).

Użycie: node scripts/city-smoke.mjs [--only telefon|desktop] [--etap 4b]
        npm run city:smoke

  --only <rozmiar>  tylko jeden rozmiar okna: telefon (390×844, dotyk) albo desktop (1280×800; w krokach 4b 1440×900)
  --etap 4b         tylko kroki etapu 4b (4b-a…4b-g) i konsola (krok 8); reszta „nie dotyczy”
  --help            ta pomoc

Zmienne: PLAYWRIGHT_ROOT (domyślnie ${DEFAULT_PLAYWRIGHT_ROOT}), CITY_SMOKE_CHROMIUM, CITY_SMOKE_PORT (4318), CITY_SMOKE_OUT (.smoke/city).
Zrzuty i smoke.json idą do katalogu wyjściowego (w .gitignore). Kod wyjścia: 0 (wszystkie kroki ok), 1 (porażka kroku), 2 (błąd uruchomienia).`;

/**
 * Argumenty polecenia: `--only telefon|desktop` ogranicza przebieg do jednego rozmiaru (do ponawiania pojedynczej porażki), `--etap 4b` do kroków
 * etapu 4b (`stage`).
 */
export function parseArgs(argv) {
  const args = { only: null, help: false, stage: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--etap') {
      const v = argv[++i];
      if (v !== '4b') throw new Error(`--etap przyjmuje 4b, dostałem „${v ?? ''}”`);
      args.stage = v;
    } else if (a === '--only') {
      const v = argv[++i];
      const name = VIEWPORTS.find((vp) => vp.name === v || (v === 'phone' && vp.mobile))?.name;
      if (!name) throw new Error(`--only przyjmuje telefon albo desktop, dostałem „${v ?? ''}”`);
      args.only = name;
    } else throw new Error(`nieznany argument „${a}”`);
  }
  return args;
}

/**
 * Czy `vite preview` napisał, że stoi na naszym porcie (`Local: http://localhost:<port>/`, bez kodów kolorów). Sama odpowiedź na zapytanie
 * nie wystarcza: na porcie może stać obcy serwer, a nasz proces wtedy padł (`--strictPort`).
 */
export function previewReady(log, port) {
  const text = String(log).replace(/\u001b\[[0-9;]*m/g, '');
  return text.includes(`http://localhost:${port}`);
}

/**
 * Wady szerokości z pomiaru strony (`scroll`: `documentElement.scrollWidth`; `boxes`: widoczne okna, arkusz, karta i lista sklepów z ramką,
 * `scrollWidth` i `clientWidth`). Okno modalne to `position: fixed` z własnym przewijaniem, więc jego poziomy wylew nie zmienia
 * `scrollWidth` dokumentu: każdy element sprawdza się osobno, jego zawartością (`scroll <= client + 1`) i ramką w `[0, limit]`.
 */
export function widthProblems(m, limit = PHONE_WIDTH) {
  const out = [];
  if (m.scroll > limit) out.push(`dokument ${m.scroll} px (limit ${limit})`);
  for (const b of m.boxes ?? []) {
    if (b.scroll > b.client + 1) out.push(`${b.name}: zawartość ${b.scroll} px w ${b.client} px`);
    if (b.left < -0.5 || b.right > limit + 0.5) out.push(`${b.name}: poza oknem [${Math.round(b.left)}, ${Math.round(b.right)}]`);
  }
  return out;
}

// ——— plan 4a.2 (Zadanie 9): stałe i czyste pomocniki kroku 2 (dopisek) i 9–12 (testy: tests/citySmoke.test.ts) ———

/** Ile pakietu kosztuje ponowny wynajem lokalu „po Traszce” (`RELET_SHARE` w `src/sim/firm/commands.ts`; test pilnuje zgodności). */
export const RELET_SHARE = 0.3;
/** Cena ponownego wynajmu (`rentPrice` dla lokalu „po Traszce”): `round(pakiet × 0,3 / 100) × 100`, jak pakiet co 100 zł. */
export const reletPrice = (pkg) => Math.round((pkg * RELET_SHARE) / 100) * 100;
/** Dni budowy w lokalu „po Traszce” (`RELET_BUILD_DAYS` w `src/sim/firm/commands.ts`; test pilnuje zgodności). */
export const RELET_BUILD_DAYS = 2;
/** Liczba dni tak, jak ją piszą karta lokalu i pinezka budowy: „1 dzień”, „2 dni”. */
export const daysText = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;
/** Słupki wykresu godzin na karcie lokalu: godziny otwarcia 6–22 (`HourChart.tsx`). */
export const HOUR_BARS = 17;
/** Próg ostrzeżenia o zaufaniu sklepu w tle na liście chipa (`BACKGROUND_TRUST_WARN_BELOW` w `storeSwitcherModel.ts`, czyli dolna granica poziomu „Pod obserwacją”; test pilnuje zgodności). */
export const BACKGROUND_TRUST_WARN_BELOW = 40;
/** Zaufanie ponownie otwartego sklepu (`TRUST.start`): okno „znów otwarta” je podaje, a dane sklepu mają je potwierdzić. */
export const RELET_TRUST = 65;
/** Dosłowne teksty z planu: odmowa limitu, tytuł okna ponownego otwarcia i podpis zniżki na karcie lokalu po Traszce. */
export const LIMIT_TEXT = 'Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy 1\u00a0000\u00a0000 zł.';   // limit 3 (`limitText`): próg obrotu sieci do czwartej placówki, z twardymi spacjami tysięcy
export const RELET_TITLE = 'Traszka #2 znów otwarta';
export const RELET_CAPTION = 'po Traszce: 30% ceny';

/** Minuta doby, o której otwiera się sklep z budowy (`OPEN_FROM` = 6:00; test pilnuje zgodności). */
export const OPEN_MINUTE = 6 * 60;

/** Same cyfry z napisu („11 250 zł” z twardą spacą → 11250). */
export const digitsOf = (text) => Number(String(text).replace(/\D/g, ''));

/**
 * Wyposażenie zamkniętych sklepów z koperty zapisu (to, co zostaje w lokalu „po Traszce”): numer sklepu, lokal, poziom remontu, sprzęt i suma
 * poziomów ulepszeń. Smoke porównuje z tym kartę i ponownie otwarty sklep, więc „remont z fixture'a” nie jest wpisany na sztywno.
 */
export function closedFittings(saveText) {
  const env = JSON.parse(saveText);
  return (env.stores ?? []).filter((st) => st.closed).map((st) => ({
    id: st.id, lotId: st.lotId, remontLevel: st.econ.remontLevel, equipment: (st.econ.equipment ?? []).map((e) => e.id),
    upgrades: Object.values(st.econ.upgrades ?? {}).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0),
  }));
}

/** Blok „Wyposażenie zostało” na karcie lokalu po Traszce (polski tekst z `LotCard.tsx`). */
export const reletBlockText = (fit) => `Wyposażenie zostało: remont ${fit.remontLevel}, sprzęt ${fit.equipment.length} szt., ulepszenia ${fit.upgrades}`;

/** Rata i liczba rat z przycisku „na raty 1 077 zł × 12 z przelewów tego sklepu” (polska karta lokalu); null, gdy napis ma inny kształt. */
export function parseInstallmentButton(text) {
  const m = /na raty ([\d\s  ]+) zł × (\d+)/.exec(String(text));
  return m ? { monthly: digitsOf(m[1]), months: Number(m[2]) } : null;
}

/** Zaufania z wierszy „zaufanie N” (po angielsku „trust N”) pod wierszami „Zostaje Ci” w oknie sieci; reszta wierszy jest pomijana. */
export function trustRowValues(rows, word = 'zaufanie') {
  const re = new RegExp(`^${word} (\\d+)$`);
  return rows.flatMap((r) => {
    const m = re.exec(String(r).trim());
    return m ? [Number(m[1])] : [];
  });
}

/** Pole przecięcia dwóch ramek `{l, t, r, b}` w px² (0, gdy się nie stykają albo tylko dotykają, z tolerancją na zaokrąglenia). */
export function overlapArea(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0.5 && h > 0.5 ? Math.round(w * h) : 0;
}

/**
 * Wady pinezki „lokal obok” z pomiaru strony (`m.width`: szerokość okna, `m.pins`: pinezki z rodzajem, `z`-indexem, ramką (null, gdy ukryta),
 * napisem z jego ramką i `display` oraz listą pinezek, które obok zasłania w punkcie ich środka). Lokal obok leży z założenia pod innymi
 * pinezkami (zIndex 0) i na wąskim ekranie nie ma napisu (CSS ≤ 899 px), więc sprawdzamy to, co zgłosił przegląd: napis nie wchodzi na sąsiednie pinezki
 * (ukryty na wąskim ekranie, a gdy ma ramkę, to bez przecięć), pinezka leży pod pozostałymi i niczego nie zasłania. Przecięcia samej kartki z ramkami
 * innych pinezek nie są wadą (lokal obok sąsiaduje z Twoim sklepem, więc kartki z natury zachodzą na siebie, a tu leży ona pod spodem), tylko dowodem: zwraca je `overlaps`.
 */
export function pinProblems(m, narrow = 899) {
  const problems = [];
  const overlaps = [];
  const obok = m.pins.filter((p) => p.kind === 'obok' && p.box);
  const others = m.pins.filter((p) => p.kind !== 'obok' && p.box);
  if (obok.length === 0) problems.push('brak pinezki „lokal obok” na ekranie');
  const lowest = Math.min(...others.map((p) => p.z));
  for (const o of obok) {
    if (m.width <= narrow && o.label && o.label.display !== 'none') problems.push(`napis „${o.label.text}” pinezki obok (lokal ${o.lot}) widoczny na ${m.width} px (display ${o.label.display})`);
    if (o.label?.box) {
      for (const p of others) {
        const area = overlapArea(o.label.box, p.box);
        if (area > 0) problems.push(`napis pinezki obok (lokal ${o.lot}) przecina pinezkę ${p.kind} (lokal ${p.lot}): ${area} px²`);
      }
    }
    if (others.length > 0 && !(o.z <= lowest)) problems.push(`pinezka obok (lokal ${o.lot}) ma z-index ${o.z}, a inna pinezka ${lowest}: nie leży pod spodem`);
    if (o.covers.length > 0) problems.push(`pinezka obok (lokal ${o.lot}) zasłania pinezki: ${o.covers.join(', ')}`);
    for (const p of others) {
      const area = overlapArea(o.box, p.box);
      if (area > 0) overlaps.push({ lot: o.lot, with: p.lot, kind: p.kind, area });
    }
  }
  return { problems, overlaps };
}

/**
 * Nowe ekrany kroku 12 i ile pomiarów szerokości każdy ma mieć (okno sieci i podgląd końca miesiąca to „Sieć” i trzy sklepy). Etykieta pomiaru
 * zaczyna się od nazwy ekranu, po angielsku od „angielski: ” i nazwy.
 */
export const NEW_SCREENS = [
  { name: 'karta lokalu z wykresem', min: 1 },
  { name: 'karta lokalu po Traszce', min: 1 },
  { name: 'lista sklepów (trzy)', min: 1 },
  { name: 'okno sieci (cztery zakładki)', min: 4 },
  { name: 'podgląd końca miesiąca (cztery zakładki)', min: 4 },
];

/** Wady pomiarów szerokości nowych ekranów (`widths`: wpisy `checkWidth`): ekran bez wystarczającej liczby pomiarów albo z wadą szerokości. */
export function newScreenProblems(widths, prefix = '') {
  const out = [];
  for (const screen of NEW_SCREENS) {
    const mine = widths.filter((w) => w.label.startsWith(`${prefix}${screen.name}`));
    if (mine.length < screen.min) out.push(`${prefix}${screen.name}: zmierzono ${mine.length} z ${screen.min}`);
    for (const w of mine.filter((x) => !x.ok)) out.push(`${w.label}: ${w.problems.join('; ')}`);
  }
  return out;
}

// ——— etap 4b (Zadanie 10): koperty zapisów do kroków 4b (testy: tests/citySmoke.test.ts) ———

/** Kopia koperty zapisu firmy, w której sklep `storeId` ma remont `remontLevel` i poziom `level` (układ gra liczy przy wczytaniu z poziomu remontu). */
export function withRemont(saveText, { storeId, remontLevel, level }) {
  const save = JSON.parse(saveText);
  const st = save.stores.find((x) => x.id === storeId);
  if (!st || st.closed) throw new Error(`w zapisie nie ma otwartego sklepu #${storeId}`);
  st.econ.remontLevel = remontLevel;
  st.econ.level = level;
  return JSON.stringify(save);
}

/** Identyfikatory kart talii dnia (`DECK`) z kodu `deck.ts`: wszystko między `export const DECK` a `export const CIRCULARS`. */
export function deckIds(source) {
  const from = source.indexOf('export const DECK');
  const to = source.indexOf('export const CIRCULARS');
  if (from < 0 || to < from) throw new Error('deck.ts: nie widzę DECK i CIRCULARS');
  return [...source.slice(from, to).matchAll(/^ {4}id: '([a-z0-9-]+)',$/gm)].map((m) => m[1]);
}

/**
 * Kopia koperty, w której talia sklepu `storeId` jutro może dać tylko kartę `cardId` (deterministycznie, bez losu): pusta kolejka i `seq` 1 (pierwsza karta
 * gry, więc jutro co najmniej jedna karta), okólnik dopiero za tydzień, a każda inna karta talii „była dziś” (każda ma przerwę ≥ 2 dni). Dzień
 * zapisu to dzień minuty sklepu; losowanie dnia w grze (`drawDayCards`) robi resztę, z prawdziwymi liczbami i szacunkami karty.
 */
export function withOnlyCardTomorrow(saveText, { storeId, cardId, ids }) {
  const save = JSON.parse(saveText);
  const st = save.stores.find((x) => x.id === storeId);
  if (!st || st.closed) throw new Error(`w zapisie nie ma otwartego sklepu #${storeId}`);
  if (!ids.includes(cardId)) throw new Error(`karty ${cardId} nie ma w talii`);
  const day = Math.floor(st.econ.minute / 1440);
  const cards = st.econ.tycoon.cards;
  cards.pending = [];
  cards.seq = 1;
  cards.drawnDay = day;
  cards.nextCircularDay = day + 7;
  cards.lastSeen = Object.fromEntries(ids.filter((id) => id !== cardId).map((id) => [id, day]));
  return JSON.stringify(save);
}

// ——— przeglądarka ———

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => Math.round(n).toLocaleString('pl-PL');

/** Odczyt stanu gry z uchwytu `window.traszkaGame` (jest tylko pod `?debug=1`): firma, sklepy, budowy i seed sceny. */
function readGame(page) {
  return page.evaluate(() => {
    const g = window.traszkaGame;
    const s = g.session;
    const f = s.firm ?? null;
    return {
      seed: s.seed,
      activeSeed: s.econ.seed,
      sceneSeed: g.world?.seed ?? null,
      minute: s.econ.minute,
      day: Math.floor(s.econ.minute / 1440),
      gameOver: !!s.econ.gameOver,
      remont: s.econ.remontLevel,
      history: s.econ.history.map((h) => Math.round(h.profit)),
      trust: s.econ.tycoon.trust.value,
      firm: f !== null,
      over: f?.over ?? null,
      partner: f?.person.partner ?? false,
      wallet: f ? f.person.wallet : s.econ.cash,
      activeId: f?.activeId ?? 1,
      builds: (f?.builds ?? []).map((b) => ({ ...b })),
      stores: (f?.stores ?? [{ id: 1, lotId: -1, econ: s.econ, closed: false, notice: null }]).map((st) => ({
        id: st.id, lotId: st.lotId, seed: st.econ.seed, closed: st.closed, notice: st.notice, minute: st.econ.minute,
        trust: st.econ.tycoon.trust.value, gameOver: !!st.econ.gameOver, remont: st.econ.remontLevel,
        level: st.econ.level, equipment: st.econ.equipment.map((e) => e.id), reopened: st.reopened === true,
        installments: st.econ.franchisee.installments.map((i) => ({
          label: i.label, price: i.price, fee: i.fee, total: i.total, monthly: i.monthly, months: i.months, paid: i.paid,
        })),
      })),
      inbox: f?.inbox.length ?? 0,
    };
  });
}

/** Rząd lokali do wzięcia z listy Miasta razem z danymi z miasta firmy (pakiet, dni budowy) i tym, co lista pokazuje (znacznik „po Traszce”, cena w wierszu). */
function readLots(page) {
  return page.evaluate(() => {
    const f = window.traszkaGame.session.firm;
    return [...document.querySelectorAll('.tt-lotrow')].map((r) => {
      const id = Number(r.dataset.lot);
      const lot = f.city.lots[id];
      return {
        id, price: lot.package, buildDays: lot.buildDays, street: lot.street, number: lot.number, district: lot.district,
        addr: (r.querySelector('.tt-lotaddr')?.firstChild?.textContent ?? '').trim(),
        relet: !!r.querySelector('.tt-dz.relet'), priceText: (r.querySelector('.tt-lotprice-sm')?.textContent ?? '').trim(),
      };
    });
  });
}

/** Czy element `sel` jest na ekranie (ma niepustą ramkę). */
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getBoundingClientRect().height > 0; }, sel);
const textOf = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);

/**
 * Kliknięcie w sterowanie gry: zwykłe kliknięcie Playwrighta z jego kontrolą (widoczny, nie zasłonięty, w oknie). Błąd to porażka kroku:
 * przycisk zasłonięty albo poza ekranem telefonu to dokładnie to, co smoke ma łapać.
 */
async function press(page, sel, timeout = 8_000) {
  await page.click(sel, { timeout });
}

/** Wspólne ustawienia infrastruktury: pomiar szerokości okien (telefon) i lista awaryjnych kliknięć w DOM. */
const hooks = { onDialog: null, fallbacks: [] };

/**
 * Zamykanie okna przez pętlę `settle`: zwykłe kliknięcie, a gdy się nie uda (okno, które gra właśnie zamyka, baner, który przez chwilę zasłania
 * przycisk), awaryjne `click()` w DOM, zapisane w `hooks.fallbacks`. Tylko dla infrastruktury zamykającej okna, nie dla sterowania sprawdzanego w krokach.
 */
async function dismiss(page, sel, timeout = 6_000) {
  try {
    await page.click(sel, { timeout });
  } catch (error) {
    const done = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
    if (!done) throw error;
    hooks.fallbacks.push(`${sel} (${String(error.message).split('\n')[0]})`);
  }
}

/** Stuknięcie w tło (`sel`) poza oknem, które je przykrywa: punkt, w którym `elementFromPoint` trafia właśnie w ten element. */
async function tapOutside(page, sel) {
  const at = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    for (let y = innerHeight - 12; y > 0; y -= 24) {
      for (let x = 12; x < innerWidth; x += 24) if (document.elementFromPoint(x, y) === el) return { x, y };
    }
    return null;
  }, sel);
  if (!at) throw new Error(`nie ma punktu, w który da się stuknąć ${sel}`);
  await page.mouse.click(at.x, at.y);
}

async function windowsOf(page) {
  return page.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tipEl = document.querySelector('.tt-tip-bubble');
    const tip = tipEl && vis(tipEl) && tipEl.style.opacity !== '0' ? (tipEl.dataset.tip ?? '') : null;
    const dialogs = [];
    for (const m of document.querySelectorAll('.tt-modal-wrap .tt-modal')) {
      if (!vis(m)) continue;
      const cls = m.classList;
      const kind = cls.contains('tt-deck') ? 'deck' : cls.contains('tt-story') ? 'story' : cls.contains('tt-remanent') ? 'remanent' : cls.contains('tt-fame') ? 'fame'
        : m.querySelector('h2[data-tut="report"]') ? 'report' : cls.contains('tt-tut-offer') ? 'offer' : cls.contains('tt-center') ? 'welcome' : 'other';
      dialogs.push({ kind, label: m.getAttribute('aria-label') ?? m.querySelector('h2')?.textContent ?? '', text: m.textContent ?? '', tabs: m.querySelectorAll('.tt-storetabs [role="tab"]').length });
    }
    return { tip, dialogs };
  });
}

const CLOSE = {
  deck: '.tt-deck .tt-primary',
  story: '.tt-story .tt-primary',
  remanent: '.tt-remanent .tt-primary',
  report: '.tt-modal:has(h2[data-tut="report"]) .tt-modal-foot .tt-primary',
  welcome: '.tt-modal.tt-center .tt-primary',
  // 4b: gratulacje za pierwszy milion („Zamknij”, bez wpisu do Galerii); stary zapis z gotówką ≥ 1 mln dostaje je zaraz po wczytaniu
  fame: '.tt-fame .tt-finish-actions > .tt-btn:last-child',
};

/**
 * Zamyka to, co gra otworzyła w międzyczasie (okna modalne pauzują grę i łykają kliknięcia): kartę decyzji („Zatwierdź”), wpis „OK”, protokół
 * remanentu, raport („Dalej”), powitanie („Odbierz!”), gratulacje za milion („Zamknij”) i dymki „pierwszy raz” (poza `keepTips`). `stop`: wyrażenie, które zatrzymuje pętlę
 * na pierwszym oknie o pasującym tytule, zanim je zamknie (smoke chce je obejrzeć). Zwraca tytuły zamkniętych okien i tytuł okna, na którym stanęła.
 * Koniec gry w trakcie to błąd smoke'a: raport końca gry ma inny przycisk, a dalsze kroki nie mają sensu.
 */
async function settle(page, { keepTips = [], stop = null, max = 80 } = {}) {
  const closed = [];
  let idle = 0;
  for (let i = 0; i < max; i++) {
    const w = await windowsOf(page);
    if (stop) {
      const hit = w.dialogs.find((d) => stop.test(d.label));
      if (hit) return { closed, stopped: hit };
    }
    const dialog = w.dialogs.find((d) => CLOSE[d.kind]);
    if (dialog) {
      idle = 0;
      if (dialog.kind === 'story' || dialog.kind === 'remanent') await sleep(450);   // karencja okna: „OK” wcześniej nic nie robi
      if (dialog.kind === 'report' && (await page.evaluate(() => !!window.traszkaGame.session.econ.gameOver))) {
        throw new Error(`koniec gry w trakcie smoke'a: ${dialog.label}`);
      }
      await hooks.onDialog?.(page, dialog);
      await dismiss(page, CLOSE[dialog.kind]);
      closed.push(dialog.label);
      await sleep(dialog.kind === 'deck' ? 250 : 150);
      continue;
    }
    if (w.tip !== null && !keepTips.includes(w.tip)) {
      idle = 0;
      await dismiss(page, '.tt-tip-bubble .tt-tut-next');
      closed.push(`dymek ${w.tip}`);
      await sleep(150);
      continue;
    }
    if (++idle >= 3) return { closed, stopped: null };
    await sleep(150);
  }
  throw new Error('okna gry nie ustępują (settle)');
}

const speedOn = (page) => page.evaluate(() => document.querySelector('[data-tut="speed"] .tt-btn.on')?.textContent ?? null);
/**
 * Pauza (pierwszy przycisk prędkości): czas przesuwa wtedy tylko `skip`. Okno modalne łyka kliknięcia (a gra, która ruszyła przed
 * pauzą, potrafi je otworzyć, np. koniec remontu z zapisu), więc po nieudanym kliknięciu zamykamy okna i próbujemy jeszcze raz.
 */
async function pause(page) {
  for (let i = 0; i < 6; i++) {
    if ((await speedOn(page)) === '❚❚') return;
    try {
      await page.click('[data-tut="speed"] .tt-btn', { timeout: 2_000 });
    } catch {
      await settle(page);
    }
  }
  if ((await speedOn(page)) !== '❚❚') throw new Error('nie udało się zatrzymać czasu');
}

async function waitReady(page) {
  await page.waitForFunction(() => !!window.traszkaGame?.session && !!document.querySelector('.tt-tabs'), null, { timeout: 240_000 });
  await sleep(400);
}

const skip = (page, minutes) => page.evaluate((m) => window.traszkaGame.skip(m), minutes);

async function openTab(page, id) {
  const on = await page.evaluate((i) => document.querySelector(`[data-tut="tab-${i}"]`)?.getAttribute('aria-pressed') === 'true', id);
  if (!on) await page.click(`[data-tut="tab-${id}"]`);
  await sleep(300);
}
async function closeTab(page, id) {
  const on = await page.evaluate((i) => document.querySelector(`[data-tut="tab-${i}"]`)?.getAttribute('aria-pressed') === 'true', id);
  if (on) await page.click(`[data-tut="tab-${id}"]`);
  await sleep(300);
}

/** Czeka, aż `fn` (wykonywana w stronie) zwróci prawdę; po czasie błąd z `what`. */
async function until(page, fn, arg, what, timeout = 30_000) {
  try {
    await page.waitForFunction(fn, arg, { timeout });
  } catch {
    throw new Error(`nie doczekałem się: ${what}`);
  }
}

/**
 * Przewija grę kawałkami po `chunk` minut (`skip` staje na każdej karcie decyzji, więc doba bywa kilka kawałków), zamykając okna, aż
 * pojawi się okno o tytule pasującym do `stop` (zwraca je, jeszcze otwarte), `done(stan)` da prawdę albo minie `maxDays` dni od startu.
 * Zwraca też tytuły okien zamkniętych po drodze. Czas liczy się dniami gry, a nie liczbą kawałków.
 */
async function advance(page, { stop = null, maxDays, chunk = 1440, done = null }) {
  const startDay = (await readGame(page)).day;
  const closed = [];
  for (let i = 0; i < 4_000; i++) {
    await skip(page, chunk);
    const r = await settle(page, { stop });
    closed.push(...r.closed);
    if (r.stopped) return { stopped: r.stopped, closed, game: null };
    const game = await readGame(page);
    if ((done && done(game)) || game.day - startDay > maxDays) return { stopped: null, closed, game };
  }
  throw new Error('advance: gra nie posuwa się naprzód');
}

// ——— serwer ———

/**
 * Uruchamia `vite preview` na `port` (`--strictPort`) i czeka, aż sam napisze, że stoi na tym porcie. Odpowiedź na zapytanie nie wystarcza:
 * gdy port zajmuje obcy serwer, nasz proces pada, a pierwsze `fetch` trafiłoby w tamten. Przed zaufaniem odpowiedzi proces musi żyć.
 */
async function startPreview(port) {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', 'localhost'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  proc.on('error', (e) => { log += String(e); });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null || proc.signalCode !== null) break;
    if (previewReady(log, port)) {
      try {
        if ((await fetch(base)).ok && proc.exitCode === null) return proc;
      } catch { /* jeszcze wstaje */ }
    }
    await sleep(200);
  }
  stopPreview(proc);
  throw new Error(`vite preview nie wstał na ${base} (zajęty port albo błąd): ${log.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(-300)}`);
}
function stopPreview(proc) {
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill(); } catch { /* już zamknięty */ } }
}

// ——— bieg ———

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const port = Number(process.env.CITY_SMOKE_PORT ?? 4318);
  const base = `http://localhost:${port}`;
  const out = process.env.CITY_SMOKE_OUT ?? join(ROOT, '.smoke', 'city');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('Brak dist/: najpierw `npm run build`.');
  const { chromium } = loadPlaywright();
  const executablePath = chromiumExecutable();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const old = fixtureSave(FIXTURES.stary);
  const before = fixtureSave(FIXTURES.przedStatusem);
  const after = fixtureSave(FIXTURES.poTraszce);
  const two = fixtureSave(FIXTURES.dwaSklepy);

  const errors = [];
  const warnings = [];
  const external = [];
  const apiBlocked = [];
  const apiConsole = [];
  const dialogs = [];
  const results = {};
  const extras = {};

  // --- kontekst i strona ---

  async function newPage(browser, vp, tag, { fixture, tips = false, quality = 'niska' }) {
    const ctx = await browser.newContext(contextOptions(vp));
    // najpierw ogólna blokada, potem `/api/**` (późniejsza trasa ma pierwszeństwo): niczego nie wysyłamy do rankingu
    await ctx.route('**/*', (route) => {
      const verdict = requestVerdict(route.request().url(), port);
      if (verdict === 'allow') return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await ctx.route('**/api/**', (route) => {
      apiBlocked.push(`${vp.name}/${tag}: ${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    });
    const entries = storageEntries({ seed: fixture.seed, saveText: fixture.text, tips, now: Date.now() });
    // wstawiamy raz na kartę (sessionStorage przeżywa przeładowanie ze zmianą języka, a zapis gry nie może wrócić do fixture'a)
    await ctx.addInitScript((e) => {
      try {
        if (sessionStorage.getItem('citysmoke:seeded')) return;
        for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
        sessionStorage.setItem('citysmoke:seeded', '1');
      } catch { /* bez magazynu gra i tak nie ruszy */ }
    }, entries);
    const page = await ctx.newPage();
    page.on('console', (m) => {
      // przerwane przez smoke zapytanie do `/api/**` (Galeria i ranking w krokach 4b) Chromium sam zgłasza w konsoli: to nie jest błąd gry
      if (m.type() === 'error' && /^Failed to load resource: net::ERR_FAILED$/.test(m.text()) && isApiUrl(m.location()?.url ?? '', port)) apiConsole.push(`${vp.name}/${tag}: ${m.location().url}`);
      else if (m.type() === 'error') errors.push(`${vp.name}/${tag}: ${m.text()}`);
      else if (m.type() === 'warning') warnings.push(`${vp.name}/${tag}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`${vp.name}/${tag}: pageerror ${e.message}`));
    page.on('dialog', (d) => { dialogs.push(`${vp.name}/${tag}: ${d.type()} ${d.message().slice(0, 80)}`); void d.accept(); });
    await page.goto(`${base}/?seed=${encodeURIComponent(fixture.seed)}&q=${quality}&debug=1`);
    return { ctx, page };
  }

  const shot = async (page, vp, name) => {
    await page.screenshot({ path: join(out, `${vp.name}-${name}.jpg`), type: 'jpeg', quality: 80, timeout: 120_000 });
    return `${vp.name}-${name}.jpg`;
  };

  // --- ewidencja kroków ---

  /** Uruchamia krok i zbiera jego sprawdzenia; wyjątek to porażka z przyczyną, a zrzut `fail-…` zostaje do oględzin. */
  async function runStep(vp, id, page, fn) {
    const r = stepResult();
    (results[vp.name] ??= {})[id] = r;
    const ev = {
      note: (s) => { r.notes.push(s); },
      check: (ok, what) => { if (!ok) { r.ok = false; r.failed.push(what); } return ok; },
      shot: async (name) => { r.notes.push(`zrzut ${await shot(page, vp, name)}`); },
    };
    const started = Date.now();
    try {
      await fn(ev);
      if (!r.ok) await shot(page, vp, `fail-${id}`);   // porażka sprawdzenia: zrzut stanu, w którym padło
    } catch (error) {
      r.ok = false;
      r.failed.push(`wyjątek: ${error instanceof Error ? error.message : String(error)}`);
      try { await shot(page, vp, `fail-${id}`); } catch { /* strona mogła paść */ }
    }
    r.seconds = Math.round((Date.now() - started) / 1000);
    console.log(`  [${vp.name}] krok ${id}: ${r.ok ? 'ok' : 'FAIL'}${r.ok ? '' : ` (${r.failed[0]})`}`);
    return r.ok;
  }

  // --- pomiary szerokości (telefon) ---

  const widths = [];
  /**
   * Szerokość strony i każdego widocznego okna, arkusza, karty lokalu i listy sklepów (`widthProblems`): `scrollWidth` dokumentu nie zobaczy
   * wylewu wewnątrz okna modalnego (`position: fixed`, własne przewijanie), więc te elementy mierzy się osobno.
   */
  async function checkWidth(page, label) {
    const m = await page.evaluate(() => {
      const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const name = (el) => `${[...el.classList].slice(0, 2).join('.')}${el.getAttribute('aria-label') ? ` [${el.getAttribute('aria-label')}]` : ''}`;
      // elementy, które wystają za prawą krawędź okna: do diagnozy wylewu (kto go robi), nie do oceny
      const culprits = (el, right) => [...el.querySelectorAll('*')].filter((d) => d.getBoundingClientRect().right > right + 1 && d.getBoundingClientRect().width > 0)
        .slice(0, 3).map((d) => `${d.tagName.toLowerCase()}.${[...d.classList].join('.')} → ${Math.round(d.getBoundingClientRect().right)} px „${(d.textContent ?? '').trim().slice(0, 40)}”`);
      const boxes = [...document.querySelectorAll('.tt-modal, .tt-sheet, .tt-sheet-body, .tt-lotcard, .tt-stores-pop')].filter(vis).map((el) => {
        const b = el.getBoundingClientRect();
        const over = el.scrollWidth > el.clientWidth + 1;
        return { name: name(el), left: b.left, right: b.right, scroll: el.scrollWidth, client: el.clientWidth, ...(over ? { culprits: culprits(el, b.right) } : {}) };
      });
      return { scroll: document.documentElement.scrollWidth, boxes };
    });
    const problems = widthProblems(m, PHONE_WIDTH);
    for (const b of m.boxes) if (b.culprits?.length) problems.push(`${b.name} wystaje: ${b.culprits.join('; ')}`);
    widths.push({ label, scroll: m.scroll, boxes: m.boxes.length, problems, ok: problems.length === 0 });
    return widths.at(-1);
  }
  async function tabsFit(page) {
    return page.evaluate(() => {
      const nav = document.querySelector('.tt-tabs');
      const tabs = [...(nav?.querySelectorAll('.tt-tab') ?? [])];
      const rects = tabs.map((b) => b.getBoundingClientRect());
      const labels = [...(nav?.querySelectorAll('.tt-tab-label') ?? [])].map((l) => ({ text: l.textContent, cut: l.scrollWidth > l.clientWidth + 1 }));
      return {
        count: tabs.length,
        inside: rects.every((r) => r.left >= -0.5 && r.right <= window.innerWidth + 0.5 && r.width > 30),
        navFits: !!nav && nav.scrollWidth <= nav.clientWidth + 1,
        cut: labels.filter((l) => l.cut).map((l) => l.text),
      };
    });
  }

  // --- helpery ruchu w grze ---

  /** Wybiera lokal z listy Miasta (stuknięcie w wiersz) i czeka na kartę. */
  async function pickLot(page, lotId) {
    await page.click(`.tt-lotrow[data-lot="${lotId}"]`);
    await page.waitForSelector('.tt-lotcard', { timeout: 15_000 });
    await sleep(250);
  }
  /**
   * Stuknięcie w pinezkę lokalu na mapie (kartka wolnego lokalu, „po Traszce”), jeśli któryś punkt pinezki leży na wierzchu (etykiety konkurencji
   * i inne pinezki bywają nad nią); false, gdy zasłania ją arkusz, pasek albo inne pinezki w całości.
   */
  async function tapPin(page, lotId) {
    const at = await page.evaluate((id) => {
      const pin = document.querySelector(`.tt-cpin[data-lot="${id}"]`);
      if (!pin) return null;
      const r = pin.getBoundingClientRect();
      if (r.width <= 0) return null;
      for (const fy of [0.6, 0.45, 0.75, 0.3, 0.9]) {
        for (const fx of [0.5, 0.3, 0.7]) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && pin.contains(hit)) return { x, y };
        }
      }
      return null;
    }, lotId);
    if (!at) return false;
    await page.mouse.click(at.x, at.y);
    return true;
  }

  /**
   * Krok 2 (dopisek, telefon): pinezka „lokal obok” (fixture „przed statusem”, sklep #1 jeszcze bez remontu, więc sąsiad czeka na remont) na 390 px.
   * Mierzy ramki wszystkich pinezek (`getBoundingClientRect`) i sprawdza to, co zgłosił przegląd (`pinProblems`): napis ukryty, pinezka pod
   * pozostałymi (z-index 0) i niczego nie zasłania w punkcie jego środka (`elementFromPoint`). Przecięcia samej kartki z innymi pinezkami idą do notatek jako dowód.
   */
  async function obokPinCheck(page, ev) {
    await until(page, () => !!document.querySelector('.tt-cpin-obok'), null, 'pinezka „lokal obok” na mapie', 30_000);
    await sleep(1500);   // kamera dosuwa mapę do widocznego obszaru, a pinezki ustawiają się co klatkę
    const m = await page.evaluate(() => {
      const rect = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      const pins = [...document.querySelectorAll('.tt-cpin')].map((el) => {
        const label = el.querySelector('.tt-cpin-label');
        return {
          lot: Number(el.dataset.lot), kind: [...el.classList].find((c) => c.startsWith('tt-cpin-'))?.slice('tt-cpin-'.length) ?? '', z: Number(el.style.zIndex || 0), box: rect(el),
          label: label ? { text: label.textContent ?? '', box: rect(label), display: getComputedStyle(label).display } : null, covers: [],
        };
      });
      // zasłonięcie: w punkcie środka innej pinezki na wierzchu leży element pinezki „obok”
      for (const o of pins.filter((p) => p.kind === 'obok')) {
        const own = document.querySelector(`.tt-cpin[data-lot="${o.lot}"]`);
        o.covers = pins.filter((p) => p.kind !== 'obok' && p.box).filter((p) => {
          const hit = document.elementFromPoint((p.box.l + p.box.r) / 2, (p.box.t + p.box.b) / 2);
          return !!hit && !!own && own.contains(hit);
        }).map((p) => p.lot);
      }
      return { width: window.innerWidth, pins };
    });
    const { problems, overlaps } = pinProblems(m);
    ev.check(problems.length === 0, problems.join(' | ') || 'pinezka obok');
    const o = m.pins.find((p) => p.kind === 'obok' && p.box);
    const box = (b) => (b ? `${Math.round(b.l)}–${Math.round(b.r)} × ${Math.round(b.t)}–${Math.round(b.b)}` : 'brak');
    ev.note(`pinezka „lokal obok” (lokal ${o?.lot}) na ${m.width} px: kartka ${box(o?.box)}, napis „${o?.label?.text}” display ${o?.label?.display} (ramka ${box(o?.label?.box)}), z-index ${o?.z}, pinezek na ekranie ${m.pins.filter((p) => p.box).length}`);
    extras.obok = { width: m.width, lot: o?.lot, box: o?.box ?? null, overlaps };
    ev.note(`kartka lokalu obok leży pod innymi i zachodzi na ${overlaps.length} z nich: ${overlaps.map((x) => `${x.kind} #${x.with} (${x.area} px²)`).join(', ') || 'żadną'}; zasłania: ${o?.covers.length ? o.covers.join(', ') : 'żadnej'}`);
    await ev.shot('4a2-02b-pinezka-obok');
  }

  // ——————— scenariusze ———————

  async function scenarioOldSave(browser, vp) {
    const { ctx, page } = await newPage(browser, vp, 'stary', { fixture: old });
    try {
      await runStep(vp, 1, page, async (ev) => {
        await waitReady(page);
        await pause(page);
        await settle(page);
        await pause(page);
        const g = await readGame(page);
        ev.check(g.activeSeed === old.seed && g.seed === old.seed, `seed gry ${g.seed}, sklepu ${g.activeSeed}`);
        ev.check(g.remont === 2, `poziom remontu ${g.remont}, w zapisie 2`);
        ev.check(g.stores.length === 1 && !g.stores[0].closed, `sklepów w firmie: ${g.stores.length}`);
        ev.check(g.partner === false, 'stary zapis nie ma statusu Partnera');
        ev.note(`stary zapis: seed ${g.seed}, dzień ${g.day}, remont ${g.remont}, sklepów ${g.stores.length}, sklep w scenie ${g.sceneSeed}`);

        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
        const rows = await readLots(page);
        ev.check(rows.length > 0, `wolnych lokali na liście: ${rows.length}`);
        const status = await textOf(page, '.tt-citystatus');
        ev.check(/Partner Strategiczny/.test(status ?? '') && /zaufanie \d+\/75/.test(status ?? ''), `pasek statusu: ${status}`);
        ev.note(`pasek miasta: „${status}”, wolnych lokali ${rows.length}`);
        await until(page, () => document.querySelectorAll('.tt-cpin-wolny').length > 0, null, 'kartki wolnych lokali na mapie');
        const pins = await page.evaluate(() => ({
          free: document.querySelectorAll('.tt-cpin-wolny').length, own: document.querySelectorAll('.tt-cpin-twoj').length,
          named: [...document.querySelectorAll('.tt-cpin-twoj .tt-cpin-label')].filter((l) => l.textContent).map((l) => l.textContent),
          rivals: document.querySelectorAll('.tt-cpin-szop, .tt-cpin-kawka').length,
        }));
        // po dwóch remontach sklep #1 zajmuje też lokal obok: dwie zielone pinezki, ale tylko jedna z nazwą sklepu
        ev.check(pins.free > 0 && pins.named.length === 1 && pins.named[0] === 'Traszka #1', `pinezki: wolne ${pins.free}, własne ${pins.own}, z nazwą ${JSON.stringify(pins.named)}`);
        ev.note(`pinezki: wolne ${pins.free}, własne ${pins.own} (z nazwą: ${pins.named.join(', ')}), konkurencja ${pins.rivals}`);

        // stuknięcie w kartkę: pierwsza, która leży na wierzchu (reszta bywa pod arkuszem); inaczej wiersz listy
        let via = null;
        for (const row of rows) {
          if (await tapPin(page, row.id)) { via = `kartka #${row.id}`; break; }
        }
        if (via === null) { await pickLot(page, rows[0].id); via = 'lista'; }
        await page.waitForSelector('.tt-lotcard', { timeout: 15_000 });
        ev.note(`karta otwarta przez: ${via}`);
        const button = page.getByRole('button', { name: 'Biorę lokal', exact: true });
        ev.check(await button.isDisabled(), '„Biorę lokal” jest aktywny bez statusu');
        const lock = await textOf(page, '.tt-lockmsg');
        ev.check(/status Partnera Strategicznego/.test(lock ?? ''), `tekst zablokowania: ${lock}`);
        ev.note(`tekst pod przyciskiem: „${lock}”`);
        const head = await textOf(page, '.tt-lotcard h3');
        ev.check(/^ul\. \S+ \d+/.test(head ?? ''), `adres na karcie: ${head}`);
        await page.evaluate(() => document.querySelector('.tt-lockmsg')?.scrollIntoView({ block: 'nearest' }));   // tekst Centrali pod przyciskiem ma być na zrzucie
        await sleep(250);
        await ev.shot('01-stary-zapis-karta');
      });
    } finally {
      await ctx.close();
    }
  }

  async function scenarioFlow(browser, vp) {
    const { ctx, page } = await newPage(browser, vp, 'przed-statusem', { fixture: before });
    const phone = vp.mobile;
    try {
      let go = true;
      let rentedAt = null;
      await waitReady(page);
      await pause(page);
      await settle(page);
      await pause(page);

      // --- 2: status Partnera ---
      go = await runStep(vp, 2, page, async (ev) => {
        const g0 = await readGame(page);
        ev.check(g0.partner === false && g0.history.length === 1, `przed: partner ${g0.partner}, zamknięte miesiące ${g0.history.length}`);
        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-citystatus');
        const bar = await textOf(page, '.tt-citystatus');
        ev.check(/jeszcze 1 miesiąc z zyskiem/.test(bar ?? ''), `pasek przed statusem: ${bar}`);
        ev.note(`pasek przed statusem: „${bar}”`);
        if (phone) await obokPinCheck(page, ev);
        await closeTab(page, 'miasto');
        let found = null;
        for (let i = 0; i < 6 && !found; i++) {
          await skip(page, 30);
          const r = await settle(page, { stop: /^Status Partnera Strategicznego$/ });
          found = r.stopped;
        }
        if (!ev.check(!!found, 'okno „Status Partnera Strategicznego” nie pojawiło się po skip(30)')) return;
        ev.check(/Wolne lokale czekają w zakładce Miasto/.test(found.text), `tekst okna statusu: ${found.text.slice(0, 120)}`);
        ev.note(`okno statusu: „${found.label}”`);
        await sleep(450);
        if (phone) await checkWidth(page, 'okno: status Partnera');
        await ev.shot('02-status-partnera');
        await press(page, '.tt-story .tt-primary');
        await settle(page);
        const g1 = await readGame(page);
        ev.check(g1.partner === true, 'po oknie statusu firma nie ma statusu Partnera');
        ev.check(g1.history.length === 2 && g1.history[1] > 0, `zamknięte miesiące: ${g1.history.join(', ')}`);
        ev.note(`status nadany w dniu ${g1.day}, gotówka ${money(g1.wallet)} zł, zaufanie ${Math.round(g1.trust)}, wyniki miesięcy ${g1.history.join(', ')}`);
        await openTab(page, 'miasto');
        const bar2 = await textOf(page, '.tt-citystatus');
        ev.check(/status nadany/.test(bar2 ?? ''), `pasek po statusie: ${bar2}`);
      });
      if (!go) return failRest(vp, 2, 'krok 2 nie przeszedł');

      // --- 3: wynajem, budowa, otwarcie ---
      go = await runStep(vp, 3, page, async (ev) => {
        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
        const rows = await readLots(page);
        const cheapest = rows.reduce((a, b) => (b.price < a.price ? b : a));
        ev.note(`najtańszy wolny lokal: #${cheapest.id}, ul. ${cheapest.street} ${cheapest.number}, ${cheapest.district}, pakiet ${money(cheapest.price)} zł, budowa ${cheapest.buildDays} dni (z ${rows.length} wolnych)`);
        const pay = phone ? 'raty' : 'gotowka';
        if (pay === 'gotowka') {
          // gotówka ≥ pakiet: skip po miesiącu, najwyżej 6 miesięcy
          let days = 0;
          let g = await readGame(page);
          await closeTab(page, 'miasto');
          while (g.wallet < cheapest.price && days < 6 * 31) {
            await skip(page, 1440);
            await settle(page);
            g = await readGame(page);
            days++;
          }
          ev.check(g.wallet >= cheapest.price, `gotówka ${money(g.wallet)} zł < pakiet ${money(cheapest.price)} zł po ${days} dniach`);
          ev.note(`czekanie na gotówkę: ${days} dni przewinięte, gotówka ${money(g.wallet)} zł wobec pakietu ${money(cheapest.price)} zł`);
          await openTab(page, 'miasto');
          await page.waitForSelector(`.tt-lotrow[data-lot="${cheapest.id}"]`, { timeout: 30_000 });
        }
        await pickLot(page, cheapest.id);
        ev.check((await textOf(page, '.tt-lotcard h3')) === `ul. ${cheapest.street} ${cheapest.number}`, 'adres na karcie wybranego lokalu');
        // stuknięcie w kartkę tego samego lokalu (kamera dosunęła ją do widocznego obszaru): karta zamyka się i otwiera ponownie
        await press(page, '.tt-lotcard-close');
        await sleep(300);
        const tapped = await tapPin(page, cheapest.id);
        if (tapped) await page.waitForSelector('.tt-lotcard', { timeout: 15_000 });
        else await pickLot(page, cheapest.id);
        ev.check((await textOf(page, '.tt-lotcard h3')) === `ul. ${cheapest.street} ${cheapest.number}`, 'adres na karcie po ponownym otwarciu');
        ev.note(`karta lokalu przez: ${tapped ? 'kartkę na mapie' : 'listę (kartkę zasłania arkusz)'}`);
        const payButton = page.locator('.tt-lotpay .tt-btn', { hasText: pay === 'raty' ? /raty/ : /gotówkę/ });
        await payButton.click();
        ev.check((await payButton.getAttribute('aria-pressed')) === 'true', `sposób zapłaty „${pay}” nie został wybrany`);
        const hint = await textOf(page, '.tt-lotprice .tt-hint');
        ev.note(`blok pakietu: ${(await textOf(page, '.tt-lotpay'))?.replace(/\s+/g, ' ')} | ${hint}`);
        const rent = page.getByRole('button', { name: 'Biorę lokal', exact: true });
        ev.check(await rent.isEnabled(), `„Biorę lokal” zablokowany: ${await textOf(page, '.tt-lockmsg')}`);
        await ev.shot(`03-karta-lokalu-${pay}`);
        const g1 = await readGame(page);
        await rent.click();
        await until(page, () => window.traszkaGame.session.firm.builds.length === 1, null, 'budowa w firmie po „Biorę lokal”');
        const g2 = await readGame(page);
        const spent = g1.wallet - g2.wallet;
        if (pay === 'gotowka') ev.check(Math.abs(spent - cheapest.price) < 0.01, `gotówka zeszła o ${money(spent)} zł zamiast ${money(cheapest.price)} zł`);
        else ev.check(Math.abs(spent) < 0.01, `rata: gotówka zmieniła się o ${money(spent)} zł przed otwarciem`);
        ev.check(g2.builds[0].lotId === cheapest.id && g2.builds[0].pay === pay && g2.builds[0].price === cheapest.price, `budowa: ${JSON.stringify(g2.builds[0])}`);
        ev.check(g2.builds[0].readyDay - g2.day === cheapest.buildDays, `dzień otwarcia ${g2.builds[0].readyDay}, dziś ${g2.day}, budowa ${cheapest.buildDays} dni`);
        rentedAt = g2.day;

        // pinezka budowy z licznikiem
        await until(page, () => document.querySelector('.tt-cpin-budowa .tt-cpin-label')?.textContent, null, 'pinezka budowy z licznikiem');
        const label1 = await textOf(page, '.tt-cpin-budowa .tt-cpin-label');
        ev.check(new RegExp(`^za ${cheapest.buildDays} (dni|dzień)$`).test(label1 ?? ''), `licznik na pinezce: „${label1}”`);
        await sleep(300);
        await ev.shot('04-budowa-licznik');
        await skip(page, 1440);
        await settle(page);
        await sleep(400);
        const label2 = await textOf(page, '.tt-cpin-budowa .tt-cpin-label');
        ev.check(new RegExp(`^za ${cheapest.buildDays - 1} (dni|dzień)$`).test(label2 ?? ''), `licznik po dobie: „${label2}”`);
        ev.note(`licznik budowy: „${label1}” → „${label2}”`);

        // do dnia otwarcia
        const { stopped: opened } = await advance(page, { stop: /^Traszka #2 otwarta$/, maxDays: cheapest.buildDays + 3, chunk: 720 });
        if (!ev.check(!!opened, 'okno „Traszka #2 otwarta” nie pojawiło się')) return;
        ev.note(`okno otwarcia: „${opened.label}” — ${opened.text.replace(/\s+/g, ' ').slice(0, 160)}`);
        await sleep(450);
        if (phone) await checkWidth(page, 'okno: Traszka #2 otwarta');
        await ev.shot('05-traszka-2-otwarta');
        await press(page, '.tt-story .tt-primary');
        await settle(page);
        const g3 = await readGame(page);
        const s2 = g3.stores.find((s) => s.id === 2);
        ev.check(g3.stores.length === 2 && !!s2 && !s2.closed && g3.builds.length === 0, `po otwarciu: sklepów ${g3.stores.length}, budów ${g3.builds.length}`);
        ev.check(s2 && s2.lotId === cheapest.id, `sklep #2 w lokalu ${s2?.lotId}, wynajęty ${cheapest.id}`);
        ev.check(s2 && s2.minute >= g2.builds[0].readyDay * 1440 + 360, `sklep #2 otwarty o minucie ${s2?.minute}, dzień odbioru ${g2.builds[0].readyDay}`);
        ev.check(g3.activeId === 1, `po otwarciu aktywny sklep #${g3.activeId}`);
        if (pay === 'raty') {
          // rata z danych sklepu: 12 rat, opłata 15% ceny pakietu (razem 115%), rata ≈ razem / 12 (zaokrąglona do pełnych złotych)
          const rata = s2?.installments.find((i) => /^Adaptacja lokalu: ul\. /.test(i.label));
          if (ev.check(!!rata, `rata pakietu w sklepie #2: ${JSON.stringify(s2?.installments)}`)) {
            ev.check(rata.months === 12, `liczba rat ${rata.months}, ma być 12`);
            ev.check(rata.price === cheapest.price, `cena w racie ${rata.price}, pakiet ${cheapest.price}`);
            ev.check(Math.abs(rata.fee - 0.15 * rata.price) < 1, `opłata ${rata.fee} zł, ma być 15% z ${rata.price} zł`);
            ev.check(Math.abs(rata.total - 1.15 * rata.price) < 1, `razem ${rata.total} zł, ma być ${money(1.15 * rata.price)} zł`);
            ev.check(Math.abs(rata.monthly * rata.months - rata.total) <= rata.months, `rata ${rata.monthly} zł × ${rata.months} ≠ razem ${rata.total} zł`);
            ev.note(`rata pakietu: ${rata.label}, ${rata.months} rat po ${money(rata.monthly)} zł, razem ${money(rata.total)} zł z opłatą ${money(rata.fee)} zł (${Math.round((100 * rata.fee) / rata.price)}% z ${money(rata.price)} zł)`);
          }
        }
        ev.note(`sklep #2 otwarty w dniu ${Math.floor((s2?.minute ?? 0) / 1440)} (budowa wynajęta w dniu ${rentedAt}), gotówka ${money(g3.wallet)} zł`);
      });
      if (!go) return failRest(vp, 3, 'krok 3 nie przeszedł');

      // --- 4: chip ---
      go = await runStep(vp, 4, page, async (ev) => {
        await closeTab(page, 'miasto');
        await page.waitForSelector('[data-tut="store-switch"]', { timeout: 15_000 });
        const g0 = await readGame(page);
        const s1 = g0.stores.find((s) => s.id === 1);
        const s2 = g0.stores.find((s) => s.id === 2);
        ev.check(s1.seed !== s2.seed, 'sklepy mają ten sam seed');
        ev.check(g0.sceneSeed === s1.seed, `scena pokazuje ${g0.sceneSeed}, aktywny #1 ma ${s1.seed}`);
        const chip0 = await textOf(page, '[data-tut="store-switch"]');
        ev.note(`chip przed: „${chip0?.trim()}”, scena ${g0.sceneSeed}`);
        const switchTo = async (storeId) => {
          await page.click('[data-tut="store-switch"]');
          await page.waitForSelector('.tt-stores-pop', { timeout: 10_000 });
          const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-store-row')].map((r) => ({ text: r.textContent, on: r.getAttribute('aria-current') === 'true' })));
          const idx = rows.findIndex((r) => r.text.includes(`Traszka #${storeId}`));
          if (idx < 0) throw new Error(`na liście sklepów nie ma #${storeId}: ${JSON.stringify(rows)}`);
          await page.locator('.tt-store-row').nth(idx).click();
          return rows;
        };
        const rows = await switchTo(2);
        ev.check(rows.length === 2 && rows.some((r) => r.on), `lista sklepów: ${JSON.stringify(rows.map((r) => r.text))}`);
        await until(page, (seed) => window.traszkaGame.world?.seed === seed, s2.seed, `scena #2 (seed ${s2.seed})`, 60_000);
        const g1 = await readGame(page);
        ev.check(g1.activeId === 2 && g1.activeSeed === s2.seed && g1.sceneSeed === s2.seed, `po przełączeniu: aktywny #${g1.activeId}, scena ${g1.sceneSeed}`);
        const chip1 = await textOf(page, '[data-tut="store-switch"]');
        ev.check(/Traszka #2/.test(chip1 ?? ''), `chip po przełączeniu: ${chip1}`);
        await sleep(600);
        await ev.shot('06-sklep-2-w-scenie');
        await switchTo(1);
        await until(page, (seed) => window.traszkaGame.world?.seed === seed, s1.seed, `scena #1 (seed ${s1.seed})`, 60_000);
        const g2 = await readGame(page);
        ev.check(g2.activeId === 1 && g2.sceneSeed === s1.seed, `po powrocie: aktywny #${g2.activeId}, scena ${g2.sceneSeed}`);
        ev.note(`scena: ${g0.sceneSeed} → ${g1.sceneSeed} → ${g2.sceneSeed}; chip po: „${chip1?.trim()}”`);
        if (phone) {
          await page.click('[data-tut="store-switch"]');
          await page.waitForSelector('.tt-stores-pop');
          await checkWidth(page, 'lista sklepów (chip)');
          await ev.shot('07-lista-sklepow');
          await tapOutside(page, '.tt-stores-backdrop');   // stuknięcie poza listą ją zamyka
          await page.waitForSelector('.tt-stores-pop', { state: 'detached', timeout: 5_000 });
        }
      });
      if (!go) return failRest(vp, 4, 'krok 4 nie przeszedł');

      // --- 5: koniec miesiąca ---
      go = await runStep(vp, 5, page, async (ev) => {
        const { stopped: net } = await advance(page, { stop: /^Wyciągi od Centrali/, maxDays: 40 });
        if (!ev.check(!!net, 'okno z wyciągami sieci nie pojawiło się do końca miesiąca')) return;
        ev.note(`okno: „${net.label}”`);
        await sleep(400);
        const tabs = await page.evaluate(() => [...document.querySelectorAll('.tt-storetabs [role="tab"]')].map((b) => ({ text: b.textContent, on: b.getAttribute('aria-selected') === 'true' })));
        ev.check(tabs.length === 3 && tabs[0].text === 'Sieć' && tabs[0].on, `zakładki okna: ${JSON.stringify(tabs)}`);
        const summary = await textOf(page, '.tt-netsum');
        ev.check(/Traszka #1/.test(summary ?? '') && /Traszka #2/.test(summary ?? '') && /Zostaje Ci/.test(summary ?? '') && /Gotówka po zamknięciu/.test(summary ?? ''), `podsumowanie sieci: ${summary?.slice(0, 160)}`);
        ev.note(`zakładki: ${tabs.map((t) => t.text).join(' | ')}; podsumowanie: ${summary?.replace(/\s+/g, ' ').slice(0, 200)}`);
        if (phone) await checkWidth(page, 'okno sieci (Sieć)');
        await ev.shot('08-wyciagi-siec');
        for (const n of [1, 2]) {
          await page.locator('.tt-storetabs [role="tab"]').nth(n).click();
          await page.waitForSelector('.tt-storereport', { timeout: 10_000 });
          const rep = await page.evaluate(() => ({ label: document.querySelector('.tt-storereport')?.getAttribute('aria-label'), len: document.querySelector('.tt-storereport')?.textContent?.length ?? 0 }));
          ev.check(new RegExp(`^Traszka #${n}\\b`).test(rep.label ?? '') && rep.len > 200, `wyciąg #${n}: ${JSON.stringify(rep)}`);
          if (phone) await checkWidth(page, `okno sieci (wyciąg #${n})`);
          if (n === 2) await ev.shot('09-wyciag-sklepu-2');
        }
        await page.locator('.tt-storetabs [role="tab"]').nth(0).click();
        await press(page, '.tt-modal:has(h2[data-tut="report"]) .tt-modal-foot .tt-primary');
        await settle(page);
        const g = await readGame(page);
        ev.check(g.stores.filter((s) => !s.closed).length === 2 && !g.gameOver && g.over === null, `po oknie: otwartych ${g.stores.filter((s) => !s.closed).length}, koniec gry ${g.gameOver}/${g.over}`);
        ev.note(`gotówka po zamknięciu miesiąca ${money(g.wallet)} zł, skrzynka zastępcy ${g.inbox} wpisów, zaufanie #1 ${Math.round(g.stores[0].trust)}, #2 ${Math.round(g.stores[1].trust)}`);
      });
      if (!go) return failRest(vp, 5, 'krok 5 nie przeszedł');

      if (phone) {
        await runStep(vp, 7, page, (ev) => phoneChecks(page, ev));
      } else {
        // --- 6: wypowiedzenie ---
        await runStep(vp, 6, page, async (ev) => {
          const g0 = await readGame(page);
          if (g0.activeId !== 2) {
            await page.click('[data-tut="store-switch"]');
            await page.waitForSelector('.tt-stores-pop');
            await page.locator('.tt-store-row', { hasText: 'Traszka #2' }).click();
            await until(page, () => window.traszkaGame.session.firm.activeId === 2, null, 'aktywny sklep #2');
            await settle(page);   // karta, która czekała w tle, czeka teraz na gracza
          }
          await openTab(page, 'sklep');
          const terminate = page.getByRole('button', { name: 'Wypowiedz umowę', exact: true });
          await terminate.waitFor({ timeout: 15_000 });
          await ev.shot('10-sklep-2-wypowiedz');
          const dialogsBefore = dialogs.length;
          await terminate.click();
          await until(page, () => window.traszkaGame.session.firm.stores.find((s) => s.id === 2)?.notice !== null, null, 'wypowiedzenie #2', 15_000);
          ev.check(dialogs.length === dialogsBefore + 1 && /Wypowiedzieć umowę: Traszka #2/.test(dialogs.at(-1)), `pytanie przed wypowiedzeniem: ${dialogs.at(-1)}`);
          const notice = await settle(page, { stop: /^Wypowiedzenie umowy$/ });
          ev.check(!!notice.stopped, 'brak okna „Wypowiedzenie umowy”');
          if (notice.stopped) { await sleep(450); await press(page, '.tt-story .tt-primary'); }
          await settle(page);
          const g1 = await readGame(page);
          const endDay = g1.stores.find((s) => s.id === 2).notice?.endDay;
          ev.note(`wypowiedzenie w dniu ${g1.day}, umowa wygasa w dniu ${endDay}`);
          await closeTab(page, 'sklep');

          // do końca następnego miesiąca: rozliczenie końcowe i zamknięcie sklepu
          const titles = [];
          const run = await advance(page, { stop: /^Rozliczenie końcowe/, maxDays: endDay - g1.day + 5, done: (g) => g.stores.find((s) => s.id === 2).closed || g.gameOver || !!g.over });
          titles.push(...run.closed);
          const settlement = run.stopped;
          if (settlement) {
            await sleep(450);
            await ev.shot('11-rozliczenie-koncowe');
            await press(page, '.tt-story .tt-primary');
            titles.push(...(await settle(page)).closed);
          }
          if (!settlement) {
            const g = await readGame(page);
            ev.note(`stan po pętli: dzień ${g.day}, koniec gry ${g.gameOver}/${g.over}, sklepy ${JSON.stringify(g.stores.map((s) => ({ id: s.id, closed: s.closed, notice: s.notice, trust: Math.round(s.trust) })))}, okna: ${titles.join(' | ')}`);
          }
          if (!ev.check(!!settlement, 'okno „Rozliczenie końcowe” nie pojawiło się')) return;
          ev.note(`okno: „${settlement.label}” — ${settlement.text.replace(/\s+/g, ' ').slice(0, 220)}`);
          ev.check(titles.some((t) => /^Umowa zakończona: Traszka #2/.test(t)), `okna po rozliczeniu: ${titles.join(' | ')}`);
          const g = await readGame(page);
          const s2 = g.stores.find((s) => s.id === 2);
          ev.check(!!s2?.closed && g.stores.filter((s) => !s.closed).length === 1, `po zamknięciu: otwartych sklepów ${g.stores.filter((s) => !s.closed).length}`);
          ev.check(g.activeId === 1 && !g.gameOver && g.over === null, `aktywny #${g.activeId}, koniec gry ${g.gameOver}/${g.over} (gra przeszła na pozostały sklep)`);
          ev.check(!(await visible(page, '[data-tut="store-switch"]')), 'chip sklepów został przy jednym sklepie');
          const dayEnd = Math.floor(s2.minute / 1440);
          ev.note(`sklep #2 zamknięty w dniu ${dayEnd}, aktywny #${g.activeId}, gotówka ${money(g.wallet)} zł, okna: ${titles.join(' | ')}`);
          await openTab(page, 'miasto');
          await sleep(500);
          const pin = await textOf(page, '.tt-cpin-po-traszce');
          ev.note(`pinezka lokalu po zamknięciu: „${pin?.trim()}”`);
          await ev.shot('12-po-zamknieciu-miasto');
        });
      }
    } finally {
      await ctx.close();
    }
  }

  /** Kroki 2–7 po porażce wcześniejszego (te, które dotyczą tego rozmiaru): porażka z przyczyną, a nie milczenie. */
  function failRest(vp, afterId, why) {
    for (const step of STEPS) {
      if (typeof step.id !== 'number' || step.id <= afterId || step.id >= 8 || !step.sizes.includes(vp.name)) continue;
      (results[vp.name] ??= {})[step.id] = stepResult({ ok: false, failed: [`pominięty: ${why}`] });
      console.log(`  [${vp.name}] krok ${step.id}: FAIL (pominięty: ${why})`);
    }
  }

  // ——————— plan 4a.2, Zadanie 9: fixture „po Traszce” (kroki 9–12) ———————

  /** Karta lokalu z DOM: nagłówek, blok wyposażenia, podpis zniżki, wykres godzin, wiersz „Budowa”, przyciski zapłaty i przycisk „Biorę lokal”. */
  function readCard(page) {
    return page.evaluate(() => {
      const el = document.querySelector('.tt-lotcard');
      if (!el) return null;
      const c = el.getBoundingClientRect();
      const svg = el.querySelector('.tt-hours-svg')?.getBoundingClientRect();
      const bars = [...el.querySelectorAll('.tt-hours-svg .tt-hbar.day')];
      const rowOf = (label) => [...el.querySelectorAll('.tt-row')].find((r) => r.firstElementChild?.textContent === label)?.lastElementChild?.textContent ?? null;
      return {
        head: el.querySelector('h3')?.textContent ?? '', relet: el.querySelector('.tt-relet')?.textContent ?? null, caption: el.querySelector('.tt-reletcap')?.textContent ?? null,
        bars: bars.length, drawn: bars.every((b) => Number(b.getAttribute('height')) > 0), weekend: el.querySelectorAll('.tt-hours-svg .tt-hbar.end').length,
        chart: svg ? { left: svg.left, right: svg.right, width: svg.width } : null, card: { left: c.left, right: c.right },
        build: rowOf('Budowa'), pay: [...el.querySelectorAll('.tt-lotpay .tt-btn')].map((b) => b.textContent ?? ''),
        disabled: el.querySelector('.tt-lotact .tt-primary')?.disabled ?? null, lock: el.querySelector('.tt-lockmsg')?.textContent ?? null,
      };
    });
  }

  /**
   * Przewija do minuty tuż po otwarciu budowy (dzień odbioru `readyDay`, 6:00 plus minuta) i zwraca okno, którym gra zgłasza otwarcie sklepu (stoi
   * otwarte). `skip` staje tylko na kartach decyzji, a nie na zdarzeniach, więc dokładna liczba minut daje dane nowego sklepu (poziom, zaufanie) z chwili
   * otwarcia, a nie z końca kawałka przewinięcia.
   */
  async function skipToOpening(page, readyDay, stop) {
    const target = readyDay * 1440 + OPEN_MINUTE + 1;
    for (let i = 0; i < 40; i++) {
      const g = await readGame(page);
      if (g.minute >= target) return null;
      await skip(page, Math.min(target - g.minute, 1440));
      const r = await settle(page, { stop });
      if (r.stopped) return r.stopped;
    }
    return null;
  }

  /** Wykres godzin na karcie: 17 narysowanych słupków dnia roboczego (weekend: brak albo 17) i rysunek mieści się w karcie. */
  function chartChecks(ev, card, what) {
    ev.check(card.bars === HOUR_BARS && card.drawn, `${what}: słupków dnia roboczego ${card.bars} (ma być ${HOUR_BARS}), wszystkie narysowane: ${card.drawn}`);
    ev.check(card.weekend === 0 || card.weekend === HOUR_BARS, `${what}: słupków weekendu ${card.weekend}`);
    ev.check(!!card.chart && card.chart.width > 100 && card.chart.left >= card.card.left - 0.5 && card.chart.right <= card.card.right + 0.5,
      `${what}: wykres ${JSON.stringify(card.chart)} poza kartą ${JSON.stringify(card.card)}`);
  }

  /** Lista sklepów (chip): wiersze z tekstem, zamknięciem, aktywnością, ostrzeżeniami zaufania i znak ⚠ przy chipie; po odczycie zamyka listę stuknięciem w tło. */
  async function readChipList(page, { close = true, before = null } = {}) {
    await page.click('[data-tut="store-switch"]');
    await page.waitForSelector('.tt-stores-pop', { timeout: 10_000 });
    if (before) await before();
    const info = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.tt-store-row')].map((r) => ({
        text: r.textContent ?? '', closed: r.classList.contains('closed'), on: r.getAttribute('aria-current') === 'true',
        warns: [...r.querySelectorAll('.tt-store-warn')].map((w) => w.dataset.warn), shown: Number(/🤝 (\d+)/.exec(r.textContent ?? '')?.[1]),
      })),
      alert: !!document.querySelector('.tt-stores-alert') && document.querySelector('.tt-stores-alert').getBoundingClientRect().height > 0,
    }));
    if (close) {
      await tapOutside(page, '.tt-stores-backdrop');
      await page.waitForSelector('.tt-stores-pop', { state: 'detached', timeout: 5_000 });
    }
    return info;
  }

  /**
   * Zamyka okna, które leżą na oknie miesiąca (protokół remanentu przychodzi w tej samej minucie co koniec kwartału, wpisy „OK”, karty decyzji), żeby jego przycisk
   * dało się kliknąć; samo okno miesiąca zostaje. Protokół remanentu z trzema zakładkami sklepów mierzy się na telefonie w każdej zakładce (okno z kolejki gry
   * `settle` mierzy tylko pierwszą), bo to jeden z nowych ekranów trzech sklepów.
   */
  async function closeWindowsAboveReport(page, ev, { phone, prefix }) {
    for (let i = 0; i < 12; i++) {
      const w = await windowsOf(page);
      const d = w.dialogs.find((x) => x.kind !== 'report' && CLOSE[x.kind]);
      if (!d) return;
      if (d.kind === 'remanent') {
        await sleep(450);
        if (phone) {
          const tabs = page.locator('.tt-remanent .tt-storetabs [role="tab"]');
          const n = await tabs.count();
          for (let k = 0; k < n; k++) {
            await tabs.nth(k).click();
            await sleep(200);
            await checkWidth(page, `${prefix}protokół remanentu (${n} zakładki): #${k + 1}`);
          }
          ev.note(`protokół remanentu na oknie miesiąca: ${n} zakładki sklepów, każda zmierzona`);
          if (!prefix) await ev.shot('4a2-11d-protokol-remanentu-trzy-sklepy');
        }
      }
      if (d.kind === 'story') await sleep(450);
      await dismiss(page, CLOSE[d.kind]);
      await sleep(200);
    }
  }

  /** Okno sieci przy trzech sklepach: cztery zakładki, „Sieć” z trzema wierszami zaufania i trzy wyciągi; na telefonie pomiar szerokości każdej zakładki. */
  async function networkWindowChecks(page, ev, { phone, lang }) {
    const net = lang === 'en' ? 'Network' : 'Sieć';
    const trustWord = lang === 'en' ? 'trust' : 'zaufanie';
    const prefix = lang === 'en' ? 'angielski: ' : '';
    await sleep(400);
    await closeWindowsAboveReport(page, ev, { phone, prefix });
    const g = await readGame(page);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.tt-storetabs [role="tab"]')].map((b) => ({ text: b.textContent ?? '', on: b.getAttribute('aria-selected') === 'true' })));
    ev.check(tabs.length === 4 && tabs[0].text === net && tabs[0].on && [1, 2, 3].every((i) => new RegExp(`^#${i}\\b`).test(tabs[i]?.text ?? '')), `zakładki okna: ${JSON.stringify(tabs)}`);
    const summary = await textOf(page, '.tt-netsum');
    ev.check([1, 2, 3].every((n) => (summary ?? '').includes(`Traszka #${n}`)), `podsumowanie sieci bez trzech sklepów: ${summary?.slice(0, 200)}`);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-netsum .tt-row > span:first-child')].map((e) => e.textContent ?? ''));
    const trusts = trustRowValues(rows, trustWord);
    const open = g.stores.filter((st) => !st.closed);
    ev.check(trusts.length === 3 && trusts.every((v, i) => v === Math.round(open[i]?.trust)), `wiersze „${trustWord} N” w sieci: ${JSON.stringify(trusts)}, dane gry: ${JSON.stringify(open.map((st) => Math.round(st.trust)))}`);
    // etykiety zakładek na 390 px skracają się wielokropkiem (CSS `.tt-storetabs .tt-btn`): to nie poziomy wylew, ale gracz je widzi, więc idą do notatek
    const cut = await page.evaluate(() => [...document.querySelectorAll('.tt-storetabs [role="tab"]')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => `${b.textContent} (${b.clientWidth} px)`));
    ev.note(`zakładki z uciętą etykietą (wielokropek): ${cut.length ? cut.join(', ') : 'brak'}`);
    ev.note(`zakładki: ${tabs.map((t) => t.text).join(' | ')}; ${trustWord} przy sklepach: ${trusts.join(', ')}; podsumowanie: ${summary?.replace(/\s+/g, ' ').slice(0, 220)}`);
    if (phone) await checkWidth(page, `${prefix}okno sieci (cztery zakładki): ${net}`);
    await ev.shot(lang === 'en' ? '4a2-12c-angielski-wyciagi-siec' : '4a2-11-wyciagi-siec-trzy');
    for (const n of [1, 2, 3]) {
      await page.locator('.tt-storetabs [role="tab"]').nth(n).click();
      await page.waitForSelector('.tt-storereport', { timeout: 10_000 });
      const rep = await page.evaluate(() => ({ label: document.querySelector('.tt-storereport')?.getAttribute('aria-label'), len: document.querySelector('.tt-storereport')?.textContent?.length ?? 0 }));
      ev.check(new RegExp(`^Traszka #${n}\\b`).test(rep.label ?? '') && rep.len > 200, `wyciąg #${n}: ${JSON.stringify(rep)}`);
      if (phone) await checkWidth(page, `${prefix}okno sieci (cztery zakładki): wyciąg #${n}`);
      if (n === 3 && lang !== 'en') await ev.shot('4a2-11b-wyciag-sklepu-3');
    }
    await page.locator('.tt-storetabs [role="tab"]').nth(0).click();
    return g;
  }

  /**
   * Podgląd końca miesiąca przy trzech sklepach (telefon): przycisk prognozy w pasku otwiera okno „Wyciąg na koniec miesiąca”, „policz podgląd” liczy kopię
   * sieci, a wynik ma cztery zakładki („Sieć” i trzy sklepy; zakładek nie ma przed policzeniem). Każdą zakładkę mierzy `checkWidth`, bo okno modalne ma własne
   * przewijanie, którego `scrollWidth` dokumentu nie widzi. Na końcu okno się zamyka, a gra stoi jak przedtem.
   */
  async function monthPreviewChecks(page, ev, { lang }) {
    const net = lang === 'en' ? 'Network' : 'Sieć';
    const prefix = lang === 'en' ? 'angielski: ' : '';
    const name = `${prefix}podgląd końca miesiąca (cztery zakładki)`;
    await press(page, '.tt-due');
    await page.waitForSelector('.tt-preview', { timeout: 10_000 });
    await sleep(300);
    await press(page, '.tt-preview .tt-primary.big');
    await page.waitForSelector('.tt-preview .tt-preview-result', { timeout: 240_000 });   // liczy kopię trzech sklepów do końca miesiąca
    await sleep(300);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.tt-preview .tt-storetabs [role="tab"]')].map((b) => ({
      text: b.textContent ?? '', on: b.getAttribute('aria-selected') === 'true', cut: b.scrollWidth > b.clientWidth + 1,
    })));
    ev.check(tabs.length === 4 && tabs[0].text === net && tabs[0].on && [1, 2, 3].every((i) => new RegExp(`^#${i}\\b`).test(tabs[i]?.text ?? '')), `zakładki podglądu końca miesiąca: ${JSON.stringify(tabs)}`);
    const summary = await textOf(page, '.tt-preview .tt-netsum');
    ev.check([1, 2, 3].every((n) => (summary ?? '').includes(`Traszka #${n}`)), `podsumowanie sieci w podglądzie bez trzech sklepów: ${summary?.slice(0, 200)}`);
    ev.note(`podgląd końca miesiąca (${lang}): zakładki ${tabs.map((t) => t.text).join(' | ')}; ucięte etykiety: ${tabs.filter((t) => t.cut).map((t) => t.text).join(', ') || 'brak'}`);
    await checkWidth(page, `${name}: ${net}`);
    await ev.shot(lang === 'en' ? '4a2-12f-angielski-podglad-konca-miesiaca' : '4a2-11e-podglad-konca-miesiaca');
    for (const n of [1, 2, 3]) {
      await page.locator('.tt-preview .tt-storetabs [role="tab"]').nth(n).click();
      await page.waitForFunction((id) => (document.querySelector('.tt-preview .tt-storetitle')?.textContent ?? '').startsWith(`Traszka #${id}`), n, { timeout: 10_000 });
      await checkWidth(page, `${name}: #${n}`);
    }
    await press(page, '.tt-preview .tt-modal-foot .tt-btn');
    await page.waitForSelector('.tt-preview', { state: 'detached', timeout: 5_000 });
  }

  /**
   * Gra kolejne miesiące (okno sieci zamykane po każdym), aż któryś otwarty sklep spadnie poniżej progu zaufania z listy chipa (`BACKGROUND_TRUST_WARN_BELOW`),
   * najwyżej `maxMonths`. Sklep w tle traci zaufanie bez wizyt, więc zajmuje to kilka miesięcy (na fixture „po Traszce” siedem; limit 12 zostawia zapas); punkt przeglądu planu wymaga, by lista chipa z tym
   * ostrzeżeniem mieściła się w 390 px, a bez sklepu poniżej progu nie ma jej jak zobaczyć. Zwraca ostatni odczyt gry i liczbę zagranych miesięcy.
   */
  async function playUntilTrustWarning(page, ev, { stop, prefix, phone, maxMonths = 12 }) {
    let g = await readGame(page);
    let months = 0;
    while (months < maxMonths && !g.stores.some((st) => !st.closed && st.trust < BACKGROUND_TRUST_WARN_BELOW)) {
      const { stopped } = await advance(page, { stop, maxDays: 40, chunk: 4320 });   // trzy doby naraz: okno miesiąca czeka na koniec kawałka, a po drodze `skip` staje na kartach
      if (!ev.check(!!stopped, `miesiąc +${months + 1} nie przyniósł okna sieci`)) break;
      months++;
      await sleep(400);
      await closeWindowsAboveReport(page, ev, { phone, prefix });
      if (phone) await checkWidth(page, `${prefix}okno sieci (cztery zakładki): Sieć, miesiąc +${months}`);
      await press(page, '.tt-modal:has(h2[data-tut="report"]) .tt-modal-foot .tt-primary');
      await settle(page);
      g = await readGame(page);
      if (!ev.check(g.over === null && !g.gameOver && g.stores.every((st) => !st.closed), `miesiąc +${months}: koniec gry ${g.gameOver}/${g.over}, sklepy ${JSON.stringify(g.stores.map((st) => [st.id, st.closed, Math.round(st.trust)]))}`)) break;
    }
    return { g, months };
  }

  async function scenarioRelet(browser, vp) {
    const { ctx, page } = await newPage(browser, vp, 'po-traszce', { fixture: after });
    const phone = vp.mobile;
    const fit = closedFittings(after.text).find((st) => st.id === 2);
    const lot = { id: -1, street: '', number: 0, pkg: 0, price: 0 };
    try {
      let go = true;
      await waitReady(page);
      await pause(page);
      await settle(page);
      await pause(page);

      // --- 9: pinezka, lista, karta, ponowny wynajem, okno, trzy sklepy ---
      go = await runStep(vp, 9, page, async (ev) => {
        const g0 = await readGame(page);
        const shape = JSON.stringify(g0.stores.map((st) => [st.id, st.closed]));
        ev.check(shape === '[[1,false],[2,true],[3,false]]', `sklepy w fixture: ${shape}`);
        ev.check(g0.partner === true && g0.over === null && !g0.gameOver && g0.builds.length === 0, `firma: partner ${g0.partner}, koniec ${g0.over}, budowy ${g0.builds.length}`);
        const s2 = g0.stores.find((st) => st.id === 2);
        ev.check(!!fit && s2?.lotId === fit.lotId && s2.remont === fit.remontLevel && fit.equipment.includes('sco'), `sklep #2 w danych: ${JSON.stringify(s2 && { lotId: s2.lotId, remont: s2.remont })}, fixture: ${JSON.stringify(fit)}`);
        lot.id = s2.lotId;
        const mine = await page.evaluate((id) => { const l = window.traszkaGame.session.firm.city.lots[id]; return { pkg: l.package, street: l.street, number: l.number }; }, lot.id);
        Object.assign(lot, mine, { price: reletPrice(mine.pkg) });
        ev.check(lot.price < lot.pkg && g0.wallet >= lot.price, `cena po Traszce ${money(lot.price)} zł (pakiet ${money(lot.pkg)} zł), gotówka ${money(g0.wallet)} zł`);
        ev.note(`fixture: dzień ${g0.day}, gotówka ${money(g0.wallet)} zł, sklepy ${g0.stores.map((st) => `#${st.id}${st.closed ? ' zamknięty' : ''} (zaufanie ${Math.round(st.trust)}, remont ${st.remont})`).join(', ')}; lokal #2: ul. ${lot.street} ${lot.number}, pakiet ${money(lot.pkg)} zł, po Traszce ${money(lot.price)} zł`);

        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
        // pinezka „po Traszce” na lokalu #2 (jedna) z napisem z kartki
        await until(page, (id) => !!document.querySelector(`.tt-cpin-po-traszce[data-lot="${id}"]`), lot.id, 'pinezka „po Traszce” na lokalu #2');
        const pins = await page.evaluate(() => ({
          relet: document.querySelectorAll('.tt-cpin-po-traszce').length, own: document.querySelectorAll('.tt-cpin-twoj').length, free: document.querySelectorAll('.tt-cpin-wolny').length,
          label: document.querySelector('.tt-cpin-po-traszce .tt-cpin-label')?.textContent ?? null,
        }));
        const openStores = g0.stores.filter((st) => !st.closed).length;   // własne pinezki: jedna na otwarty sklep (z danych gry, a nie liczba na sztywno)
        ev.check(pins.relet === 1 && pins.label === 'po Traszce' && pins.own === openStores, `pinezki: ${JSON.stringify(pins)}, otwartych sklepów ${openStores}`);
        // lista: wiersz z dopiskiem i ceną po zniżce, reszta z pełnym pakietem
        const rows = await readLots(page);
        const row = rows.find((r) => r.id === lot.id);
        if (!ev.check(!!row, `lokal #2 (${lot.id}) nie stoi na liście: ${rows.map((r) => r.id).join(', ')}`)) return;
        ev.check(row.relet && digitsOf(row.priceText) === lot.price, `wiersz listy: znacznik ${row.relet}, cena „${row.priceText}” (rentPrice ${lot.price})`);
        const others = rows.filter((r) => r.id !== lot.id);
        ev.check(others.length > 0 && others.every((r) => !r.relet && digitsOf(r.priceText) === r.price), `pozostałe wiersze mają pełny pakiet: ${others.map((r) => `${r.id}:${r.priceText}/${r.price}`).join(' ')}`);
        ev.note(`lista: ${rows.length} lokali do wzięcia (w tym 1 po Traszce za ${row.priceText}), pinezki: wolne ${pins.free}, własne ${pins.own}, po Traszce ${pins.relet}`);

        // karta: stuknięcie w pinezkę (a gdy zasłania ją arkusz albo inna pinezka, wiersz listy)
        const addr = `ul. ${lot.street} ${lot.number}`;
        let via = 'pinezka na mapie';
        if (await tapPin(page, lot.id)) {
          await page.waitForSelector('.tt-lotcard', { timeout: 15_000 });
          await sleep(250);
          if ((await textOf(page, '.tt-lotcard h3')) !== addr) { await press(page, '.tt-lotcard-close'); await pickLot(page, lot.id); via = 'lista (pinezka otworzyła inny lokal)'; }
        } else {
          await pickLot(page, lot.id);
          via = 'lista (pinezkę zasłania arkusz)';
        }
        const card = await readCard(page);
        ev.check(card.head === addr, `adres na karcie: ${card.head}`);
        ev.check(card.relet === reletBlockText(fit), `blok wyposażenia: „${card.relet}” (fixture: „${reletBlockText(fit)}”)`);
        ev.check(card.caption === RELET_CAPTION, `podpis zniżki: „${card.caption}”`);
        ev.check((card.build ?? '').replace(/\s+/g, ' ') === daysText(RELET_BUILD_DAYS), `wiersz „Budowa”: „${card.build}” (oczekiwane „${daysText(RELET_BUILD_DAYS)}”)`);
        ev.check(card.pay.length === 2 && digitsOf(card.pay[0]) === lot.price, `przycisk „za gotówkę”: „${card.pay[0]}” (rentPrice ${lot.price})`);
        chartChecks(ev, card, 'wykres na karcie po Traszce');
        const rata = parseInstallmentButton(card.pay[1]);
        ev.check(!!rata, `przycisk „na raty”: „${card.pay[1]}”`);
        ev.note(`karta przez: ${via}; blok „${card.relet}”, podpis „${card.caption}”, budowa „${card.build}”, wykres ${card.bars} słupków dnia${card.weekend ? ` i ${card.weekend} weekendu` : ''}, przyciski: ${card.pay.map((b) => `„${b.replace(/\s+/g, ' ').trim()}”`).join(' | ')}`);
        if (phone) await checkWidth(page, 'karta lokalu po Traszce');
        await page.evaluate(() => document.querySelector('.tt-relet')?.scrollIntoView({ block: 'nearest' }));
        await sleep(250);
        await ev.shot('4a2-09a-karta-po-traszce');
        await page.evaluate(() => document.querySelector('.tt-hours')?.scrollIntoView({ block: 'center' }));
        await sleep(250);
        await ev.shot('4a2-09b-wykres-godzin');

        // wynajem: telefon na raty, komputer gotówką
        const pay = phone ? 'raty' : 'gotowka';
        const payButton = page.locator('.tt-lotpay .tt-btn', { hasText: pay === 'raty' ? /raty/ : /gotówkę/ });
        await payButton.click();
        ev.check((await payButton.getAttribute('aria-pressed')) === 'true', `sposób zapłaty „${pay}” nie został wybrany`);
        const rent = page.getByRole('button', { name: 'Biorę lokal', exact: true });
        ev.check(await rent.isEnabled(), `„Biorę lokal” zablokowany: ${await textOf(page, '.tt-lockmsg')}`);
        await page.evaluate(() => document.querySelector('[data-tut="lot-price"]')?.scrollIntoView({ block: 'nearest' }));
        await sleep(250);
        await ev.shot(`4a2-09c-karta-po-traszce-${pay}`);
        const g1 = await readGame(page);
        await rent.click();
        await until(page, () => window.traszkaGame.session.firm.builds.length === 1, null, 'budowa w firmie po „Biorę lokal”');
        const g2 = await readGame(page);
        const spent = g1.wallet - g2.wallet;
        if (pay === 'gotowka') ev.check(Math.abs(spent - lot.price) < 0.01, `gotówka zeszła o ${money(spent)} zł zamiast ${money(lot.price)} zł`);
        else ev.check(Math.abs(spent) < 0.01, `rata: gotówka zmieniła się o ${money(spent)} zł przed otwarciem`);
        const b = g2.builds[0];
        ev.check(b.lotId === lot.id && b.pay === pay && b.price === lot.price, `budowa: ${JSON.stringify(b)} (cena po Traszce ${lot.price})`);
        ev.check(b.readyDay - g2.day === RELET_BUILD_DAYS, `dzień otwarcia ${b.readyDay}, dziś ${g2.day}: budowa ma trwać ${daysText(RELET_BUILD_DAYS)}`);
        // lokal w budowie to już nie „po Traszce”: pinezka budowy z licznikiem
        await until(page, (id) => !!document.querySelector(`.tt-cpin-budowa[data-lot="${id}"]`) && !document.querySelector(`.tt-cpin-po-traszce[data-lot="${id}"]`), lot.id, 'pinezka budowy zamiast „po Traszce”');
        const count = await textOf(page, `.tt-cpin-budowa[data-lot="${lot.id}"] .tt-cpin-label`);
        ev.check((count ?? '').replace(/\s+/g, ' ') === `za ${daysText(RELET_BUILD_DAYS)}`, `licznik na pinezce budowy: „${count}” (oczekiwane „za ${daysText(RELET_BUILD_DAYS)}”)`);
        ev.note(`ponowny wynajem ${pay === 'raty' ? 'na raty' : 'gotówką'} w dniu ${g2.day}: cena ${money(lot.price)} zł, gotówka ${money(g1.wallet)} → ${money(g2.wallet)} zł, otwarcie w dniu ${b.readyDay}, pinezka „${count}”`);

        // okno „Traszka #2 znów otwarta” w dniu otwarcia
        const reopened = await skipToOpening(page, b.readyDay, new RegExp(`^${RELET_TITLE}$`));
        if (!ev.check(!!reopened, `okno „${RELET_TITLE}” nie pojawiło się`)) return;
        ev.check(/znów przyjmuje klientów/.test(reopened.text) && new RegExp(`poziom 1, zaufanie ${RELET_TRUST}`).test(reopened.text), `tekst okna: ${reopened.text.replace(/\s+/g, ' ').slice(0, 200)}`);
        ev.note(`okno: „${reopened.label}” — ${reopened.text.replace(/\s+/g, ' ').slice(0, 220)}`);
        await sleep(450);
        if (phone) await checkWidth(page, `okno: ${RELET_TITLE}`);
        await ev.shot('4a2-09d-traszka-2-znow-otwarta');
        await press(page, '.tt-story .tt-primary');
        await settle(page);
        const g3 = await readGame(page);
        const r2 = g3.stores.find((st) => st.id === 2);
        ev.check(g3.stores.length === 3 && g3.stores.every((st) => !st.closed) && g3.builds.length === 0, `po otwarciu: sklepy ${JSON.stringify(g3.stores.map((st) => [st.id, st.closed]))}, budowy ${g3.builds.length}`);
        ev.check(!!r2 && r2.level === 1 && Math.round(r2.trust) === RELET_TRUST && r2.remont === fit.remontLevel, `#2 po otwarciu: poziom ${r2?.level}, zaufanie ${r2 && Math.round(r2.trust)}, remont ${r2?.remont} (fixture: remont ${fit.remontLevel})`);
        ev.check(!!r2 && r2.reopened && r2.lotId === lot.id && fit.equipment.every((id) => r2.equipment.includes(id)), `#2: reopened ${r2?.reopened}, lokal ${r2?.lotId}, sprzęt ${JSON.stringify(r2?.equipment)} (fixture ${JSON.stringify(fit.equipment)})`);
        ev.check(g3.activeId === 1 && r2.minute >= b.readyDay * 1440 + 360, `aktywny #${g3.activeId}, #2 w minucie ${r2?.minute}, dzień odbioru ${b.readyDay}`);
        if (pay === 'raty') {
          const inst = r2?.installments.find((i) => /^Adaptacja lokalu: ul\. /.test(i.label));
          if (ev.check(!!inst, `rata pakietu w #2: ${JSON.stringify(r2?.installments)}`)) {
            ev.check(inst.price === lot.price && [6, 12].includes(inst.months), `rata: cena ${inst.price} (rentPrice ${lot.price}), rat ${inst.months}`);
            ev.check(Math.abs(inst.total - (inst.price + inst.fee)) <= 1 && Math.abs(inst.monthly * inst.months - inst.total) <= inst.months, `rata ${inst.monthly} × ${inst.months} ≠ razem ${inst.total} (cena ${inst.price} + opłata ${inst.fee})`);
            ev.check(!!rata && rata.monthly === inst.monthly && rata.months === inst.months, `rata z karty ${JSON.stringify(rata)} a z danych sklepu ${inst.monthly} × ${inst.months}`);
            ev.note(`rata pakietu po Traszce: ${inst.months} rat po ${money(inst.monthly)} zł, razem ${money(inst.total)} zł z opłatą ${money(inst.fee)} zł (${Math.round((100 * inst.fee) / inst.price)}% z ${money(inst.price)} zł)`);
          }
        }
        ev.note(`#2 po ponownym otwarciu: poziom ${r2?.level}, zaufanie ${Math.round(r2?.trust)}, remont ${r2?.remont}, sprzęt ${JSON.stringify(r2?.equipment)}, dzień ${Math.floor((r2?.minute ?? 0) / 1440)}, gotówka ${money(g3.wallet)} zł`);

        // chip z trzema sklepami
        await closeTab(page, 'miasto');
        await page.waitForSelector('[data-tut="store-switch"]', { timeout: 15_000 });
        const chip = await readChipList(page, { before: async () => { if (phone) await checkWidth(page, 'lista sklepów (trzy)'); await ev.shot('4a2-09e-lista-trzech-sklepow'); } });
        ev.check(chip.rows.length === 3 && chip.rows.every((r) => !r.closed) && [1, 2, 3].every((n) => chip.rows.some((r) => r.text.includes(`Traszka #${n}`))) && chip.rows.filter((r) => r.on).length === 1,
          `lista chipa: ${JSON.stringify(chip.rows.map((r) => [r.text.slice(0, 40), r.closed, r.on]))}`);
        ev.note(`lista chipa: ${chip.rows.map((r) => r.text.replace(/\s+/g, ' ').trim()).join(' || ')}`);
      });
      if (!go) return failRelet(vp, 9, 'krok 9 nie przeszedł');

      // --- 10: trzy placówki ---
      go = await runStep(vp, 10, page, async (ev) => {
        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
        const bar = await textOf(page, '.tt-citytools');
        ev.check(/placówki 3\/3/.test(bar ?? ''), `licznik placówek: ${bar}`);
        const rows = await readLots(page);
        ev.check(rows.length > 0 && rows.every((r) => r.id !== lot.id && !r.relet), `lista po ponownym wynajmie: ${rows.map((r) => `${r.id}${r.relet ? ' po Traszce' : ''}`).join(', ')}`);
        const other = rows[0];
        await pickLot(page, other.id);
        const rent = page.getByRole('button', { name: 'Biorę lokal', exact: true });
        const first = await readCard(page);
        ev.check(await rent.isDisabled(), '„Biorę lokal” jest aktywny przy trzech placówkach');
        ev.check(first.lock === LIMIT_TEXT, `tekst pod przyciskiem: „${first.lock}”`);
        ev.check(first.relet === null && first.caption === null, `zwykły wolny lokal ma blok „po Traszce”: ${first.relet} / ${first.caption}`);
        chartChecks(ev, first, 'wykres na karcie wolnego lokalu');
        // drugi sposób zapłaty niczego nie odblokowuje
        for (const n of [0, 1]) {
          await page.locator('.tt-lotpay .tt-btn').nth(n).click();
          ev.check((await rent.isDisabled()) && (await textOf(page, '.tt-lockmsg')) === LIMIT_TEXT, `sposób zapłaty ${n}: przycisk ${(await rent.isDisabled()) ? 'zablokowany' : 'aktywny'}, tekst „${await textOf(page, '.tt-lockmsg')}”`);
        }
        const g = await readGame(page);
        ev.check(g.builds.length === 0 && g.stores.filter((st) => !st.closed).length === 3, `budowy ${g.builds.length}, otwarte sklepy ${g.stores.filter((st) => !st.closed).length}`);
        ev.note(`karta lokalu ${other.id} (${other.addr}): „Biorę lokal” zablokowany, tekst: „${first.lock}”; wykres ${first.bars} słupków${first.weekend ? ` i ${first.weekend} weekendu` : ''}; pasek: „${bar?.replace(/\s+/g, ' ').trim()}”`);
        if (phone) await checkWidth(page, 'karta lokalu z wykresem');
        await page.evaluate(() => document.querySelector('.tt-lockmsg')?.scrollIntoView({ block: 'nearest' }));
        await sleep(250);
        await ev.shot('4a2-10-limit-trzy-placowki');
        await press(page, '.tt-lotcard-close');
        await closeTab(page, 'miasto');
      });
      if (!go) return failRelet(vp, 10, 'krok 10 nie przeszedł');

      // --- 11: koniec miesiąca przy trzech sklepach ---
      go = await runStep(vp, 11, page, async (ev) => {
        const { stopped: net } = await advance(page, { stop: /^Wyciągi od Centrali/, maxDays: 40 });
        if (!ev.check(!!net, 'okno z wyciągami sieci nie pojawiło się do końca miesiąca')) return;
        ev.note(`okno: „${net.label}”`);
        await networkWindowChecks(page, ev, { phone, lang: 'pl' });
        await press(page, '.tt-modal:has(h2[data-tut="report"]) .tt-modal-foot .tt-primary');
        await settle(page);
        const g2 = await readGame(page);
        const open = g2.stores.filter((st) => !st.closed);
        ev.check(open.length === 3 && !g2.gameOver && g2.over === null, `po oknie: otwartych ${open.length}, koniec gry ${g2.gameOver}/${g2.over}`);
        if (phone) await monthPreviewChecks(page, ev, { lang: 'pl' });
        // chip: ostrzeżenie o zaufaniu dokładnie przy sklepach poniżej progu, a ⚠ przy chipie, gdy jakiś sklep w tle woła o uwagę. Gramy do pierwszego takiego sklepu
        const { g: g3, months } = await playUntilTrustWarning(page, ev, { stop: /^Wyciągi od Centrali/, prefix: '', phone });
        const open3 = g3.stores.filter((st) => !st.closed);
        ev.check(open3.length === 3 && open3.some((st) => st.trust < BACKGROUND_TRUST_WARN_BELOW), `po ${months} kolejnych miesiącach żaden z trzech sklepów nie spadł poniżej ${BACKGROUND_TRUST_WARN_BELOW}: ${open3.map((st) => `#${st.id} ${Math.round(st.trust)}`).join(', ')}`);
        const chip = await readChipList(page, { close: false });
        const mismatch = chip.rows.flatMap((r, i) => {
          const st = open3[i];
          const want = st.trust < BACKGROUND_TRUST_WARN_BELOW;
          return r.warns.includes('zaufanie') === want && r.shown === Math.round(st.trust) ? [] : [`#${st.id}: pokazuje ${r.shown}${r.warns.includes('zaufanie') ? ' z ostrzeżeniem' : ''}, zaufanie ${Math.round(st.trust)}`];
        });
        ev.check(chip.rows.length === 3 && mismatch.length === 0, `ostrzeżenia zaufania na chipie: ${mismatch.join('; ') || JSON.stringify(chip.rows.map((r) => r.warns))}`);
        const backgroundWarned = chip.rows.some((r, i) => !r.on && r.warns.length > 0);
        ev.check(chip.alert === backgroundWarned && chip.rows.some((r) => r.warns.includes('zaufanie')), `znak ⚠ przy chipie: ${chip.alert}, sklep w tle z ostrzeżeniem: ${backgroundWarned}`);
        ev.note(`zaufanie po miesiącu +${months}: ${open3.map((st) => `#${st.id} ${Math.round(st.trust)}`).join(', ')}; ostrzeżenia na chipie: ${chip.rows.map((r, i) => `#${open3[i].id} [${r.warns.join(', ') || 'brak'}]`).join(' ')}; ⚠ przy chipie: ${chip.alert}; wiersz z ostrzeżeniem: „${chip.rows.find((r) => r.warns.includes('zaufanie'))?.text.replace(/\s+/g, ' ').trim()}”`);
        if (phone) await checkWidth(page, 'lista sklepów (trzy) z ostrzeżeniem zaufania');
        await ev.shot('4a2-11c-lista-sklepow-ostrzezenie');
        await tapOutside(page, '.tt-stores-backdrop');
        await page.waitForSelector('.tt-stores-pop', { state: 'detached', timeout: 5_000 });
        ev.note(`gotówka po zamknięciu miesiąca ${money(g2.wallet)} zł (dzień ${g2.day}); po ${months} kolejnych miesiącach ${money(g3.wallet)} zł (dzień ${g3.day})`);
      });
      if (!go) return failRelet(vp, 11, 'krok 11 nie przeszedł');
    } finally {
      await ctx.close();
    }

    // --- 12 (telefon): nowe ekrany po polsku (pomiary z kroków 9–11) i po angielsku (ten sam przebieg od nowa w angielskim interfejsie) ---
    if (phone) {
      const en = await newPage(browser, vp, 'po-traszce-en', { fixture: after });
      try {
        await runStep(vp, 12, en.page, (ev) => englishChecks(en.page, ev, fit));
      } finally {
        await en.ctx.close();
      }
    }
  }

  /** Kroki 9–12 po porażce wcześniejszego z nich (te, które dotyczą tego rozmiaru): porażka z przyczyną, a nie milczenie. */
  function failRelet(vp, afterId, why) {
    for (const step of STEPS) {
      if (typeof step.id !== 'number' || step.id <= afterId || step.id < 9 || !step.sizes.includes(vp.name)) continue;
      (results[vp.name] ??= {})[step.id] = stepResult({ ok: false, failed: [`pominięty: ${why}`] });
      console.log(`  [${vp.name}] krok ${step.id}: FAIL (pominięty: ${why})`);
    }
  }

  /**
   * Krok 12: pomiary szerokości nowych ekranów z kroków 9–11 (po polsku) muszą być kompletne i bez wylewu, a po angielsku ten sam przebieg gra się od nowa:
   * język w ⚙ (przeładowanie, zapis zostaje), karta lokalu po Traszce, ponowny wynajem gotówką, okno otwarcia, lista chipa z trzema sklepami, karta
   * wolnego lokalu z wykresem i tekstem Centrali oraz okno sieci z czterema zakładkami.
   */
  async function englishChecks(page, ev, fit) {
    const pl = newScreenProblems(widths);
    ev.check(pl.length === 0, `nowe ekrany po polsku: ${pl.join(' | ')}`);
    ev.note(`po polsku zmierzono: ${NEW_SCREENS.map((sc) => `${sc.name} ×${widths.filter((w) => w.label.startsWith(sc.name)).length}`).join(', ')}`);

    await waitReady(page);
    await pause(page);
    await settle(page);
    await pause(page);
    await press(page, '.tt-gear');
    await page.waitForSelector('[role="dialog"][aria-label="Ustawienia"]');
    await Promise.all([
      page.waitForEvent('load', { timeout: 120_000 }),
      page.locator('[aria-label="Ustawienia"]').getByRole('button', { name: 'English', exact: true }).click(),
    ]);
    await waitReady(page);
    await pause(page);
    await settle(page);
    await pause(page);
    const lang = await page.evaluate(() => localStorage.getItem('traszka:lang'));
    ev.check(lang === 'en', `język w pamięci: ${lang}`);
    const g0 = await readGame(page);
    ev.check(JSON.stringify(g0.stores.map((st) => [st.id, st.closed])) === '[[1,false],[2,true],[3,false]]', `po przeładowaniu sklepy: ${JSON.stringify(g0.stores.map((st) => [st.id, st.closed]))}`);
    const lotId = g0.stores.find((st) => st.id === 2).lotId;

    // karta lokalu po Traszce po angielsku
    await openTab(page, 'miasto');
    await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
    await pickLot(page, lotId);
    const card = await readCard(page);
    ev.check(!!card.relet && card.relet.length > 10 && card.relet !== reletBlockText(fit) && !!card.caption && card.caption !== RELET_CAPTION, `blok „${card.relet}” (polski: „${reletBlockText(fit)}”), podpis „${card.caption}”`);
    chartChecks(ev, card, 'wykres po angielsku');
    ev.note(`po angielsku: adres „${card.head}”, blok „${card.relet}”, podpis „${card.caption}”, przyciski ${card.pay.map((b) => `„${b.replace(/\s+/g, ' ').trim()}”`).join(' | ')}`);
    await checkWidth(page, 'angielski: karta lokalu po Traszce');
    await ev.shot('4a2-12a-angielski-karta-po-traszce');

    // ponowny wynajem gotówką i otwarcie po angielsku
    await page.locator('.tt-lotpay .tt-btn').nth(0).click();
    const rent = page.locator('.tt-lotact .tt-primary');
    ev.check(await rent.isEnabled(), `przycisk wynajmu zablokowany: ${await textOf(page, '.tt-lockmsg')}`);
    await rent.click();
    await until(page, () => window.traszkaGame.session.firm.builds.length === 1, null, 'budowa po wynajmie (angielski)');
    const readyDay = (await readGame(page)).builds[0].readyDay;
    const reopened = await skipToOpening(page, readyDay, /^Traszka #2 is open again$/);
    if (ev.check(!!reopened, 'okno „Traszka #2 is open again” nie pojawiło się')) {
      ev.note(`okno po angielsku: „${reopened.label}” — ${reopened.text.replace(/\s+/g, ' ').slice(0, 200)}`);
      await sleep(450);
      await checkWidth(page, `okno: ${reopened.label}`);
      await press(page, '.tt-story .tt-primary');
      await settle(page);
    }
    const g1 = await readGame(page);
    const r2 = g1.stores.find((st) => st.id === 2);
    ev.check(g1.stores.filter((st) => !st.closed).length === 3, `po otwarciu otwartych sklepów: ${g1.stores.filter((st) => !st.closed).length}`);
    ev.check(!!r2 && r2.level === 1 && Math.round(r2.trust) === RELET_TRUST && r2.remont === fit.remontLevel, `#2 po otwarciu: poziom ${r2?.level}, zaufanie ${r2 && Math.round(r2.trust)}, remont ${r2?.remont}`);
    ev.note(`po angielsku #2 otwarty w dniu ${Math.floor((r2?.minute ?? 0) / 1440)} (poziom ${r2?.level}, zaufanie ${r2 && Math.round(r2.trust)})`);

    // lista chipa z trzema sklepami
    await closeTab(page, 'miasto');
    await page.waitForSelector('[data-tut="store-switch"]', { timeout: 15_000 });
    const chip = await readChipList(page, { before: async () => { await checkWidth(page, 'angielski: lista sklepów (trzy)'); await ev.shot('4a2-12b-angielski-lista-trzech-sklepow'); } });
    ev.check(chip.rows.length === 3 && chip.rows.every((r) => !r.closed), `lista chipa po angielsku: ${JSON.stringify(chip.rows.map((r) => [r.text.slice(0, 30), r.closed]))}`);

    // karta wolnego lokalu z wykresem i tekstem limitu
    await openTab(page, 'miasto');
    await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
    const rows = await readLots(page);
    await pickLot(page, rows[0].id);
    const free = await readCard(page);
    ev.check(free.disabled === true && !!free.lock && free.lock.length > 20 && free.lock !== LIMIT_TEXT && free.relet === null, `karta wolnego lokalu po angielsku: przycisk zablokowany ${free.disabled}, tekst „${free.lock}” (polski: „${LIMIT_TEXT}”)`);
    chartChecks(ev, free, 'wykres wolnego lokalu po angielsku');
    ev.note(`po angielsku, trzy placówki: „${free.lock}”`);
    await checkWidth(page, 'angielski: karta lokalu z wykresem');
    await page.evaluate(() => document.querySelector('.tt-lockmsg')?.scrollIntoView({ block: 'nearest' }));
    await sleep(250);
    await ev.shot('4a2-12d-angielski-limit');
    await press(page, '.tt-lotcard-close');
    await closeTab(page, 'miasto');

    // okno sieci z czterema zakładkami
    const { stopped: net } = await advance(page, { stop: /^Head Office statements/, maxDays: 40 });
    if (ev.check(!!net, 'okno z wyciągami sieci po angielsku nie pojawiło się do końca miesiąca')) {
      ev.note(`okno: „${net.label}”`);
      await networkWindowChecks(page, ev, { phone: true, lang: 'en' });
      await press(page, '.tt-modal:has(h2[data-tut="report"]) .tt-modal-foot .tt-primary');
      await settle(page);
      await monthPreviewChecks(page, ev, { lang: 'en' });
      // lista chipa z ostrzeżeniem o zaufaniu po angielsku
      const { g: gw, months } = await playUntilTrustWarning(page, ev, { stop: /^Head Office statements/, prefix: 'angielski: ', phone: true });
      const openW = gw.stores.filter((st) => !st.closed);
      ev.check(openW.length === 3 && openW.some((st) => st.trust < BACKGROUND_TRUST_WARN_BELOW), `po ${months} kolejnych miesiącach żaden sklep nie spadł poniżej ${BACKGROUND_TRUST_WARN_BELOW}: ${openW.map((st) => `#${st.id} ${Math.round(st.trust)}`).join(', ')}`);
      const chipW = await readChipList(page, { before: async () => { await checkWidth(page, 'angielski: lista sklepów (trzy) z ostrzeżeniem zaufania'); await ev.shot('4a2-12e-angielski-lista-ostrzezenie'); } });
      ev.check(chipW.rows.some((r) => r.warns.includes('zaufanie')), `lista chipa po angielsku bez ostrzeżenia zaufania: ${JSON.stringify(chipW.rows.map((r) => r.warns))}`);
      ev.note(`po angielsku, po ${months} kolejnych miesiącach: zaufanie ${openW.map((st) => `#${st.id} ${Math.round(st.trust)}`).join(', ')}; wiersz z ostrzeżeniem: „${chipW.rows.find((r) => r.warns.includes('zaufanie'))?.text.replace(/\s+/g, ' ').trim()}”`);
    }
    const en = newScreenProblems(widths, 'angielski: ');
    ev.check(en.length === 0, `nowe ekrany po angielsku: ${en.join(' | ')}`);
    const bad = widths.filter((w) => !w.ok && (w.label.startsWith('angielski: ') || NEW_SCREENS.some((sc) => w.label.startsWith(sc.name))));
    ev.check(bad.length === 0, `poziomy wylew: ${bad.map((w) => `${w.label}: ${w.problems.join('; ')}`).join(' | ')}`);
    ev.note(`po angielsku zmierzono: ${NEW_SCREENS.map((sc) => `${sc.name} ×${widths.filter((w) => w.label.startsWith(`angielski: ${sc.name}`)).length}`).join(', ')}`);
  }

  // ——————— plan 4b, Zadanie 10: remonty 4–5, badania Sieci, cztery sklepy, milion i Galeria, karta „Zrzut Traszkomonów” (kroki 4b-a…4b-g) ———————

  /** Sklep i ulica: zrzut w kadrze z gry, potem z kamerą oddaloną do granicy (`rig.zoomBy`), i powrót do kadru. Zwraca wymiary pawilonu i kadru. */
  async function shopAndStreet(page, ev, name) {
    await sleep(1500);   // scena po wczytaniu dociąga modele i ustawia kamerę
    const frame = await page.evaluate(() => {
      const g = window.traszkaGame;
      const rig = g.ctx.rig;
      const l = g.session.layout;
      return { width: l.width, depth: l.depth, view: rig.viewSize, viewMax: rig.viewMax, aspect: innerWidth / innerHeight };
    });
    await ev.shot(`${name}-sklep`);
    await page.evaluate(() => { window.traszkaGame.ctx.rig.zoomBy(0.01); });   // do granicy oddalenia (`viewMax`)
    await sleep(900);
    const far = await page.evaluate(() => window.traszkaGame.ctx.rig.viewSize);
    await ev.shot(`${name}-ulica`);
    await page.evaluate((v) => { const rig = window.traszkaGame.ctx.rig; rig.zoomBy(rig.viewSize / v); }, frame.view);
    await sleep(300);
    ev.note(`${name}: pawilon ${frame.width} × ${frame.depth} kratek; kadr ${frame.view.toFixed(1)} m wysokości (${(frame.view * frame.aspect).toFixed(1)} m szerokości ekranu), oddalony ${far.toFixed(1)} m (${(far * frame.aspect).toFixed(1)} m), granica ${frame.viewMax} m`);
    return { ...frame, far };
  }

  /** Błędy konsoli i `pageerror` z kontekstu `tag` tego rozmiaru, od indeksu `from` (zapisany przed krokiem). */
  const consoleSince = (vp, tag, from) => errors.slice(from).filter((e) => e.startsWith(`${vp.name}/${tag}:`));

  async function scenario4b(browser, vp0) {
    const vp = vp0.mobile ? vp0 : { ...vp0, size: DESKTOP_4B };
    const phone = vp.mobile;
    const fixture = { seed: two.seed, text: withRemont(two.text, { storeId: 2, remontLevel: 5, level: 34 }) };
    const errorsFrom = errors.length;
    const { ctx, page } = await newPage(browser, vp, '4b', { fixture });
    const fame = { submits: [], lists: 0 };
    try {
      let go = await runStep(vp, '4b-a', page, async (ev) => {
        await waitReady(page);
        await pause(page);
        await settle(page);
        await pause(page);
        const g = await readGame(page);
        const s2 = g.stores.find((st) => st.id === 2);
        ev.check(g.activeId === 2 && s2?.remont === 5 && s2.level === 34 && !s2.closed, `sklep #2: aktywny ${g.activeId}, remont ${s2?.remont}, poziom ${s2?.level}`);
        const firm = await page.evaluate(() => {
          const f = window.traszkaGame.session.firm;
          return { research: f.research, storeLimit: f.storeLimit, goals: f.goals, fame: f.fame, broken: Object.keys(localStorage).filter((k) => k.includes(':broken')) };
        });
        // schemat 3 → 4 (spec 4b §5.8): bez badań, limit trzech placówek, puste cele firmy, bez wpisu do Galerii, nic w `:broken`
        ev.check(JSON.stringify(firm.research) === '{}' && firm.storeLimit === 3 && firm.fame === null && firm.goals.claimed.length === 0, `firma po migracji: ${JSON.stringify(firm)}`);
        ev.check(firm.broken.length === 0, `zapis w :broken: ${firm.broken.join(', ')}`);
        ev.check(g.builds.length === 1 && g.stores.filter((st) => !st.closed).length === 1, `fixture: budowy ${g.builds.length}, otwarte ${g.stores.filter((st) => !st.closed).length}`);
        ev.note(`zapis schematu 3 „dwa sklepy” (seed ${g.seed}, dzień ${g.day}): sklep #2 remont ${s2?.remont}, poziom ${s2?.level}; gotówka ${money(g.wallet)} zł; po migracji badania ${JSON.stringify(firm.research)}, limit ${firm.storeLimit}, cele ${JSON.stringify(firm.goals)}, Galeria ${firm.fame}`);
        await shopAndStreet(page, ev, '4b-01-remont5');
        const errs = consoleSince(vp, '4b', errorsFrom);
        ev.check(errs.length === 0, `błędy konsoli przy remoncie 5: ${errs.slice(0, 3).join(' | ')}`);
      });
      if (!go) return;

      go = await runStep(vp, '4b-b', page, async (ev) => {
        const { stopped } = await advance(page, { stop: /^Traszka #3 otwarta$/, maxDays: 3, chunk: 720 });
        if (!ev.check(!!stopped, 'okno „Traszka #3 otwarta” nie pojawiło się')) return;
        await sleep(450);
        await press(page, '.tt-story .tt-primary');
        await settle(page);
        const g0 = await readGame(page);
        ev.check(g0.stores.filter((st) => !st.closed).length === 2, `otwarte sklepy po budowie: ${g0.stores.filter((st) => !st.closed).length}`);
        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-research[open] [data-research]', { timeout: 30_000 });
        const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-research [data-research]')].map((el) => ({
          id: el.dataset.research, fee: /w tym opłata koordynacyjna Centrali: /.test(el.textContent ?? ''), enabled: el.querySelector('.tt-buy')?.disabled === false,
        })));
        const head = await textOf(page, '.tt-research summary');
        ev.check(/Sieć: badania/.test(head ?? ''), `nagłówek sekcji: „${head}”`);
        ev.check(rows.length === 6 && rows.every((r) => r.fee && r.enabled), `wiersze badań: ${JSON.stringify(rows)}`);
        const fee = await page.evaluate(() => [...document.querySelectorAll('.tt-research [data-research="dostawy"] .tt-muted')].map((d) => d.textContent).find((t) => /opłata koordynacyjna/.test(t ?? '')) ?? null);
        ev.note(`sekcja „${head?.trim()}”: ${rows.length} wierszy (${rows.map((r) => r.id).join(', ')}), dostawy: „${fee}”`);
        await page.evaluate(() => document.querySelector('.tt-research [data-research="dostawy"]')?.scrollIntoView({ block: 'center' }));
        await sleep(250);
        const w0 = (await readGame(page)).wallet;
        await press(page, '.tt-research [data-research="dostawy"] .tt-buy');
        await until(page, () => (window.traszkaGame.session.firm.research.dostawy ?? 0) === 1, null, 'badanie „Wspólne dostawy” na poziomie 1');
        const w1 = (await readGame(page)).wallet;
        ev.check(Math.abs(w0 - w1 - RESEARCH_DOSTAWY_COST) < 0.01, `portfel zszedł o ${money(w0 - w1)} zł zamiast ${money(RESEARCH_DOSTAWY_COST)} zł`);
        const after = await page.evaluate(() => document.querySelector('.tt-research [data-research="dostawy"]')?.textContent ?? '');
        ev.note(`kupione „Wspólne dostawy”: portfel ${money(w0)} → ${money(w1)} zł; wiersz po zakupie: „${after.replace(/\s+/g, ' ').slice(0, 220)}”`);
        await sleep(300);
        if (phone) await checkWidth(page, '4b: sekcja badań Sieci');
        await ev.shot('4b-02-badania');
      });
      if (!go) return;

      go = await runStep(vp, '4b-c', page, async (ev) => {
        await page.evaluate((w) => {
          const f = window.traszkaGame.session.firm;
          f.storeLimit = 4;
          f.person.wallet = w;
          for (const st of f.stores) if (!st.closed) st.econ.cash = w;
        }, WALLET_4B_RENT);
        await closeTab(page, 'miasto');
        await skip(page, 1);
        await settle(page);
        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
        const rented = [];
        for (let n = 0; n < 2; n++) {
          const rows = (await readLots(page)).filter((r) => !r.relet).sort((a, b) => a.price - b.price || a.id - b.id);
          const lot = rows[0];
          if (!ev.check(!!lot, 'brak wolnego lokalu na liście')) return;
          await pickLot(page, lot.id);
          const payButton = page.locator('.tt-lotpay .tt-btn', { hasText: /gotówkę/ });
          await payButton.click();
          const rent = page.getByRole('button', { name: 'Biorę lokal', exact: true });
          if (!ev.check(await rent.isEnabled(), `„Biorę lokal” zablokowany przy ${n + 3}. placówce: ${await textOf(page, '.tt-lockmsg')}`)) return;
          const g1 = await readGame(page);
          await rent.click();
          await until(page, (k) => window.traszkaGame.session.firm.builds.length === k, g1.builds.length + 1, `budowa po „Biorę lokal” (${n + 3}. placówka)`);
          const g2 = await readGame(page);
          ev.check(Math.abs(g1.wallet - g2.wallet - lot.price) < 0.01, `gotówka zeszła o ${money(g1.wallet - g2.wallet)} zł zamiast ${money(lot.price)} zł`);
          rented.push({ id: lot.id, price: lot.price, days: lot.buildDays, addr: `ul. ${lot.street} ${lot.number}`, district: lot.district });
          if (await visible(page, '.tt-lotcard')) await press(page, '.tt-lotcard-close');
          await sleep(300);
        }
        ev.note(`wynajęte za gotówkę: ${rented.map((r) => `${r.addr} (${r.district}, ${money(r.price)} zł, ${daysText(r.days)})`).join('; ')}`);
        await closeTab(page, 'miasto');
        const maxDays = Math.max(...rented.map((r) => r.days)) + 3;
        const { game } = await advance(page, { maxDays, chunk: 720, done: (g) => g.builds.length === 0 && g.stores.filter((st) => !st.closed).length === 4 });
        const g3 = game ?? await readGame(page);
        ev.check(g3.builds.length === 0 && g3.stores.filter((st) => !st.closed).length === 4, `po budowach: otwarte ${g3.stores.filter((st) => !st.closed).length}, budowy ${g3.builds.length}`);
        await page.click('[data-tut="store-switch"]');
        await page.waitForSelector('.tt-stores-pop', { timeout: 10_000 });
        const list = await page.evaluate(() => [...document.querySelectorAll('.tt-store-row')].map((r) => ({ text: (r.querySelector('.tt-store-name b')?.textContent ?? '').trim(), closed: r.classList.contains('closed') })));
        ev.check(list.filter((r) => !r.closed).length === 4, `lista chipa: ${JSON.stringify(list)}`);
        ev.note(`lista chipa: ${list.map((r) => `${r.text}${r.closed ? ' (zamknięty)' : ''}`).join(', ')}; dzień ${g3.day}, gotówka ${money(g3.wallet)} zł`);
        if (phone) await checkWidth(page, '4b: lista sklepów (cztery)');
        await ev.shot('4b-03-cztery-sklepy');
        await tapOutside(page, '.tt-stores-backdrop');
        await page.waitForSelector('.tt-stores-pop', { state: 'detached', timeout: 5_000 });
      });
      if (!go) return;

      go = await runStep(vp, '4b-d', page, async (ev) => {
        await page.evaluate((w) => {
          const f = window.traszkaGame.session.firm;
          f.person.wallet = w;
          for (const st of f.stores) if (!st.closed) st.econ.cash = w;
        }, WALLET_4B_MILLION);
        const g0 = await readGame(page);
        let { stopped } = await advance(page, { stop: /^Milion!$/, maxDays: 35 });
        const g1 = await readGame(page);
        ev.note(`portfel ${money(WALLET_4B_MILLION)} zł w dniu ${g0.day}; ${stopped ? `okno „${stopped.label}” w dniu ${g1.day} przy ${money(g1.wallet)} zł` : `bez okna do dnia ${g1.day}, portfel ${money(g1.wallet)} zł`}`);
        if (!ev.check(!!stopped, 'okno „Milion!” nie pojawiło się do zamknięcia miesiąca')) return;
        await sleep(450);
        const title = await textOf(page, '.tt-fame h2');
        ev.check(title === FAME_TITLE, `tytuł okna: „${title}”`);
        if (phone) await checkWidth(page, '4b: okno Milion!');
        await ev.shot('4b-04-milion');
        await page.locator('.tt-fame').getByRole('button', { name: 'Wpisz mnie do Galerii sław' }).click();
        await until(page, (t) => (document.querySelector('.tt-fame')?.textContent ?? '').includes(t), FAME_CLOSED, 'komunikat „Galeria jest teraz nieczynna”', 20_000);
        const msg = await textOf(page, '.tt-fame .tt-finish-status');
        ev.note(`po „Wpisz mnie do Galerii sław” przy przerwanym /api/**: „${msg?.trim()}”`);
        await ev.shot('4b-04b-milion-nieczynna');
        await page.locator('.tt-fame').getByRole('button', { name: 'Zamknij' }).click();
        await page.waitForSelector('.tt-fame', { state: 'detached', timeout: 5_000 });
        const m0 = (await readGame(page)).minute;
        await skip(page, 120);
        await settle(page);
        const g2 = await readGame(page);
        ev.check(g2.minute > m0 && g2.over === null && !g2.gameOver, `gra po zamknięciu okna: minuta ${m0} → ${g2.minute}, koniec ${g2.over}/${g2.gameOver}`);
        // zakładka „Galeria sław” w panelu rankingu: komunikat i „Wyślij mój wpis”
        await page.getByRole('button', { name: 'Ranking' }).click();
        await page.waitForSelector('.tt-ranking', { timeout: 10_000 });
        await page.locator('.tt-ranking').getByRole('tab', { name: 'Galeria sław' }).click();
        await until(page, (t) => (document.querySelector('.tt-ranking')?.textContent ?? '').includes(t), FAME_CLOSED, 'zakładka Galerii z komunikatem', 20_000);
        const tab = (await textOf(page, '.tt-ranking')) ?? '';
        ev.check(tab.includes(FAME_CLOSED) && tab.includes('Wyślij mój wpis'), `zakładka Galerii: „${tab.replace(/\s+/g, ' ').slice(0, 200)}”`);
        if (phone) await checkWidth(page, '4b: zakładka Galerii (nieczynna)');
        await ev.shot('4b-05-galeria');
        // atrapa /api/fame/* w przeglądarce (późniejsza trasa ma pierwszeństwo przed przerwaniem `/api/**`): nic nie idzie do żadnego serwera
        await ctx.route('**/api/fame/**', (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/fame/list') {
            fame.lists++;
            return route.fulfill({ json: { ok: true, total: 3, rows: [
              { place: 1, nick: 'Ala z Lipowej', at: Date.UTC(2026, 10, 2, 9) },
              { place: 2, nick: 'Kasjer Roku', at: Date.UTC(2026, 10, 2, 13) },
              { place: 3, nick: 'Smoke', at: Date.UTC(2026, 10, 3, 8) },
            ] } });
          }
          if (path === '/api/fame/submit' && route.request().method() === 'POST') {
            fame.submits.push(JSON.parse(route.request().postData() ?? '{}'));
            return route.fulfill({ json: { ok: true, first: true, place: 3, entry: { nick: 'Smoke', at: Date.UTC(2026, 10, 3, 8) } } });
          }
          return route.abort();
        });
        await page.locator('.tt-ranking').getByRole('button', { name: 'Wyślij mój wpis' }).click();
        await page.waitForSelector('.tt-fame', { timeout: 10_000 });
        await page.locator('.tt-fame').getByRole('button', { name: 'Wpisz mnie do Galerii sław' }).click();
        await until(page, () => /Jesteś w Galerii sław Traszki/.test(document.querySelector('.tt-fame')?.textContent ?? ''), null, 'wpis do Galerii przez atrapę', 20_000);
        const sent = fame.submits[0] ?? {};
        ev.check(fame.submits.length === 1 && sent.seed === two.seed && sent.simVersion === 7 && sent.cash >= 1_000_000 && Number.isInteger(sent.day) && typeof sent.key === 'string',
          `wysłany wpis: ${JSON.stringify({ ...sent, key: sent.key ? '…' : sent.key })}`);
        ev.note(`atrapa /api/fame/submit dostała: nick „${sent.nick}”, seed ${sent.seed}, dzień ${sent.day}, gotówka ${money(sent.cash ?? 0)} zł, SIM ${sent.simVersion}`);
        await page.locator('.tt-fame').getByRole('button', { name: 'Zobacz Galerię' }).click();
        await page.waitForSelector('.tt-fame-row', { timeout: 10_000 });
        const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-fame-row')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim()));
        ev.check(rows.length === 3 && /^1\. Ala z Lipowej/.test(rows[0] ?? ''), `lista Galerii z atrapy: ${JSON.stringify(rows)}`);
        const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('traszka:meta') ?? '{}').fameSent ?? null);
        ev.check(Array.isArray(meta) && meta.includes(two.seed), `meta.fameSent: ${JSON.stringify(meta)}`);
        ev.note(`lista z atrapy: ${rows.join(' | ')}; zapytania do atrapy: lista ${fame.lists}, wpis ${fame.submits.length}`);
        if (phone) await checkWidth(page, '4b: Galeria sław (atrapa)');
        await ev.shot('4b-05b-galeria-atrapa');
        await press(page, '.tt-ranking .tt-card-close');
        await page.waitForSelector('.tt-ranking', { state: 'detached', timeout: 5_000 });
        extras.fame4b = { ...(extras.fame4b ?? {}), [vp.name]: { lists: fame.lists, submits: fame.submits.length } };
      });
      if (!go) return;

      await runStep(vp, '4b-e', page, async (ev) => {
        await settle(page);
        await press(page, '.tt-gear');
        await page.waitForSelector('[role="dialog"][aria-label="Ustawienia"]');
        await Promise.all([
          page.waitForEvent('load', { timeout: 120_000 }),
          page.locator('[aria-label="Ustawienia"]').getByRole('button', { name: 'English', exact: true }).click(),
        ]);
        await waitReady(page);
        await pause(page);
        await settle(page);
        await pause(page);
        const again = await visible(page, '.tt-fame');
        ev.check(!again, 'po przeładowaniu znów okno gratulacji (seed jest w meta.fameSent)');
        if (again) await page.locator('.tt-fame').getByRole('button', { name: 'Close' }).click();
        const lang = await page.evaluate(() => localStorage.getItem('traszka:lang'));
        ev.check(lang === 'en', `język w pamięci: ${lang}`);
        await openTab(page, 'miasto');
        await page.waitForSelector('.tt-research[open] [data-research]', { timeout: 30_000 });
        const head = await textOf(page, '.tt-research summary');
        const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-research [data-research]')].map((el) => ({
          id: el.dataset.research, name: el.querySelector('b')?.textContent ?? '', fee: /coordination fee/.test(el.textContent ?? ''), pl: /opłata|Wspólne|Centrali/.test(el.textContent ?? ''),
        })));
        ev.check(/Network: research/.test(head ?? ''), `nagłówek po angielsku: „${head}”`);
        ev.check(rows.length === 6 && rows.every((r) => !r.pl) && rows.filter((r) => r.fee).length >= 5, `wiersze po angielsku: ${JSON.stringify(rows)}`);
        ev.note(`po angielsku: „${head?.trim()}”, ${rows.map((r) => r.name).join(' | ')}`);
        await page.evaluate(() => document.querySelector('.tt-research [data-research="dostawy"]')?.scrollIntoView({ block: 'center' }));
        await sleep(300);
        if (phone) await checkWidth(page, 'angielski: 4b: sekcja badań Sieci');
        await ev.shot('4b-06-angielski-badania');
      });
    } finally {
      await ctx.close();
    }
  }

  async function scenario4bZrzut(browser, vp0) {
    const vp = vp0.mobile ? vp0 : { ...vp0, size: DESKTOP_4B };
    const ids = deckIds(readFileSync(join(ROOT, 'src', 'sim', 'economy', 'tycoon', 'deck.ts'), 'utf8'));
    const text = withOnlyCardTomorrow(withRemont(after.text, { storeId: 1, remontLevel: 4, level: 28 }), { storeId: 1, cardId: 'karty-zrzut', ids });
    const errorsFrom = errors.length;
    const { ctx, page } = await newPage(browser, vp, '4b-zrzut', { fixture: { seed: after.seed, text } });
    try {
      const go = await runStep(vp, '4b-f', page, async (ev) => {
        await waitReady(page);
        await pause(page);
        await settle(page);
        await pause(page);
        const g = await readGame(page);
        const s1 = g.stores.find((st) => st.id === 1);
        ev.check(g.activeId === 1 && s1?.remont === 4 && s1.level === 28, `sklep #1: aktywny ${g.activeId}, remont ${s1?.remont}, poziom ${s1?.level}`);
        ev.note(`zapis „po Traszce” (seed ${g.seed}, dzień ${g.day}): sklep startowy #1 z remontem ${s1?.remont} i poziomem ${s1?.level}; talia: ${ids.length} kart, jutro tylko „karty-zrzut”`);
        await shopAndStreet(page, ev, '4b-07-remont4');
        const errs = consoleSince(vp, '4b-zrzut', errorsFrom);
        ev.check(errs.length === 0, `błędy konsoli przy remoncie 4: ${errs.slice(0, 3).join(' | ')}`);
      });
      if (!go) return;
      await runStep(vp, '4b-g', page, async (ev) => {
        const { stopped } = await advance(page, { stop: /Zrzut Traszkomonów/, maxDays: 2, chunk: 360 });
        if (!ev.check(!!stopped, 'karta „Zrzut Traszkomonów” nie pojawiła się do jutra')) return;
        await sleep(450);
        const card = await page.evaluate(() => {
          const m = document.querySelector('.tt-deck');
          return { label: m?.getAttribute('aria-label') ?? '', text: (m?.textContent ?? '').replace(/\s+/g, ' ').trim(), answers: m ? m.querySelectorAll('[role="radio"], .tt-deck-answer, input[type="radio"]').length : 0 };
        });
        const g = await readGame(page);
        ev.check(/Zrzut Traszkomonów/.test(card.label) && /Limit 2 saszetki/.test(card.text) && /Bez limitu/.test(card.text), `karta: ${card.label} — ${card.text.slice(0, 160)}`);
        ev.note(`„${card.label}” w dniu ${g.day} o ${String(Math.floor((g.minute % 1440) / 60)).padStart(2, '0')}:${String(g.minute % 60).padStart(2, '0')}: ${card.text.slice(0, 260)}`);
        if (vp.mobile) await checkWidth(page, '4b: karta Zrzut Traszkomonów');
        await ev.shot('4b-08-zrzut-traszkomonow');
        await press(page, '.tt-deck .tt-primary');
        await settle(page);
        const mods = await page.evaluate(() => window.traszkaGame.session.econ.tycoon.cards.active.map((m) => ({ kind: m.kind, value: m.value, from: m.from % 1440, minutes: m.until - m.from })));
        ev.check(mods.some((m) => m.kind === 'traffic' && Math.abs(m.value - 0.9) < 1e-9 && m.from === 360 && m.minutes === 360), `efekty po „Limit 2 saszetki”: ${JSON.stringify(mods)}`);
        ev.note(`po odpowiedzi domyślnej („Limit 2 saszetki”): ${JSON.stringify(mods)}`);
      });
    } finally {
      await ctx.close();
    }
  }

  // --- krok 7 (telefon) ---

  async function phoneChecks(page, ev) {
    await settle(page);
    // 7a: każdy ekran bez poziomego przewijania, zakładki bez ucinania
    const fit = await tabsFit(page);
    ev.check(fit.count === 6 && fit.inside && fit.navFits && fit.cut.length === 0, `pasek zakładek: ${JSON.stringify(fit)}`);
    ev.note(`pasek zakładek: ${fit.count} zakładek, w oknie ${fit.inside}, bez przewijania ${fit.navFits}, ucięte etykiety: ${fit.cut.length ? fit.cut.join(', ') : 'brak'}`);
    await checkWidth(page, 'sklep (bez arkusza)');
    for (const id of ['sklep', 'palety', 'ludzie', 'ulepszenia', 'cele', 'miasto']) {
      await openTab(page, id);
      await sleep(250);
      await checkWidth(page, `zakładka ${id}`);
    }
    await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
    const rows = await readLots(page);
    await pickLot(page, rows[0].id);
    await checkWidth(page, 'Miasto z kartą lokalu');
    await press(page, '.tt-lotcard-close');
    await closeTab(page, 'miasto');
    await press(page, '.tt-gear');
    await page.waitForSelector('[role="dialog"][aria-label="Ustawienia"]');
    await checkWidth(page, 'ustawienia');
    await press(page, '[role="dialog"][aria-label="Ustawienia"] .tt-card-close');
    await sleep(200);

    // 7b: FPS widoku warstw (licznik wydajności, F3), orientacyjnie: swiftshader liczy scenę na procesorze
    await openTab(page, 'miasto');
    await page.keyboard.press('F3');
    await page.waitForSelector('.tt-perf', { timeout: 10_000 });
    const fps = {};
    for (const layer of ['Ruch', 'Dzielnice']) {
      await page.locator('.tt-layers').getByRole('button', { name: layer, exact: true }).click();
      await sleep(2500);
      const samples = [];
      for (let i = 0; i < 8; i++) {
        const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-perf > div')].map((d) => [d.firstElementChild?.textContent ?? '', d.querySelector('b')?.textContent ?? '']));
        samples.push(parsePerf(rows));
        await sleep(700);
      }
      fps[layer] = {
        fps: median(samples.map((s) => s.fps)), minFps: Math.min(...samples.map((s) => s.fps)), maxFps: Math.max(...samples.map((s) => s.fps)),
        ms: median(samples.map((s) => s.ms)), calls: median(samples.map((s) => s.calls)), tris: median(samples.map((s) => s.tris)),
      };
      await ev.shot(`13-warstwa-${layer === 'Ruch' ? 'ruch' : 'dzielnice'}`);
    }
    extras.fps = fps;
    const hint = (x) => `${x.fps.toFixed(1)} FPS (min ${x.minFps}, max ${x.maxFps}), klatka ${x.ms.toFixed(0)} ms, ${x.calls} wywołań rysowania, ${Math.round(x.tris / 1000)} tys. trójkątów`;
    ev.note(`FPS widoku warstw „Ruch”: ${hint(fps.Ruch)}`);
    ev.note(`FPS widoku warstw „Dzielnice”: ${hint(fps.Dzielnice)}`);
    ev.check(fps.Ruch.calls > 0 && fps.Dzielnice.calls > 0 && fps.Ruch.calls < 60 && fps.Dzielnice.calls < 60, `wywołania rysowania: ${fps.Ruch.calls}/${fps.Dzielnice.calls} (budżet warstw: < 60)`);
    await page.keyboard.press('F3');
    await closeTab(page, 'miasto');

    // 7c: angielski w ⚙ (przeładowanie, zapis zostaje): adres „St.”, karta i chip w szerokości
    const gBefore = await readGame(page);
    await press(page, '.tt-gear');
    await page.waitForSelector('[role="dialog"][aria-label="Ustawienia"]');
    await Promise.all([
      page.waitForEvent('load', { timeout: 120_000 }),
      page.locator('[aria-label="Ustawienia"]').getByRole('button', { name: 'English', exact: true }).click(),
    ]);
    await waitReady(page);
    await pause(page);
    await settle(page);
    await pause(page);
    const gAfter = await readGame(page);
    // gra po przeładowaniu rusza z ×1 do pierwszej pauzy, więc minuta może odejść o kilka minut, ale nie cofnąć się (zapis wrócił z pagehide)
    const drift = gAfter.minute - gBefore.minute;
    ev.check(gAfter.stores.length === gBefore.stores.length && gAfter.activeId === gBefore.activeId && drift >= 0 && drift <= 30
      && gAfter.stores.every((s, i) => s.seed === gBefore.stores[i].seed && s.lotId === gBefore.stores[i].lotId),
    `po przeładowaniu: sklepów ${gAfter.stores.length}, aktywny #${gAfter.activeId}, minuta ${gAfter.minute} (przed: ${gBefore.stores.length}, #${gBefore.activeId}, ${gBefore.minute})`);
    ev.check(gAfter.sceneSeed === gAfter.activeSeed, `po przeładowaniu scena ${gAfter.sceneSeed}, aktywny sklep ${gAfter.activeSeed}`);
    const lang = await page.evaluate(() => localStorage.getItem('traszka:lang'));
    ev.check(lang === 'en', `język w pamięci: ${lang}`);
    const chip = await textOf(page, '[data-tut="store-switch"]');
    const chipBox = await page.evaluate(() => { const r = document.querySelector('[data-tut="store-switch"]')?.getBoundingClientRect(); return r ? { left: r.left, right: r.right } : null; });
    ev.check(!!chipBox && chipBox.left >= 0 && chipBox.right <= PHONE_WIDTH + 0.5, `chip: ${JSON.stringify(chipBox)}`);
    ev.note(`po przeładowaniu: sklepów ${gAfter.stores.length}, aktywny #${gAfter.activeId}, chip „${chip?.trim()}”, język ${lang}`);
    await checkWidth(page, 'angielski: sklep');
    const tabsEn = await tabsFit(page);
    ev.check(tabsEn.count === 6 && tabsEn.inside && tabsEn.navFits && tabsEn.cut.length === 0, `pasek zakładek po angielsku: ${JSON.stringify(tabsEn)}`);
    await openTab(page, 'miasto');
    await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
    const rowsEn = await readLots(page);
    ev.check(rowsEn.length > 0 && rowsEn.every((r) => /^\d+ .+ St\.$/.test(r.addr)), `adresy na liście po angielsku: ${rowsEn.slice(0, 3).map((r) => r.addr).join(' | ')}`);
    await pickLot(page, rowsEn[0].id);
    const head = await textOf(page, '.tt-lotcard h3');
    ev.check(/^\d+ .+ St\.$/.test(head ?? ''), `adres na karcie po angielsku: ${head}`);
    const card = await page.evaluate(() => { const r = document.querySelector('.tt-lotcard')?.getBoundingClientRect(); return r ? { left: r.left, right: r.right } : null; });
    ev.check(!!card && card.left >= 0 && card.right <= PHONE_WIDTH + 0.5, `karta lokalu po angielsku: ${JSON.stringify(card)}`);
    const lock = await textOf(page, '.tt-lotcard .tt-lockmsg');
    ev.note(`po angielsku: adres „${head}”, karta ${JSON.stringify(card)}, komunikat pod przyciskiem „${lock ?? '(przycisk aktywny)'}”`);
    await checkWidth(page, 'angielski: Miasto z kartą');
    await ev.shot('14-angielski-karta');
    // blok pakietu po angielsku: etykiety zapłaty łamią się do drugiego wiersza i nie wystają za przycisk (nowy wylew z kroku 7, poprawiony w city.css)
    await page.evaluate(() => document.querySelector('[data-tut="lot-price"]')?.scrollIntoView({ block: 'nearest' }));
    await sleep(300);
    const pay = await page.evaluate(() => [...document.querySelectorAll('.tt-lotpay .tt-btn')].map((b) => {
      const st = getComputedStyle(b);
      const text = b.getBoundingClientRect().height - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);   // wysokość samego tekstu
      return { text: (b.textContent ?? '').trim(), over: b.scrollWidth > b.clientWidth + 1, lines: Math.round(text / parseFloat(st.lineHeight)) };
    }));
    ev.check(pay.length === 2 && pay.every((b) => !b.over), `przyciski zapłaty po angielsku: ${JSON.stringify(pay)}`);
    ev.note(`przyciski zapłaty po angielsku: ${pay.map((b) => `„${b.text}” (${b.lines} wiersze)`).join(', ')}`);
    await ev.shot('14b-angielski-pakiet');
    await press(page, '.tt-lotcard-close');
    await closeTab(page, 'miasto');
    await page.click('[data-tut="store-switch"]');
    await page.waitForSelector('.tt-stores-pop');
    await checkWidth(page, 'angielski: lista sklepów');
    await ev.shot('15-angielski-chip');
    await tapOutside(page, '.tt-stores-backdrop');
    await page.waitForSelector('.tt-stores-pop', { state: 'detached', timeout: 5_000 });

    const bad = widths.filter((w) => !w.ok);
    ev.check(bad.length === 0, `poziomy wylew: ${bad.map((w) => `${w.label}: ${w.problems.join('; ')}`).join(' | ')}`);
    const modals = widths.filter((w) => w.label.startsWith('okno')).length;
    ev.note(`pomiary szerokości: ${widths.length} ekranów i okien (w tym ${modals} okien gry z kolejki), ${widths.reduce((n, w) => n + w.boxes, 0)} elementów okien, arkuszy i kart sprawdzonych osobno; `
      + `scrollWidth dokumentu ${Math.max(...widths.map((w) => w.scroll))} px najwyżej; ${widths.map((w) => w.label).join('; ')}`);
  }

  // --- przebieg z dymkami (telefon) ---

  async function tipsRun(browser, vp) {
    const { ctx, page } = await newPage(browser, vp, 'dymki', { fixture: before, tips: true });
    try {
      await runStep(vp, 'T', page, async (ev) => {
        const keep = ['tip-miasto', 'tip-lokal'];
        await waitReady(page);
        await pause(page);
        await settle(page, { keepTips: keep });
        await pause(page);
        let status = false;
        for (let i = 0; i < 8 && !status; i++) {
          await skip(page, 30);
          const r = await settle(page, { keepTips: keep, stop: /^Status Partnera Strategicznego$/ });
          if (r.stopped) { await sleep(450); await press(page, '.tt-story .tt-primary'); status = true; }
        }
        await settle(page, { keepTips: keep });
        ev.check(status && (await readGame(page)).partner, 'bez statusu Partnera nie ma czego sprawdzać (tip-lokal wymaga statusu)');
        const mem0 = await page.evaluate(() => JSON.parse(localStorage.getItem('traszka:tutorial')));
        ev.check(mem0.tips === true && !mem0.seen.includes('tip-miasto') && !mem0.seen.includes('tip-lokal'), `pamięć dymków przed otwarciem Miasta: ${JSON.stringify(mem0)}`);

        const tip = (id) => stable(() => readBubble(page, id), 20_000);
        // tip-miasto: pierwsze otwarcie Miasta, bez karty
        await openTab(page, 'miasto');
        const miasto = await tip('tip-miasto');
        if (ev.check(!!miasto, 'brak dymka tip-miasto przy pierwszym otwarciu Miasta')) {
          ev.check(miasto.target === 'city-status' && !!miasto.targetRect, `tip-miasto wskazuje „${miasto.target}”, cel ${miasto.targetRect ? 'widoczny' : 'niewidoczny'}`);
          ev.check(miasto.inView && !miasto.overlaps && !miasto.covers, `tip-miasto: w oknie ${miasto.inView}, zasłania cel ${miasto.overlaps}, covers ${miasto.covers}`);
          ev.check(miasto.width <= PHONE_WIDTH, `tip-miasto szerszy niż okno (${miasto.width})`);
          ev.note(`tip-miasto: „${miasto.text}” (strona ${miasto.side}, dymek ${JSON.stringify(round(miasto.bubble))}, cel ${JSON.stringify(round(miasto.targetRect))})`);
          await ev.shot('T1-dymek-miasto');
          await press(page, '.tt-tip-bubble .tt-tut-next');
        }
        await checkWidth(page, 'dymki: Miasto z dymkiem');

        // tip-lokal: karta wolnego lokalu, blok pakietu może być pod zgięciem arkusza
        await page.waitForSelector('.tt-city .tt-lotrow', { timeout: 30_000 });
        const rows = await readLots(page);
        await pickLot(page, rows[0].id);
        await sleep(1200);
        const initial = await readBubble(page, 'tip-lokal');
        const priceBox = await page.evaluate(() => {
          const el = document.querySelector('[data-tut="lot-price"]');
          const body = document.querySelector('.tt-sheet-body') ?? document.querySelector('.tt-lotcard');
          if (!el || !body) return null;
          const r = el.getBoundingClientRect();
          const b = body.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), sheetBottom: Math.round(b.bottom), belowFold: r.top >= b.bottom - 8 };
        });
        ev.note(`blok pakietu przy otwarciu karty: ${JSON.stringify(priceBox)}; dymek od razu: ${initial ? 'tak' : 'nie'}`);
        let lokal = initial ? await tip('tip-lokal') : null;
        if (!lokal) {
          // gracz przewija kartę do pakietu: dymek ma się wtedy pokazać przy tym bloku
          await page.evaluate(() => document.querySelector('[data-tut="lot-price"]')?.scrollIntoView({ block: 'nearest' }));
          await sleep(1200);
          lokal = await tip('tip-lokal');
          ev.note(`dymek tip-lokal pokazał się dopiero po przewinięciu karty do pakietu: ${lokal ? 'tak' : 'nie'}`);
        }
        if (ev.check(!!lokal, 'brak dymka tip-lokal na karcie wolnego lokalu')) {
          ev.check(lokal.target === 'lot-price' && !!lokal.targetRect, `tip-lokal wskazuje „${lokal.target}”, cel ${lokal.targetRect ? 'widoczny' : 'niewidoczny'}`);
          ev.check(lokal.inView && !lokal.overlaps && !lokal.covers, `tip-lokal: w oknie ${lokal.inView}, zasłania cel ${lokal.overlaps}, covers ${lokal.covers}`);
          ev.check(lokal.width <= PHONE_WIDTH, `tip-lokal szerszy niż okno (${lokal.width})`);
          ev.note(`tip-lokal: „${lokal.text}” (strona ${lokal.side}, dymek ${JSON.stringify(round(lokal.bubble))}, cel ${JSON.stringify(round(lokal.targetRect))})`);
          await ev.shot('T2-dymek-lokal');
          await press(page, '.tt-tip-bubble .tt-tut-next');
        }
        await checkWidth(page, 'dymki: karta z dymkiem');
        const mem1 = await page.evaluate(() => JSON.parse(localStorage.getItem('traszka:tutorial')));
        ev.check(mem1.seen.includes('tip-miasto') && mem1.seen.includes('tip-lokal'), `pamięć po „OK”: ${JSON.stringify(mem1.seen)}`);
        const bad = widths.filter((w) => !w.ok && w.label.startsWith('dymki'));
        ev.check(bad.length === 0, `poziomy wylew przy dymkach: ${bad.map((w) => `${w.label}: ${w.problems.join('; ')}`).join(' | ')}`);
      });
    } finally {
      await ctx.close();
    }
  }

  // --- zrzut Traszkomonów: kolejka przed sklepem (komputer) ---

  /** Pula postaci presetu `srednia` (jak `CROWD_MAX` w scene.ts): agenci w sali i kolejka razem nie wychodzą ponad nią. */
  const POOL_SREDNIA = 16;

  async function queueRun(browser, vp) {
    const drop = saveWithCardDrop(before.text);
    const { ctx, page } = await newPage(browser, vp, 'kolejka', { fixture: { seed: before.seed, text: drop.text }, quality: 'srednia' });
    const read = () => page.evaluate(() => {
      const g = window.traszkaGame;
      const root = g.ctx.scene.getObjectByName('crowd');
      return {
        minute: g.session.econ.minute,
        queue: g.crowdView?.queueSize ?? -1,
        // do puli liczą się ci, którzy jeszcze są w sali albo wchodzą: wychodzący (`leaving`) są już w drodze do zniknięcia
        agents: g.world.crowd.agents.filter((a) => a.state !== 'gone' && a.state !== 'leaving').length,
        states: g.world.crowd.agents.filter((a) => a.state !== 'gone').map((a) => a.state).join(','),
        objects: root ? root.children.filter((o) => !o.isInstancedMesh).length : -1,
      };
    });
    try {
      await runStep(vp, 'f', page, async (ev) => {
        await waitReady(page);
        await pause(page);
        await settle(page);
        // doba zrzutu, 7:30: przewijanie staje na kartach decyzji, więc kawałkami i z zamykaniem okien
        const start = drop.from + 90;
        for (let i = 0; i < 40 && (await readGame(page)).minute < start; i++) {
          await skip(page, Math.min(1440, start - (await readGame(page)).minute));
          await settle(page);
        }
        const g0 = await readGame(page);
        ev.check(g0.minute >= start && g0.minute < start + 30, `po przewinięciu minuta ${g0.minute}, oczekiwana ${start}`);
        ev.note(`karta wymuszona w kopercie zapisu: ruch +1,6 od minuty ${drop.from} do ${drop.until} (doba ${drop.day}, 6:00–10:00); start 7:30, minuta ${g0.minute}`);
        // czas rusza (×1), tłum wypełnia salę, a kolejka dochodzi po kilka postaci
        await page.click('[data-tut="speed"] .tt-btn:nth-child(2)');
        await until(page, () => (window.traszkaGame.crowdView?.queueSize ?? 0) >= 6, null, 'kolejka przed sklepem (co najmniej 6 postaci)', 90_000);
        // tłum w sali dochodzi do tempa z kartą, a pula postaci (sala + kolejka) ma się ustalić w granicach presetu: agenci, którzy
        // weszli, zanim kolejka urosła, wychodzą sami (nowych do puli nie przybywa), więc odczekujemy do ustalenia, najwyżej ~20 s
        let maxLoad = 0;
        let last = null;
        let calm = 0;
        for (let i = 0; i < 40 && calm < 3; i++) {
          await sleep(500);
          await settle(page);
          last = await read();
          maxLoad = Math.max(maxLoad, last.agents + last.queue);
          calm = i >= 10 && last.queue === 12 && last.agents + last.queue <= POOL_SREDNIA ? calm + 1 : 0;
        }
        ev.check(last.minute < drop.until - 5, `zrzut jeszcze trwa (minuta ${last.minute}, koniec efektu ${drop.until})`);
        ev.check(last.queue >= 6 && last.queue <= 12, `postaci w kolejce: ${last.queue} (oczekiwane 6–12)`);
        ev.check(last.queue === 12, `ruch +1,6 daje pełną kolejkę 12, jest ${last.queue}`);
        ev.check(last.agents + last.queue <= POOL_SREDNIA, `agenci w sali ${last.agents} + kolejka ${last.queue} ponad pulę postaci ${POOL_SREDNIA}`);
        ev.note(`kolejka ${last.queue}, agenci w sali ${last.agents} (poza wychodzącymi; wszyscy: ${last.states}; po ustaleniu), razem najwyżej ${maxLoad} w trakcie narastania (pula presetu srednia: ${POOL_SREDNIA}), obiekty w grupie tłumu ${last.objects} (z kasjerem i załogą), minuta ${last.minute}`);
        // kadr na chodnik przed wejściem: kolejka stoi po obu stronach drzwi
        await page.evaluate(() => {
          const g = window.traszkaGame;
          const l = g.world.layout;
          const e = l.entrance;
          const cx = e.reduce((n, c) => n + c.x, 0) / e.length;
          const rig = g.ctx.rig;
          rig.panBy(((cx + 0.5 - l.width / 2) * 0.5) - rig.target.x, ((2 + 0.5 - l.depth / 2) * 0.5) - rig.target.z);
          rig.zoomBy(1.6);
        });
        await sleep(1000);
        await ev.shot('f1-kolejka-zrzut');
        // po 10:00 efekt wygasa i kolejka się rozchodzi (po kilka postaci na raz)
        await page.evaluate(() => { document.querySelector('[data-tut="speed"] .tt-btn:nth-child(1)')?.click(); });
        await settle(page);
        const gNow = await readGame(page);
        await skip(page, Math.max(1, drop.until + 15 - gNow.minute));
        await settle(page);
        await page.click('[data-tut="speed"] .tt-btn:nth-child(2)');
        await until(page, () => (window.traszkaGame.crowdView?.queueSize ?? 1) === 0, null, 'kolejka rozeszła się po 10:00', 60_000);
        const after = await read();
        ev.check(after.queue === 0 && after.minute >= drop.until, `po zrzucie: kolejka ${after.queue}, minuta ${after.minute}`);
      });
    } finally {
      await ctx.close();
    }
  }

  const round = (r) => (r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } : null);

  /** Powtarza odczyt co 300 ms, aż ten sam dymek stoi w tym samym miejscu przez 4 pomiary (swiftshader daje kilka klatek na sekundę). */
  async function stable(read, timeout) {
    const until = Date.now() + timeout;
    const seen = [];
    const same = (a, b) => !!a && !!b && a.id === b.id && Math.abs(a.bubble.x - b.bubble.x) < 1 && Math.abs(a.bubble.y - b.bubble.y) < 1 && Math.abs(a.bubble.h - b.bubble.h) < 1;
    while (Date.now() < until) {
      const now = await read();
      seen.push(now);
      const tail = seen.slice(-4);
      if (now && tail.length === 4 && tail.every((x) => same(x, now))) return now;
      await sleep(300);
    }
    return null;
  }

  /** Stan dymka „pierwszy raz” `id` z prostokątem celu przyciętym do przewijanych przodków, jak w warstwie (kopia z tutorial-smoke.mjs). */
  function readBubble(page, id) {
    return page.evaluate((tipId) => {
      const b = document.querySelector(`.tt-tip-bubble[data-tip="${tipId}"]`);
      if (!b || b.style.opacity === '0') return null;
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const clip = (el) => {
        let r = rect(el);
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const st = getComputedStyle(p);
          if (!/(auto|scroll|hidden)/.test(st.overflowX + st.overflowY)) continue;
          const c = rect(p);
          const x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y), x1 = Math.min(r.x + r.w, c.x + c.w), y1 = Math.min(r.y + r.h, c.y + c.h);
          if (x1 <= x0 || y1 <= y0) return null;
          r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        return r;
      };
      const target = b.dataset.target ?? null;
      let targetRect = null;
      if (target) for (const el of document.querySelectorAll(`[data-tut="${target}"]`)) { targetRect = clip(el); if (targetRect) break; }
      const bubble = rect(b);
      const inView = bubble.x >= 0 && bubble.y >= 0 && bubble.x + bubble.w <= innerWidth + 0.5 && bubble.y + bubble.h <= innerHeight + 0.5;
      const hit = targetRect && bubble.x < targetRect.x + targetRect.w && targetRect.x < bubble.x + bubble.w
        && bubble.y < targetRect.y + targetRect.h && targetRect.y < bubble.y + bubble.h;
      return {
        id: b.dataset.tip ?? null, target, text: b.querySelector('.tt-tut-text')?.textContent ?? '', covers: b.dataset.covers === 'true',
        overlaps: !!hit, inView, width: bubble.w, side: [...b.classList].find((c) => c.startsWith('side-'))?.slice(5) ?? null, bubble, targetRect,
      };
    }, id);
  }

  // ——————— bieg ———————

  const server = await startPreview(port);
  const stopAll = () => { stopPreview(server); };
  let browser = null;
  // przerwanie z zewnątrz: najpierw przeglądarka, potem serwer, żeby żaden proces nie został
  const onSignal = (code) => () => {
    void (async () => {
      try { await browser?.close(); } catch { /* i tak kończymy */ }
      stopAll();
      process.exit(code);
    })();
  };
  process.on('SIGINT', onSignal(130));
  process.on('SIGTERM', onSignal(143));
  const started = Date.now();
  try {
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: LAUNCH_ARGS });
    for (const vp of VIEWPORTS) {
      if (args.only && vp.name !== args.only) continue;
      console.log(`${vp.name} (${vp.size.width}×${vp.size.height}${vp.mobile ? ', dotyk' : ''})`);
      // telefon: każde okno z kolejki gry (karta decyzji, wpis „OK”, raport, protokół remanentu, powitanie) mierzy się raz na tytuł, zanim je zamkniemy
      const probed = new Set();
      const fallbacksBefore = hooks.fallbacks.length;
      hooks.onDialog = vp.mobile ? async (page, d) => {
        // okno z zakładkami sklepów (protokół remanentu, wyciągi) mierzy się osobno dla każdej liczby sklepów
        const key = d.kind === 'deck' ? 'deck' : `${d.kind}:${d.label}:${d.tabs}`;
        if (probed.has(key)) return;
        probed.add(key);
        await checkWidth(page, `okno: ${d.kind === 'deck' ? 'karta decyzji' : d.label}${d.tabs > 0 ? ` [${d.tabs} zakładki sklepów]` : ''}`);
      } : null;
      const scenarios = args.stage === '4b' ? [] : [scenarioOldSave, scenarioFlow, scenarioRelet, ...(vp.mobile ? [tipsRun] : [])];
      // kroki 4b we własnym bloku: wyjątek w scenariuszach 4a nie zabiera im przebiegu (i odwrotnie)
      for (const group of [scenarios, [scenario4b, scenario4bZrzut, ...(vp.mobile ? [] : [queueRun])]]) {   // kolejka przy zrzucie (Zadanie 11): tylko komputer
        try {
          for (const run of group) await run(browser, vp);
        } catch (error) {
          console.log(`  [${vp.name}] wyjątek poza krokiem: ${error instanceof Error ? error.stack : String(error)}`);
          const r = (results[vp.name] ??= {});
          r.exception = stepResult({ ok: false, failed: [`wyjątek: ${error instanceof Error ? error.message : String(error)}`] });
        }
      }
      for (const step of [...STEPS, TIPS_STEP, ...STEPS_4B, QUEUE_STEP]) {
        if (!step.sizes.includes(vp.name)) (results[vp.name] ??= {})[step.id] = stepResult({ na: true, notes: ['nie dotyczy tego rozmiaru'] });
        else if (args.stage === '4b' && !STEPS_4B.includes(step) && step !== QUEUE_STEP && step.id !== 8) (results[vp.name] ??= {})[step.id] = stepResult({ na: true, notes: ['--etap 4b: tylko kroki 4b'] });
      }
      // 8: konsola i pageerror z całego rozmiaru
      const mine = errors.filter((e) => e.startsWith(`${vp.name}/`));
      const r8 = stepResult();
      if (mine.length > 0) { r8.ok = false; r8.failed.push(`błędy w konsoli: ${mine.length}`); r8.notes.push(...mine.slice(0, 5)); }
      const myApi = apiBlocked.filter((a) => a.startsWith(`${vp.name}/`));
      const myApiConsole = apiConsole.filter((a) => a.startsWith(`${vp.name}/`));
      if (myApiConsole.length > myApi.length) { r8.ok = false; r8.failed.push(`komunikatów o przerwanym /api/** w konsoli (${myApiConsole.length}) więcej niż przerwanych zapytań (${myApi.length})`); }
      r8.notes.push(`błędów konsoli i pageerror: ${mine.length}; przerwane zapytania do /api/**: ${myApi.length}${myApi.length ? ` (${[...new Set(myApi)].slice(0, 4).join(', ')})` : ''}; ich komunikaty „Failed to load resource” w konsoli (nie liczone jako błąd): ${myApiConsole.length}`);
      const myFallbacks = hooks.fallbacks.slice(fallbacksBefore);
      r8.notes.push(`awaryjne click() w DOM w pętli zamykania okien (settle/pause): ${myFallbacks.length}${myFallbacks.length ? ` (${[...new Set(myFallbacks)].slice(0, 3).join(' | ')})` : ''}`);
      (results[vp.name] ??= {})[8] = r8;
      console.log(`  [${vp.name}] krok 8: ${r8.ok ? 'ok' : 'FAIL'}`);
    }
  } finally {
    try {
      await browser?.close();   // przeglądarka i serwer zawsze się zamykają, także gdy start Chromium albo krok rzucił wyjątek
    } finally {
      stopAll();   // także gdy `close()` odrzuci obietnicę
    }
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const summary = summarize(results, [...STEPS, TIPS_STEP, ...STEPS_4B, QUEUE_STEP]);
  const extraFailures = [];
  if (external.length > 0) extraFailures.push(`zapytania poza localhost: ${external.length}`);
  if (extraFailures.length) summary.ok = false;
  const report = { seconds, summary, results, widths, extras, errors, warnings: [...new Set(warnings)], external, apiBlocked, apiConsole, dialogs, fallbacks: hooks.fallbacks, extraFailures };
  writeFileSync(join(out, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('');
  for (const row of summary.rows) console.log(`${row.size.padEnd(8)} ${String(row.step).padEnd(2)} ${row.status.padEnd(5)} ${row.name}${row.detail ? `  <- ${row.detail}` : ''}`);
  if (extras.obok) console.log(`\nuwaga (krok 2, ${extras.obok.width} px): kartka pinezki „lokal obok” leży pod innymi pinezkami i zachodzi na ${extras.obok.overlaps.length} z nich (${extras.obok.overlaps.map((x) => `${x.kind} #${x.with}: ${x.area} px²`).join(', ') || 'żadną'}), szczegóły w smoke.json`);
  console.log(`\nbłędy konsoli: ${errors.length}, zapytania poza localhost: ${external.length}, przerwane /api/**: ${apiBlocked.length}, ${seconds} s, wynik: ${out}/smoke.json`);
  return summary.ok ? 0 : 1;
}

/** Czy plik uruchomiono bezpośrednio (realpath po obu stronach). */
function isMain() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
