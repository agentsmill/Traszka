#!/usr/bin/env node
/*
 * Smoke samouczka w headless Chromium (spec samouczka, §13): `vite preview` na zbudowanym `dist`, dwa rozmiary okna (390×844 z dotykiem
 * i 1280×800), czysta przeglądarka w każdym scenariuszu. Sprawdza okno wyboru, cały przelot (zrzut każdego kroku i warunek „dymek nie
 * zasłania celu”), „Pomiń” i ponowne uruchomienie z „Jak grać” i z ⚙, słowniczek, dymki „pierwszy raz” (karta, wyciąg) i bieg rankingowy.
 * Konsola ma być czysta, a wszystko poza localhost jest blokowane: smoke niczego nie wysyła do rankingu.
 *
 * Użycie: `npm run build`, potem `node scripts/tutorial-smoke.mjs`. Playwright nie jest zależnością projektu: skrypt bierze go z
 * `node_modules`, a gdy go tam nie ma, z globalnej instalacji (`PLAYWRIGHT_ROOT`, domyślnie `/opt/node-tools/`).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs/superpowers/reports/2026-10-30-samouczek');
const PORT = Number(process.env.SMOKE_PORT ?? 4317);
const BASE = `http://localhost:${PORT}`;

function loadPlaywright() {
  for (const from of [import.meta.url, `${process.env.PLAYWRIGHT_ROOT ?? '/opt/node-tools'}/`]) {
    try { return createRequire(from)('playwright'); } catch { /* następne miejsce */ }
  }
  throw new Error('Nie znalazłem Playwrighta (ustaw PLAYWRIGHT_ROOT).');
}
const { chromium } = loadPlaywright();

const VIEWPORTS = [
  { name: 'telefon', size: { width: 390, height: 844 }, mobile: true },
  { name: 'desktop', size: { width: 1280, height: 800 }, mobile: false },
];
const TASK_CLICK = {
  zakladki: '[data-tut="tab-palety"]',
  reczne: '[data-tut="order-manual"]',
  asystent: '[data-tut="order-auto"]',
  start: '[data-tut="clicker"] .tt-fab',
};

const errors = [];
const warnings = [];
const external = [];
const apiRuns = [];
const failures = [];
const report = { viewports: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { if (!ok) failures.push(what); return ok; };

// --- Serwer -----------------------------------------------------------------------------------------------------------------

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE)).ok) return proc; } catch { /* jeszcze wstaje */ }
    await sleep(200);
  }
  proc.kill();
  throw new Error('vite preview nie wstał');
}

// --- Strona i pomiary ---------------------------------------------------------------------------------------------------------

