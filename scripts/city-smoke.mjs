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
 *   8. konsola i `pageerror` bez błędów.
 * Do tego jeden przebieg na telefonie z włączonymi dymkami (`tips: true`): `tip-miasto` i `tip-lokal` (Zadanie 14).
 *
 * Bezpieczeństwo: nic nie wychodzi poza `localhost` na porcie smoke'a. Zapytania do `/api/**` są przerywane (smoke niczego nie wysyła
 * do rankingu, ani lokalnego, ani prawdziwego), a każde inne zapytanie poza localhost jest blokowane i liczone. Zapisy gry i metę
 * wstawia skrypt do `localStorage` czystego kontekstu; nic nie trafia do prawdziwej przeglądarki użytkownika.
 *
 * Użycie: `npm run build`, potem `npm run city:smoke` (albo `node scripts/city-smoke.mjs [--only phone|desktop]`). Zrzuty i `smoke.json` idą do
 * `.smoke/city/` (katalog jest w .gitignore); wybrane zrzuty do raportu kopiuje się ręcznie do `docs/superpowers/reports/`.
 * Playwright nie jest zależnością projektu: skrypt bierze go z `PLAYWRIGHT_ROOT` (katalog pakietu `playwright-core`, albo katalog, w którego
 * `node_modules` leży `playwright`), a Chromium z `CITY_SMOKE_CHROMIUM` albo z cache'u Playwrighta (`chromium_headless_shell-*`). Okna przeglądarki
 * nie ma: to czysty headless, bez panelu w aplikacji.
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

/** Domyślne miejsce Playwrighta tego komputera (katalog pakietu `playwright-core`); `PLAYWRIGHT_ROOT` je nadpisuje. */
export const DEFAULT_PLAYWRIGHT_ROOT = '/Users/mpawelczuk/Dev/ochronairz-rotator/node_modules/playwright-core';
/** Flagi Chromium: grafika programowa (swiftshader), bo headless nie ma GPU. */
export const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** Rozmiary okna: telefon z dotykiem i komputer. */
export const VIEWPORTS = [
  { name: 'telefon', size: { width: 390, height: 844 }, mobile: true },
  { name: 'desktop', size: { width: 1280, height: 800 }, mobile: false },
];
/** Fixtures z `src/game/fixtures/`: stary zapis schematu 2 (po dwóch remontach) i zapis schematu 3 tuż przed statusem Partnera. */
export const FIXTURES = {
  stary: 'save-v2-remont2.json',
  przedStatusem: 'save-v3-przed-statusem.json',
};
/** Pamięć samouczka: przelot pominięty, dymki „pierwszy raz” wyłączone (albo włączone w przebiegu z dymkami). */
export const tutorialMemory = (tips) => ({ v: 1, tour: 'skipped', seen: [], tips });
/**
 * Kroki smoke'a (numeracja z Zadania 16) i rozmiary, na których biegną: 6 tylko na komputerze (wypowiedzenie), 7 tylko na telefonie
 * (poziome przewijanie, angielski, FPS). Na pozostałym rozmiarze krok jest „nie dotyczy” i nie liczy się jako porażka.
 */
export const STEPS = [
  { id: 1, name: 'stary zapis: jeden sklep, mapa, karta, „Biorę lokal” zablokowany', sizes: ['telefon', 'desktop'] },
  { id: 2, name: 'fixture przed statusem + skip(30): okno ze statusem Partnera', sizes: ['telefon', 'desktop'] },
  { id: 3, name: 'wynajem, pinezka budowy z licznikiem, okno „Traszka #2 otwarta”', sizes: ['telefon', 'desktop'] },
  { id: 4, name: 'chip: przełączenie na #2 (inny seed sceny) i z powrotem', sizes: ['telefon', 'desktop'] },
  { id: 5, name: 'koniec miesiąca: okno „Sieć” i dwa wyciągi', sizes: ['telefon', 'desktop'] },
  { id: 6, name: 'wypowiedzenie #2: rozliczenie końcowe, jeden sklep', sizes: ['desktop'] },
  { id: 7, name: '390 px: bez poziomego przewijania, zakładki, angielski, FPS warstw', sizes: ['telefon'] },
  { id: 8, name: 'konsola i pageerror bez błędów', sizes: ['telefon', 'desktop'] },
];
/** Dodatkowy przebieg z dymkami miasta (Zadanie 14): tylko telefon. */
export const TIPS_STEP = { id: 'T', name: 'dymki miasta (tip-miasto, tip-lokal) na 390 px', sizes: ['telefon'] };

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
 * Wybór pakietu Playwrighta: `root` bywa katalogiem samego pakietu (`.../node_modules/playwright-core`) albo katalogiem, w którego `node_modules`
 * leży `playwright` lub `playwright-core`. Na końcu pakiet zainstalowany w projekcie. Zwraca moduł z `chromium`, a bez niego rzuca błąd
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
export function summarize(results, steps = [...STEPS, TIPS_STEP]) {
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

/** Argumenty polecenia: `--only telefon|desktop` ogranicza przebieg do jednego rozmiaru (do ponawiania pojedynczej porażki). */
export function parseArgs(argv) {
  const args = { only: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--only') {
      const v = argv[++i];
      const name = VIEWPORTS.find((vp) => vp.name === v || (v === 'phone' && vp.mobile))?.name;
      if (!name) throw new Error(`--only przyjmuje telefon albo desktop, dostałem „${v ?? ''}”`);
      args.only = name;
    } else throw new Error(`nieznany argument „${a}”`);
  }
  return args;
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
        installments: st.econ.franchisee.installments.map((i) => ({ label: i.label, monthly: i.monthly, paid: i.paid })),
      })),
      inbox: f?.inbox.length ?? 0,
    };
  });
}

/** Rząd wolnych lokali z listy Miasta razem z danymi z miasta firmy (cena pakietu, dni budowy). */
function readLots(page) {
  return page.evaluate(() => {
    const f = window.traszkaGame.session.firm;
    return [...document.querySelectorAll('.tt-lotrow')].map((r) => {
      const id = Number(r.dataset.lot);
      const lot = f.city.lots[id];
      return {
        id, price: lot.package, buildDays: lot.buildDays, street: lot.street, number: lot.number, district: lot.district,
        addr: (r.querySelector('.tt-lotaddr')?.firstChild?.textContent ?? '').trim(),
      };
    });
  });
}

/** Czy element `sel` jest na ekranie (ma niepustą ramkę). */
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getBoundingClientRect().height > 0; }, sel);
const textOf = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);

/** Klik z awaryjnym `click()` w DOM: okno, które gra właśnie zamyka, albo baner, który przez chwilę zasłania przycisk, nie wiesza smoke'a. */
async function press(page, sel, timeout = 6_000) {
  try {
    await page.click(sel, { timeout });
  } catch (error) {
    const done = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
    if (!done) throw error;
  }
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
      const kind = cls.contains('tt-deck') ? 'deck' : cls.contains('tt-story') ? 'story' : cls.contains('tt-remanent') ? 'remanent'
        : m.querySelector('h2[data-tut="report"]') ? 'report' : cls.contains('tt-tut-offer') ? 'offer' : cls.contains('tt-center') ? 'welcome' : 'other';
      dialogs.push({ kind, label: m.getAttribute('aria-label') ?? m.querySelector('h2')?.textContent ?? '', text: m.textContent ?? '' });
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
};

/**
 * Zamyka to, co gra otworzyła w międzyczasie (okna modalne pauzują grę i łykają kliknięcia): kartę decyzji („Zatwierdź”), wpis „OK”, protokół
 * remanentu, raport („Dalej”), powitanie („Odbierz!”) i dymki „pierwszy raz” (poza `keepTips`). `stop`: wyrażenie, które zatrzymuje pętlę
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
      await press(page, CLOSE[dialog.kind]);
      closed.push(dialog.label);
      await sleep(dialog.kind === 'deck' ? 250 : 150);
      continue;
    }
    if (w.tip !== null && !keepTips.includes(w.tip)) {
      idle = 0;
      await press(page, '.tt-tip-bubble .tt-tut-next');
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

async function startPreview(port) {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', 'localhost'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return proc;
    } catch { /* jeszcze wstaje */ }
    if (proc.exitCode !== null) break;
    await sleep(200);
  }
  stopPreview(proc);
  throw new Error(`vite preview nie wstał na ${base}: ${log.trim().slice(-300)}`);
}
function stopPreview(proc) {
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill(); } catch { /* już zamknięty */ } }
}

// ——— bieg ———