async function newPage(browser, vp, { debug = false, seed = 'samouczek-1' } = {}) {
  const ctx = await browser.newContext({ viewport: vp.size, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    external.push(url.href);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${vp.name}: ${m.text()}`);
    else if (m.type() === 'warning') warnings.push(`${vp.name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${vp.name}: pageerror ${e.message}`));
  page.on('request', (r) => { if (r.url().includes('/api/runs')) apiRuns.push(`${r.method()} ${r.url()}`); });
  // niska jakość grafiki: swiftshader w kontenerze rysuje scenę na procesorze, a samouczek jest nakładką HTML i od presetu nie zależy
  await page.goto(`${BASE}/?seed=${seed}&q=niska${debug ? '&debug=1' : ''}`);
  return { ctx, page };
}

async function startStore(page, { ranked = false } = {}) {
  await page.waitForSelector('#tt-nick', { timeout: 90_000 });
  await page.fill('#tt-nick', 'Smoke');
  await page.getByRole('button', { name: ranked ? 'Start rankingowy' : 'Otwieramy sklep!', exact: true }).click();
}

const shot = (page, vp, name) => page.screenshot({ path: join(OUT, `${vp.name}-${name}.jpg`), type: 'jpeg', quality: 80, timeout: 120_000 });

/** Stan dymka przelotu (`.tt-tut-bubble`) z prostokątem celu przyciętym do przewijanych przodków, jak w warstwie. */
function readBubble(page, selector = '.tt-tut-bubble:not(.tt-tip-bubble)') {
  return page.evaluate((sel) => {
    const b = document.querySelector(sel);
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
      id: b.dataset.step ?? b.dataset.tip ?? null, target, count: b.querySelector('.tt-tut-count')?.textContent ?? null,
      next: b.querySelector('.tt-tut-next')?.textContent ?? null, covers: b.dataset.covers === 'true', overlaps: !!hit, inView,
      side: [...b.classList].find((c) => c.startsWith('side-'))?.slice(5) ?? null, bubble, targetRect,
    };
  }, selector);
}

/** Ten sam dymek w tym samym miejscu przez `STABLE` kolejnych pomiarów co 300 ms (swiftshader daje kilka klatek na sekundę). */
const STABLE = 4;
const sameBubble = (a, b) => !!a && !!b && a.id === b.id && Math.abs(a.bubble.x - b.bubble.x) < 1 && Math.abs(a.bubble.y - b.bubble.y) < 1
  && Math.abs(a.bubble.h - b.bubble.h) < 1;
async function stableBy(read, timeout) {
  const until = Date.now() + timeout;
  const seen = [];
  while (Date.now() < until) {
    const now = await read();
    seen.push(now);
    const tail = seen.slice(-STABLE);
    if (now && tail.length === STABLE && tail.every((x) => sameBubble(x, now))) return now;
    await sleep(300);
  }
  return null;
}
const stableBubble = (page, timeout = 20_000) => stableBy(() => readBubble(page), timeout);

const speedOn = (page) => page.evaluate(() => document.querySelector('[data-tut="speed"] .tt-btn.on')?.textContent ?? null);
const memory = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('traszka:tutorial') ?? 'null'));
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getBoundingClientRect().height > 0; }, sel);

/** Zamyka to, co gra mogła otworzyć w międzyczasie: kartę decyzji, wpis „OK”, dymek „pierwszy raz”, raport. */
async function settleWindows(page) {
  for (let i = 0; i < 12; i++) {
    if (await visible(page, '.tt-tip-bubble .tt-tut-next')) { await page.click('.tt-tip-bubble .tt-tut-next'); await sleep(150); continue; }
    if (await visible(page, '.tt-deck')) { await page.click('.tt-deck .tt-primary'); await sleep(250); continue; }
    if (await visible(page, '.tt-story')) { await sleep(450); await page.click('.tt-story .tt-primary'); await sleep(150); continue; }
    if (await visible(page, '.tt-remanent')) { await sleep(450); await page.click('.tt-remanent .tt-primary'); await sleep(150); continue; }
    const reportOpen = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /^(Wyciąg od Centrali|Raport)/.test(d.getAttribute('aria-label') ?? '')));
    if (reportOpen) { await page.getByRole('button', { name: 'Dalej', exact: true }).click(); await sleep(150); continue; }
    return;
  }
}

// --- Scenariusze --------------------------------------------------------------------------------------------------------------

/** 1–2: okno wyboru, cały przelot ze zrzutem każdego kroku, koniec z pamięcią „done” i czasem w ruchu. */
async function fullTour(page, vp, out) {
  await page.waitForSelector('[aria-label="Pierwszy dzień w Traszce"]', { timeout: 120_000 });
  await sleep(400);
  await shot(page, vp, '00-okno-wyboru');
  await page.getByRole('button', { name: 'Samouczek (ok. 3 min)', exact: true }).click();
  const steps = [];
  for (let n = 1; n <= 20; n++) {
    let st = await stableBubble(page);
    if (!st) {
      // przelot wstrzymany oknem gry (karta w kroku „start”): gracz je obsługuje, przelot wraca
      await settleWindows(page);
      st = await stableBubble(page);
    }
    if (!check(!!st, `${vp.name}: brak dymka w kroku ${n}`)) break;
    steps.push({ n, id: st.id, side: st.side, target: st.target, covers: st.covers, overlaps: st.overlaps, inView: st.inView });
    check(!st.covers, `${vp.name}: krok ${st.id} ma covers`);
    check(!st.overlaps, `${vp.name}: dymek zasłania cel w kroku ${st.id}`);
    check(st.inView, `${vp.name}: dymek poza oknem w kroku ${st.id}`);
    if (n === 1) check(['1 / 16', '1 / 15'].includes(st.count), `${vp.name}: licznik pierwszego kroku ${st.count}`);
    if (n === 1) check(await speedOn(page) === '❚❚', `${vp.name}: przelot nie zatrzymał czasu`);
    await shot(page, vp, `${String(n).padStart(2, '0')}-${st.id}`);
    if (st.next === 'Zakończ') { await page.click('.tt-tut-next'); break; }
    if (st.next === 'Dalej') await page.click('.tt-tut-next');
    else await page.click(TASK_CLICK[st.id]);
    // następny krok: inny licznik albo przelot wstrzymany oknem
    const before = st.count;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      const now = await readBubble(page);
      if (!now || now.count !== before) break;
    }
  }
  out.steps = steps;
  await sleep(300);
  check(!(await visible(page, '.tt-tut-layer')), `${vp.name}: warstwa przelotu została po „Zakończ”`);
  const mem = await memory(page);
  check(mem?.tour === 'done', `${vp.name}: pamięć po przelocie ${JSON.stringify(mem)}`);
  const speed = await speedOn(page);
  check(speed && speed !== '❚❚', `${vp.name}: czas stoi po przelocie (${speed})`);
  check(steps.at(-1)?.id === 'pomoc', `${vp.name}: ostatni krok to ${steps.at(-1)?.id}, nie „?”`);
  out.afterTour = { memory: mem, speed };
}

/** 8: słowniczek w „Jak grać”. */
async function glossary(page, vp, out) {
  await settleWindows(page);
  await page.click('[data-tut="help"]');
  await page.waitForSelector('.tt-howto');
  await page.click('.tt-glossary summary');
  await page.evaluate(() => document.querySelector('.tt-glossary')?.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await shot(page, vp, '30-slowniczek');
  out.glossary = await page.evaluate(() => [...document.querySelectorAll('.tt-glossary dt')].map((d) => d.textContent));
  check(out.glossary.length === 9, `${vp.name}: słowniczek ma ${out.glossary.length} haseł`);
  await page.getByRole('button', { name: 'Zaczynamy', exact: true }).click();
}

/** 3–4: ponowne uruchomienie z „Jak grać” i z ⚙, „Pomiń” wraca do prędkości sprzed startu. */
async function relaunch(page, vp, out, from) {
  await settleWindows(page);
  const before = await speedOn(page);
  if (from === 'help') {
    await page.click('[data-tut="help"]');
    await page.waitForSelector('.tt-howto');
    await page.locator('.tt-howto').getByRole('button', { name: 'Samouczek', exact: true }).click();
  } else {
    await page.click('.tt-gear');
    await page.waitForSelector('[role="dialog"][aria-label="Ustawienia"]');
    await page.locator('[aria-label="Ustawienia"]').getByRole('button', { name: 'Samouczek', exact: true }).click();
  }
  const st = await stableBubble(page);
  check(st?.id === 'cel', `${vp.name}: ponowny start z ${from} zaczyna od ${st?.id}`);
  check(await speedOn(page) === '❚❚', `${vp.name}: ponowny start z ${from} nie zatrzymał czasu`);
  await shot(page, vp, `4${from === 'help' ? 1 : 2}-ponownie-${from === 'help' ? 'jak-grac' : 'ustawienia'}`);
  await page.locator('.tt-tut-bubble').getByRole('button', { name: 'Pomiń', exact: true }).click();
  await sleep(200);
  check(!(await visible(page, '.tt-tut-layer')), `${vp.name}: warstwa została po „Pomiń” (${from})`);
  const after = await speedOn(page);
  check(after === before, `${vp.name}: po „Pomiń” prędkość ${after}, a przed ${before} (${from})`);
  out[`relaunch_${from}`] = { before, after };
}

/** 5: „Pomiń, znam grę” w oknie wyboru. */
async function skipOffer(browser, vp, out) {
  const { ctx, page } = await newPage(browser, vp, { seed: 'samouczek-2' });
  await startStore(page);
  await page.waitForSelector('[aria-label="Pierwszy dzień w Traszce"]', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Pomiń, znam grę', exact: true }).click();
  await sleep(500);
  check(!(await visible(page, '.tt-tut-layer')), `${vp.name}: „Pomiń, znam grę” uruchomiło przelot`);
  const mem = await memory(page);
  check(mem?.tour === 'skipped', `${vp.name}: pamięć po „Pomiń, znam grę” ${JSON.stringify(mem)}`);
  check(await speedOn(page) === '×1', `${vp.name}: po „Pomiń, znam grę” czas nie idzie`);
  await shot(page, vp, '50-pominiete');
  out.skipOffer = { memory: mem };
  await ctx.close();
}

/** 6: dymki „pierwszy raz”: pierwsza karta i pierwszy wyciąg od Centrali. */
async function firstTimeTips(browser, vp, out) {
  const { ctx, page } = await newPage(browser, vp, { debug: true, seed: 'samouczek-3' });
  await startStore(page);
  await page.waitForSelector('[aria-label="Pierwszy dzień w Traszce"]', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Pomiń, znam grę', exact: true }).click();
  await page.click('[data-tut="speed"] .tt-btn');   // pauza: czas przesuwa tylko `skip`
  const tips = {};
  for (let i = 0; i < 60 && !(await visible(page, '.tt-deck')); i++) await page.evaluate(() => window.traszkaGame.skip(60));
  const card = await stableTip(page, 'tip-karta');
  if (check(!!card, `${vp.name}: brak dymka przy pierwszej karcie`)) {
    tips.karta = card;
    check(!card.overlaps && !card.covers && card.inView, `${vp.name}: dymek karty zasłania kartę albo wychodzi poza okno`);
    await shot(page, vp, '60-dymek-karta');
  }
  for (let step = 0; step < 400; step++) {
    const reportOpen = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.getAttribute('aria-label') ?? '').startsWith('Wyciąg od Centrali')));
    if (reportOpen) break;
    if (await visible(page, '.tt-tip-bubble .tt-tut-next')) { await page.click('.tt-tip-bubble .tt-tut-next'); continue; }
    if (await visible(page, '.tt-deck')) { await page.click('.tt-deck .tt-primary'); await sleep(100); continue; }
    if (await visible(page, '.tt-story')) { await sleep(450); await page.click('.tt-story .tt-primary'); continue; }
    await page.evaluate(() => window.traszkaGame.skip(1440));
    await sleep(100);
  }
  const statement = await stableTip(page, 'tip-wyciag');
  if (check(!!statement, `${vp.name}: brak dymka przy pierwszym wyciągu`)) {
    tips.wyciag = statement;
    check(!statement.overlaps && !statement.covers && statement.inView, `${vp.name}: dymek wyciągu zasłania „Zostaje Ci” albo wychodzi poza okno`);
    await shot(page, vp, '61-dymek-wyciag');
  }
  out.tips = tips;
  await ctx.close();
}

const stableTip = (page, id, timeout = 20_000) => stableBy(() => readBubble(page, `.tt-tip-bubble[data-tip="${id}"]`), timeout);

/** 7: start rankingowy niczego nie otwiera, a „Samouczek” w biegu daje tylko komunikat. */
async function rankedRun(browser, vp, out) {
  const { ctx, page } = await newPage(browser, vp, { seed: 'samouczek-4' });
  await startStore(page, { ranked: true });
  await page.waitForSelector('[data-tut="help"]', { timeout: 120_000 });
  await sleep(1500);
  const offer = await visible(page, '[aria-label="Pierwszy dzień w Traszce"]');
  const howTo = await visible(page, '.tt-howto');
  check(!offer, `${vp.name}: okno wyboru w biegu rankingowym`);
  check(!howTo, `${vp.name}: „Jak grać” otworzyło się samo przy starcie rankingowym`);
  await settleWindows(page);
  await page.click('[data-tut="help"]');
  await page.locator('.tt-howto').getByRole('button', { name: 'Samouczek', exact: true }).click();
  await sleep(300);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.tt-toast')].map((t) => t.textContent));
  check(toast.includes('Samouczek działa w zwykłym sklepie.'), `${vp.name}: brak komunikatu w biegu rankingowym (${toast.join(' | ')})`);
  check(!(await visible(page, '.tt-tut-layer')), `${vp.name}: przelot ruszył w biegu rankingowym`);
  await shot(page, vp, '70-ranking-komunikat');
  out.ranked = { offer, howTo, toast };
  await ctx.close();
}

// --- Bieg ------------------------------------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const started = Date.now();
try {
  for (const vp of VIEWPORTS) {
    const out = (report.viewports[vp.name] = {});
    const { ctx, page } = await newPage(browser, vp);
    await startStore(page);
    await fullTour(page, vp, out);
    await glossary(page, vp, out);
    await relaunch(page, vp, out, 'help');
    await relaunch(page, vp, out, 'settings');
    await ctx.close();
    await skipOffer(browser, vp, out);
    await firstTimeTips(browser, vp, out);
    await rankedRun(browser, vp, out);
  }
} catch (error) {
  failures.push(`wyjątek: ${error.stack ?? error}`);
} finally {
  await browser.close();
  server.kill();
}
check(errors.length === 0, `błędy w konsoli: ${errors.length}`);
check(apiRuns.length === 0, `zapytania do /api/runs: ${apiRuns.length}`);
check(!external.some((u) => u.includes('vercel.app')), 'zapytanie do *.vercel.app');
Object.assign(report, { seconds: Math.round((Date.now() - started) / 1000), errors, warnings: [...new Set(warnings)], external, apiRuns, failures });
writeFileSync(join(OUT, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ failures, errors, external: external.length, apiRuns, seconds: report.seconds }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