async function main(argv) {
  const args = parseArgs(argv);
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

  const errors = [];
  const warnings = [];
  const external = [];
  const apiBlocked = [];
  const dialogs = [];
  const results = {};
  const extras = {};

  // --- kontekst i strona ---

  async function newPage(browser, vp, tag, { fixture, tips = false }) {
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
      if (m.type() === 'error') errors.push(`${vp.name}/${tag}: ${m.text()}`);
      else if (m.type() === 'warning') warnings.push(`${vp.name}/${tag}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`${vp.name}/${tag}: pageerror ${e.message}`));
    page.on('dialog', (d) => { dialogs.push(`${vp.name}/${tag}: ${d.type()} ${d.message().slice(0, 80)}`); void d.accept(); });
    await page.goto(`${base}/?seed=${encodeURIComponent(fixture.seed)}&q=niska&debug=1`);
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
  async function checkWidth(page, label) {
    const m = await page.evaluate(() => {
      const r = document.documentElement;
      return { scroll: r.scrollWidth, client: r.clientWidth, body: document.body.scrollWidth, inner: window.innerWidth };
    });
    widths.push({ label, ...m, ok: m.scroll <= PHONE_WIDTH });
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
   * Stuknięcie w kartkę lokalu na mapie, jeśli któryś punkt pinezki leży na wierzchu (etykiety konkurencji i inne pinezki bywają nad nią);
   * false, gdy zasłania ją arkusz, pasek albo inne pinezki w całości.
   */
  async function tapPin(page, lotId) {
    const at = await page.evaluate((id) => {
      const pin = document.querySelector(`.tt-cpin-wolny[data-lot="${id}"]`);
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
          const rata = s2?.installments.find((i) => /^Adaptacja lokalu: ul\. /.test(i.label));
          ev.check(!!rata, `rata pakietu w sklepie #2: ${JSON.stringify(s2?.installments)}`);
          ev.note(`rata pakietu: ${rata?.label}, ${money(rata?.monthly ?? 0)} zł miesięcznie × 12`);
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
          await page.evaluate(() => document.querySelector('.tt-stores-backdrop')?.click());
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
    await press(page, '.tt-lotcard-close');
    await closeTab(page, 'miasto');
    await page.click('[data-tut="store-switch"]');
    await page.waitForSelector('.tt-stores-pop');
    await checkWidth(page, 'angielski: lista sklepów');
    await ev.shot('15-angielski-chip');
    await page.evaluate(() => document.querySelector('.tt-stores-backdrop')?.click());

    const bad = widths.filter((w) => !w.ok);
    ev.check(bad.length === 0, `poziome przewijanie na ekranach: ${bad.map((w) => `${w.label} (${w.scroll} px)`).join(', ')}`);
    ev.note(`pomiary scrollWidth (${widths.length} ekranów): ${widths.map((w) => `${w.label}=${w.scroll}`).join('; ')}`);
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
        ev.check(bad.length === 0, `poziome przewijanie przy dymkach: ${bad.map((w) => w.label).join(', ')}`);
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
  process.on('SIGINT', () => { stopAll(); process.exit(130); });
  let browser = null;
  const started = Date.now();
  try {
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: LAUNCH_ARGS });
    for (const vp of VIEWPORTS) {
      if (args.only && vp.name !== args.only) continue;
      console.log(`${vp.name} (${vp.size.width}×${vp.size.height}${vp.mobile ? ', dotyk' : ''})`);
      try {
        await scenarioOldSave(browser, vp);
        await scenarioFlow(browser, vp);
        if (vp.mobile) await tipsRun(browser, vp);
      } catch (error) {
        console.log(`  [${vp.name}] wyjątek poza krokiem: ${error instanceof Error ? error.stack : String(error)}`);
        const r = (results[vp.name] ??= {});
        r.exception = stepResult({ ok: false, failed: [`wyjątek: ${error instanceof Error ? error.message : String(error)}`] });
      }
      for (const step of [...STEPS, TIPS_STEP]) {
        if (!step.sizes.includes(vp.name)) (results[vp.name] ??= {})[step.id] = stepResult({ na: true, notes: ['nie dotyczy tego rozmiaru'] });
      }
      // 8: konsola i pageerror z całego rozmiaru
      const mine = errors.filter((e) => e.startsWith(`${vp.name}/`));
      const r8 = stepResult();
      if (mine.length > 0) { r8.ok = false; r8.failed.push(`błędy w konsoli: ${mine.length}`); r8.notes.push(...mine.slice(0, 5)); }
      const myApi = apiBlocked.filter((a) => a.startsWith(`${vp.name}/`));
      r8.notes.push(`błędów konsoli i pageerror: ${mine.length}; przerwane zapytania do /api/**: ${myApi.length}${myApi.length ? ` (${[...new Set(myApi)].slice(0, 3).join(', ')})` : ''}`);
      (results[vp.name] ??= {})[8] = r8;
      console.log(`  [${vp.name}] krok 8: ${r8.ok ? 'ok' : 'FAIL'}`);
    }
  } finally {
    await browser?.close();   // przeglądarka i serwer zawsze się zamykają, także gdy start Chromium albo krok rzucił wyjątek
    stopAll();
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const summary = summarize(results);
  const extraFailures = [];
  if (external.length > 0) extraFailures.push(`zapytania poza localhost: ${external.length}`);
  if (extraFailures.length) summary.ok = false;
  const report = { seconds, summary, results, widths, extras, errors, warnings: [...new Set(warnings)], external, apiBlocked, dialogs, extraFailures };
  writeFileSync(join(out, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('');
  for (const row of summary.rows) console.log(`${row.size.padEnd(8)} ${String(row.step).padEnd(2)} ${row.status.padEnd(5)} ${row.name}${row.detail ? `  <- ${row.detail}` : ''}`);
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
