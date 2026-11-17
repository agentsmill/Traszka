# Etap 5a: plan sprzedaży Centrali — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** od czwartego miesiąca umowy każdy sklep dostaje miesięczny plan sprzedaży, który rośnie z wykonaniem, karze za wpadki i po
trzech z rzędu odbiera placówkę, tak żeby gracz z gotówką znów miał o co grać.

**Architecture:** liczby i reguły żyją w nowym czystym module `src/sim/economy/plan.ts`. Stan planu to opcjonalny blok
`EconomyState.franchisee.plan`, który powstaje dopiero po sezonie rankingowym, więc bieg rankingowy i `GOLDEN[7]` zostają co do bajta.
Ekonomia sklepu (`economy.ts`) rozlicza plan przy zamknięciu miesiąca; firma (`src/sim/firm`) zamyka sklep z powodu planu i przyjmuje
polecenie przełącznika dobicia; interfejs pokazuje plan w pasku prognozy, podglądzie miesiąca, raporcie i zakładce Miasto.

**Tech Stack:** TypeScript 7, Vitest 5, Preact 11 + signals, Vite 8, headless Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-11-13-etap-5a-plan-centrali-design.md` (dalej „spec”; §-y odnoszą się do niego).
Kod bazowy: `main` 6e692b7. Praca w gałęzi `claude/plan-centrali-5a`, worktree `../ZabkaTycone-wt/plan-centrali-5a`.

## Global Constraints

- Kolejność bramek: `npm run build` (build:judge + tsc + vite build) **przed** `npm test`.
- `src/sim` bez `Math.random`, `Date`, `Math.hypot` i `**`.
- Sędzia nie importuje `src/sim/city` ani `src/sim/firm` (`tests/architecture.test.ts`).
- **Neutralność:** sklep bez bloku `franchisee.plan` daje stan co do bajta jak dziś. Żadne nowe pole nie pojawia się w stanie, wyciągu
  ani raporcie, dopóki plan nie działa (pola opcjonalne, dopisywane tylko z wartością). `tests/simGolden.test.ts` przechodzi **bez zmian
  w `GOLDEN`**, `SIM_VERSION` zostaje 7, `COMMAND_TYPES` bez nowych wpisów. Jeśli któryś task nie umie tego utrzymać, zatrzymuje się
  i zgłasza to koordynatorowi zamiast podbijać wersję.
- `FIRM_SAVE_SCHEMA` zostaje 4 (blok planu to opcjonalne pole wewnątrz `econ.franchisee`, a nie zmiana koperty). Wczytują się wszystkie
  pliki `src/game/fixtures/*.json`. Paczka „Wyślij zapis” ≤ 65 536 B, próg testu najgorszego przypadku 62 000 B bez zmian.
- Kwoty planu w stanie to pełne złote (zaokrąglone), żeby zapis był krótki.
- i18n: każdy nowy polski napis ma wersję angielską w `src/i18n/en/*`; `tests/i18n.test.ts` przechodzi.
- Każda kara jest widoczna wcześniej: w `forecastMonth` i w podglądzie miesiąca (spec §2, anty-cele).
- Satyra na fikcyjną Traszkę: żadnych twierdzeń o prawdziwych sieciach w grze, repo i commitach.
- Smoke tylko headless: `PLAYWRIGHT_ROOT=/Users/mpawelczuk/Dev/ochronairz-rotator/node_modules/playwright-core npm run city:smoke`,
  `locale: 'pl-PL'`, zawsze `page.route('**/api/**', r => r.abort())`, nic nie idzie na produkcję.
- Commity po polsku w stylu repo (`feat(…)`, `fix(…)`, `test(…)`), zakończone linią
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Nic nie wypychamy bez zgody właściciela.

## Rozstrzygnięcia planu (dopisane też do specu)

- `Ruling: polecenie przełącznika dobicia jest poleceniem firmy, nie sklepu — nowy typ w `COMMAND_TYPES` musiałby trafić do dziennika złotego biegu i zmieniać jego wynik (`tests/simGolden.test.ts`), a w sezonie rankingowym plan nie działa — koszt pomyłki: brak.`
- `Ruling: blok planu powstaje wieczorem pierwszego dnia czwartego miesiąca (zamknięcie dnia), nie przy zamknięciu trzeciego — trzecie zamknięcie miesiąca wypada minutę przed końcem sezonu, więc nowy blok zmieniłby skrót stanu i wymusił reset rankingu — koszt: pierwszy plan stan zna od wieczora dnia 1; interfejs pokazuje go od rana z czystej funkcji `firstPlanPreview`.`
- `Ruling: komunikat „Brakuje X zł do planu” wychodzi przy zamknięciu przedostatniego dnia miesiąca, nie rano ostatniego — zamknięcie dnia to istniejący zaczep dzienny; gracz widzi go przed ostatnim dniem tak samo — koszt: prognoza nie zna ostatniej nocy (nic się w niej nie dzieje).`
- `Ruling: miesiąc, w którym sklep nie miał ani jednego dnia otwartego, nie jest rozliczany (plan, seria i stopień bez zmian) — dzielenie przez zero dni i kara za remont byłyby niesprawiedliwe — koszt: remont przez granicę miesiąca daje miesiąc oddechu.`
- `Ruling: stopień 3 nie ma kary pieniężnej — karą jest utrata placówki i rozliczenie końcowe — koszt: brak.`

## Review Focus

1. Remont przez cały miesiąc albo przez granicę miesiąca: 0 dni otwartych nie daje ani kary, ani `NaN` w planie (Task 1, test „zero dni”).
2. Sklep wynajęty ponownie „po Traszce”: nie dziedziczy stopnia ani serii po poprzedniej umowie, pierwszy miesiąc jest bez planu (Task 3).
3. Stary zapis wczytany w środku miesiąca z długą historią: pierwszy miesiąc bez rozliczenia, plan od następnego (Task 2, test migracji).
4. Dwa sklepy zamykają miesiąc w tej samej minucie z włączonym dobiciem: drugi widzi portfel po dobiciu pierwszego i nie schodzi poniżej
   `DEBT_WARN` (Task 3).
5. Zaufanie 0 i stopień 3 planu przy tym samym zamknięciu: jedno zdarzenie `gameover`, sklep zamknięty raz, powód `trust` (Task 2 i 3).

---

### Task 1: Czysty moduł planu — model: sonnet

**Files:**
- Create: `src/sim/economy/plan.ts`
- Test: `src/sim/economy/plan.test.ts`

**Interfaces:**
- Consumes: `roundNice(n)` z `./tycoon/time`, `dateOfDay(day)` i `isLastDayOfMonth(day)` z `./calendar`, `GUARANTEE` z `./catalog`,
  `isRec`, `num`, `whole` z `@/sim/guards`.
- Produces:

```ts
export const PLAN = {
  startMonths: 3,          // = GUARANTEE.months; plan od czwartego miesiąca umowy
  recentMonths: 3,
  baseFloor: 0.95,         // baza nie spada szybciej niż o 5% miesięcznie
  growthBase: 0.02, growthPerHit: 0.005, growthMax: 0.05,
  bonusShare: 0.01,        // premia za trafienie: 1% obrotu miesiąca
  trustHit: 2, trustMiss: -2,
  fineShare: [0, 0.10, 0.20, 0] as readonly number[],   // indeks = stopień po wpadce
  stageMax: 3,
  topUpFrom: 0.9, topUpCost: 0.83,
  noticeFrom: 0.9,
} as const;

export interface PlanState {
  target: number;      // plan miesiąca w zł; 0 = miesiąc zapowiedzi, bez rozliczenia
  base: number;        // baza dzienna obecnego planu (zł)
  recent: number[];    // dzienny obrót do planu z ostatnich ≤3 zamkniętych miesięcy, od najstarszego
  streak: number;      // trafienia z rzędu
  stage: number;       // 0–3
  openDays: number;    // dni otwarte w bieżącym miesiącu
  topUp: boolean;      // przełącznik „dobij z własnej kieszeni”
}

export interface PlanMonth {   // wynik rozliczenia, trafia do raportu miesiąca
  target: number; due: number; turnover: number; bought: number; cost: number; share: number;
  hit: boolean; bonus: number; fine: number; trust: number;
  stage: number; streak: number; nextTarget: number; nextBase: number; nextGrowth: number;
}

export type PlanVerdict = 'hit' | 'topup' | 'miss';
export interface PlanOutlook {
  target: number; due: number; done: number; share: number; forecastShare: number;
  verdict: PlanVerdict; fine: number; cost: number; stage: number; stageAfter: number; streak: number; topUp: boolean;
}

export function monthLength(day: number): number;                       // dni miesiąca, w którym leży `day`
export function planGrowth(streak: number): number;
export function planBase(recent: readonly number[], prevBase: number): number;
export function planTarget(base: number, days: number, streak: number): number;
export function dailyFromHistory(history: readonly { revenue: number }[], day: number): number[];
export function firstPlanPreview(history: readonly { revenue: number }[], day: number): number | null;
export function createPlan(history: readonly { revenue: number }[], day: number): PlanState;
export function planDue(p: PlanState, monthDays: number): number;
export function settlePlan(p: PlanState, i: { revenue: number; monthDays: number; nextMonthDays: number; cash: number; debtWarn: number }): PlanMonth | null;
export function rollPlan(p: PlanState, history: readonly { revenue: number }[], day: number): void;
export function planOutlook(p: PlanState, i: { revenue: number; forecastRevenue: number; monthDays: number; openDaysAhead: number; cash: number; debtWarn: number }): PlanOutlook | null;
export const planTerminates: (p: PlanState | undefined) => boolean;     // stage >= PLAN.stageMax
export function sanitizePlan(raw: unknown): PlanState | undefined;
```

Reguły, których sygnatury nie mówią:
- `planGrowth(k) = min(growthMax, growthBase + growthPerHit × k)`.
- `planBase = max(średnia z recent, baseFloor × prevBase)`, zaokrąglone do złotówki; pusta `recent` daje `prevBase`.
- `planTarget = roundNice(base × days × (1 + planGrowth(streak)))`.
- `dailyFromHistory(history, day)`: ostatnie ≤3 wpisy historii; dla każdego `revenue / długość miesiąca kalendarzowego`, licząc miesiące
  wstecz od miesiąca poprzedzającego ten, w którym leży `day`; zaokrąglone do złotówki.
- `firstPlanPreview`: gdy `history.length === PLAN.startMonths`, plan na miesiąc dnia `day` liczony jak w `createPlan`; inaczej `null`.
- `createPlan`: `recent = dailyFromHistory`, `base = planBase(recent, 0)`, `streak 0`, `stage 0`, `openDays 0`, `topUp false`. `target` jest
  dodatni tylko wtedy, gdy `history.length === PLAN.startMonths` i `day` to pierwszy dzień miesiąca; w każdym innym przypadku 0.
- `planDue`: pełny `target`, gdy `openDays >= monthDays`; inaczej `round(target × openDays / monthDays)`.
- `settlePlan` zmienia `p` i zwraca wynik; zwraca `null` (bez zmian w `p` poza `openDays = 0`), gdy `target === 0` albo `openDays === 0`.
  Kolejność: `due`, `share = revenue / due`; dobicie, gdy `topUp`, `topUpFrom ≤ share < 1` i `cash − cost ≥ debtWarn`, gdzie
  `bought = due − revenue`, `cost = round(bought × topUpCost)`; trafienie (`share ≥ 1` albo dobicie): `streak + 1`, `stage − 1` (nie niżej 0),
  `bonus = round(bonusShare × revenue)` tylko bez dobicia, `trust = trustHit`; wpadka: `streak = 0`, `stage + 1`,
  `fine = round(fineShare[stage po zmianie] × (due − revenue))`, `trust = trustMiss`. Potem `recent` dostaje
  `round((revenue + bought) / openDays)` (zostają 3 ostatnie), `base = planBase(recent, base)`,
  `target = planTarget(base, nextMonthDays, streak)`, `openDays = 0`.
- `rollPlan` (miesiąc zapowiedzi): `recent = dailyFromHistory(history, day + 1)` z historią, która ma już zamykany miesiąc,
  `base = planBase(recent, 0)`, `target = planTarget(base, monthLength(day + 1), 0)`, `openDays = 0`.
- `planOutlook`: `null` przy `target === 0`. `due` liczone z `openDays + openDaysAhead`; `verdict` z `forecastShare` tymi samymi progami
  co `settlePlan`; `fine` i `cost` tak, jak wyszłyby przy takim wykonaniu; `stageAfter` po rozliczeniu.
- `sanitizePlan`: `undefined` dla nie-rekordu; liczby przycięte (`target`, `base` ≥ 0; z `recent` zostają same liczby ≥ 0, ostatnie 3; `streak` 0–1000;
  `stage` 0–3; `openDays` 0–31); kolejność kluczy jak w `PlanState`.

- [ ] **Step 1: Testy (czerwone).** W `plan.test.ts`:

```ts
it('wzrost: 2% bez serii, +0,5 pp za trafienie, sufit 5%', () => {
  expect(planGrowth(0)).toBeCloseTo(0.02); expect(planGrowth(3)).toBeCloseTo(0.035); expect(planGrowth(40)).toBeCloseTo(0.05);
});
it('baza: średnia z trzech miesięcy, ale nie mniej niż 95% poprzedniej', () => {
  expect(planBase([10_000, 11_000, 12_000], 0)).toBe(11_000);
  expect(planBase([5_000, 5_000, 5_000], 10_000)).toBe(9_500);
});
it('pierwszy plan: aktywny tylko pierwszego dnia czwartego miesiąca', () => {
  const h = [{ revenue: 300_000 }, { revenue: 310_000 }, { revenue: 300_000 }];   // wrzesień, październik, listopad
  expect(createPlan(h, 91).target).toBeGreaterThan(0);        // 1 grudnia
  expect(createPlan(h, 95).target).toBe(0);                   // zapis wczytany w środku miesiąca
  expect(createPlan([...h, { revenue: 1 }], 121).target).toBe(0);   // dłuższa historia = stary zapis
  expect(firstPlanPreview(h, 91)).toBe(createPlan(h, 91).target);
});
it('trafienie: premia 1% obrotu, seria +1, stopień w dół', () => {
  const p: PlanState = { target: 400_000, base: 12_900, recent: [12_000, 12_500, 13_000], streak: 2, stage: 1, openDays: 31, topUp: false };
  const r = settlePlan(p, { revenue: 410_000, monthDays: 31, nextMonthDays: 30, cash: 0, debtWarn: -50_000 })!;
  expect(r).toMatchObject({ hit: true, bonus: 4_100, fine: 0, trust: 2, stage: 0, streak: 3, bought: 0 });
  expect(p.openDays).toBe(0); expect(p.target).toBe(r.nextTarget);
});
it('wpadki: 10% i 20% brakującego obrotu, trzecia kończy umowę bez kary', () => {
  const p: PlanState = { target: 400_000, base: 12_900, recent: [], streak: 5, stage: 0, openDays: 30, topUp: false };
  const i = { revenue: 300_000, monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: -50_000 };
  expect(settlePlan(p, i)).toMatchObject({ hit: false, fine: 10_000, stage: 1, streak: 0, trust: -2 });
  p.target = 400_000; p.openDays = 30;
  expect(settlePlan(p, i)).toMatchObject({ fine: 20_000, stage: 2 });
  p.target = 400_000; p.openDays = 30;
  expect(settlePlan(p, i)).toMatchObject({ fine: 0, stage: 3 });
  expect(planTerminates(p)).toBe(true);
});
it('baza po wpadce spada najwyżej o 5%', () => {
  const p: PlanState = { target: 400_000, base: 13_000, recent: [13_000, 13_000, 13_000], streak: 0, stage: 0, openDays: 30, topUp: false };
  settlePlan(p, { revenue: 30_000, monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: -50_000 });
  expect(p.base).toBe(12_350);
});
it('dobicie: 92% wykonania i włączony przełącznik = trafienie bez premii, koszt 83% brakującego obrotu', () => {
  const p: PlanState = { target: 400_000, base: 12_900, recent: [], streak: 0, stage: 1, openDays: 30, topUp: true };
  const r = settlePlan(p, { revenue: 368_000, monthDays: 30, nextMonthDays: 30, cash: 100_000, debtWarn: -50_000 })!;
  expect(r).toMatchObject({ hit: true, bought: 32_000, cost: 26_560, bonus: 0, stage: 0, streak: 1 });
  expect(p.recent.at(-1)).toBe(Math.round(400_000 / 30));     // dokupiony obrót podnosi bazę
});
it('dobicia nie ma poniżej 90%, przy wyłączonym przełączniku i gdy portfel spadłby poniżej progu ostrzeżenia', () => {
  const mk = (topUp: boolean): PlanState => ({ target: 400_000, base: 12_900, recent: [], streak: 0, stage: 0, openDays: 30, topUp });
  const i = { monthDays: 30, nextMonthDays: 30, debtWarn: -50_000 };
  expect(settlePlan(mk(true), { ...i, revenue: 350_000, cash: 1e6 })!.hit).toBe(false);
  expect(settlePlan(mk(false), { ...i, revenue: 380_000, cash: 1e6 })!.hit).toBe(false);
  expect(settlePlan(mk(true), { ...i, revenue: 380_000, cash: -40_000 })!.hit).toBe(false);
});
it('remont: plan proporcjonalny do dni otwartych, zero dni = brak rozliczenia', () => {
  const p: PlanState = { target: 300_000, base: 10_000, recent: [10_000], streak: 1, stage: 1, openDays: 24, topUp: false };
  expect(planDue(p, 30)).toBe(240_000);
  p.openDays = 0;
  expect(settlePlan(p, { revenue: 0, monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: 0 })).toBeNull();
  expect(p).toMatchObject({ target: 300_000, stage: 1, streak: 1 });
});
it('miesiąc zapowiedzi: bez rozliczenia, potem plan z historii', () => {
  const h = [{ revenue: 300_000 }, { revenue: 310_000 }, { revenue: 300_000 }, { revenue: 310_000 }];
  const p = createPlan(h.slice(0, 3), 95);
  expect(settlePlan(p, { revenue: 1, monthDays: 31, nextMonthDays: 31, cash: 0, debtWarn: 0 })).toBeNull();
  rollPlan(p, h, 121);                                         // 31 grudnia
  expect(p.target).toBeGreaterThan(0); expect(Number.isFinite(p.base)).toBe(true);
});
it('prognoza mówi to samo, co rozliczenie', () => {
  const p: PlanState = { target: 400_000, base: 12_900, recent: [], streak: 0, stage: 1, openDays: 20, topUp: false };
  const o = planOutlook(p, { revenue: 200_000, forecastRevenue: 300_000, monthDays: 30, openDaysAhead: 10, cash: 0, debtWarn: -50_000 })!;
  expect(o).toMatchObject({ verdict: 'miss', fine: 20_000, stage: 1, stageAfter: 2 });
});
it('zapis: śmieci nie przechodzą, poprawny blok wraca bajt w bajt', () => {
  expect(sanitizePlan(null)).toBeUndefined();
  expect(sanitizePlan({ target: NaN, stage: 9, recent: [1, 2, 3, 4, 'x'] })).toMatchObject({ target: 0, stage: 3, recent: [2, 3, 4] });
  const p: PlanState = { target: 400_000, base: 12_900, recent: [1, 2, 3], streak: 2, stage: 1, openDays: 7, topUp: true };
  expect(JSON.stringify(sanitizePlan(JSON.parse(JSON.stringify(p))))).toBe(JSON.stringify(p));
});
```

- [ ] **Step 2:** `npx vitest run src/sim/economy/plan.test.ts` → FAIL (brak modułu).
- [ ] **Step 3:** Zaimplementuj `plan.ts` według bloku Interfaces i reguł powyżej. Bez importu `economy.ts` (moduł ma być liściem).
- [ ] **Step 4:** `npx vitest run src/sim/economy/plan.test.ts` → PASS; `npx vitest run tests/architecture.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(sim): czysty moduł planu sprzedaży Centrali (zapadka, drabina, dobicie)`.

### Task 2: Plan w ekonomii sklepu — model: opus

**Files:**
- Modify: `src/sim/economy/franchisee.ts` (`FranchiseeState.plan?`, `Statement.plan?`, `StatementInput.plan?`, `buildStatement`, `sanitizeFranchisee`, `sanitizeStatement`)
- Modify: `src/sim/economy/economy.ts` (`MonthReport.plan?`, `EconEventKind` + `'plan'`, `closeDay`, `closeMonth`, `cardContext`)
- Modify: `src/sim/economy/sanitize.ts` (raport z zapisu zachowuje `plan`)
- Modify: `src/sim/economy/tycoon/trust.ts` (przyczyna `plan` w `TRUST_REASONS` i `TRUST_REASON_LABEL`: „Plan Centrali”)
- Modify: `src/sim/economy/tycoon/cards.ts` (`CardContext.planStage?`), `src/sim/economy/tycoon/deck.ts:190` (waga audytu)
- Modify: `src/sim/economy/tycoon/notices.ts` (`plan: 'story'`)
- Modify: `src/sim/economy/monthPreview.ts` (`gameOver: 'debt' | 'trust' | 'plan' | null`, `gameOverReason`)
- Test: `src/sim/economy/planEconomy.test.ts`

**Interfaces:**
- Consumes: wszystko z Task 1.
- Produces:
  - `FranchiseeState.plan?: PlanState` (klucza nie ma, dopóki plan nie powstał).
  - `Statement.plan?: number` (kara; klucz tylko przy karze > 0) wliczona do `deductions`.
  - `MonthReport.plan?: PlanMonth` (klucz tylko w miesiącu z rozliczeniem).
  - `EconEvent` rodzaju `'plan'` z polem `plan?: { reason: 'start' | 'announce' | 'short'; target?: number; missing?: number; cost?: number; fine?: number }`
    (tekst po polsku w `text`, jak inne zdarzenia).
  - `export const planOf = (s: EconomyState): PlanState | undefined => s.franchisee.plan;`
  - `export const PLAN_GAMEOVER_TEXT = 'Centrala wypowiada umowę franczyzową: trzeci miesiąc z rzędu bez planu sprzedaży. Dziękujemy za współpracę.';`

Zachowanie:
- `closeDay`, po komunikacie dnia i przed `closeMonth`:
  - brak bloku i `s.history.length >= PLAN.startMonths` → `f.plan = createPlan(s.history, day)`; zdarzenie `'plan'` z `reason: 'start'`
    (plan aktywny) albo `'announce'` (plan od przyszłego miesiąca);
  - potem, także w zamknięciu, które właśnie utworzyło blok: przy `target > 0` → `openDays += 1`, chyba że `isClosedForRemont(s)`
    w chwili zamknięcia dnia;
  - dzień przedostatni w miesiącu, `target > 0`: prognoza liniowa `obrót miesiąca × (openDays + 1) / openDays`; gdy wykonanie wychodzi
    w przedziale `[PLAN.noticeFrom, 1)`, zdarzenie `'plan'` z `reason: 'short'`, kwotą braku, kosztem dobicia i karą.
- `closeMonth`:
  - stopień sprzed rozliczenia ≥ 2 → premia od obrotu (`turnoverBonusShare`) nie jest naliczana;
  - `settlePlan` (albo `rollPlan` w miesiącu zapowiedzi) przed `buildStatement`, z `cash: s.cash`, `debtWarn: DEBT_WARN`;
  - koszt dobicia: `charge(s, 'other', cost, 'month')`; premia: `bonus(s, r.bonus, 'month')`; kara: `StatementInput.plan`;
    zaufanie: `changeTrust(s, 'plan', r.trust, out)` przed `closeTrustMonth`;
  - `report.plan = r` tylko gdy było rozliczenie;
  - po sprawdzeniu zaufania: `planTerminates(f.plan)` i gra jeszcze trwa → `s.gameOver = true` i `gameover` z `PLAN_GAMEOVER_TEXT`.
    Zaufanie 0 ma pierwszeństwo: przy obu naraz wychodzi tylko komunikat o zaufaniu.
- `cardContext` dopisuje `planStage` tylko przy bloku z `target > 0`; waga audytu w talii:
  `0.6 * auditWeight(c.trust) * (c.planStage !== undefined && c.planStage >= 2 ? 2 : 1)`.
- `gameOverReason`: `debt`, potem `trust`, potem `plan`.

- [ ] **Step 1: Testy (czerwone)** w `planEconomy.test.ts`. Pomocnik w pliku: `runTo(s, info, minute)` przewija `stepMinute` z odpowiedzią
  domyślną na karty (wzór: `tests/firmKit.ts` i `tests/simGolden.test.ts`). Bieg ze `freshRun('kiełbasa-42')`.

```ts
it('neutralność: przez trzy miesiące w stanie nie ma klucza plan ani w wyciągu, ani w raporcie', () => {
  runTo(s, info, RANKED_SEASON_END_MINUTE);
  expect('plan' in s.franchisee).toBe(false);
  expect('plan' in s.lastReport!).toBe(false);
  expect('plan' in s.lastReport!.statement!).toBe(false);
});
it('pierwszy plan powstaje wieczorem 1 grudnia i jest równy podglądowi z rana', () => {
  runTo(s, info, 91 * DAY + OPEN_FROM);
  const preview = firstPlanPreview(s.history, 91);
  const events = runTo(s, info, 92 * DAY);
  expect(s.franchisee.plan!.target).toBe(preview);
  expect(s.franchisee.plan!.openDays).toBe(1);
  expect(events.filter((e) => e.kind === 'plan' && e.plan?.reason === 'start')).toHaveLength(1);
});
it('trafiony grudzień: premia na saldzie, raport z planem, nowy plan na styczeń', () => {
  runTo(s, info, 92 * DAY); s.franchisee.plan!.target = 1_000;                       // plan nie do chybienia
  runTo(s, info, 122 * DAY);
  expect(s.lastReport!.plan).toMatchObject({ hit: true, stage: 0, streak: 1 });
  expect(s.lastReport!.plan!.bonus).toBe(Math.round(0.01 * s.lastReport!.counters.revenue));
  expect('plan' in s.lastReport!.statement!).toBe(false);
  expect(s.franchisee.plan!.target).toBe(s.lastReport!.plan!.nextTarget);
});
it('wpadka: kara w potrąceniach wyciągu, zaufanie z przyczyną „plan”, stopień 1', () => {
  runTo(s, info, 92 * DAY); s.franchisee.plan!.target = 100_000_000;
  runTo(s, info, 122 * DAY);
  const st = s.lastReport!.statement!;
  expect(st.plan).toBe(s.lastReport!.plan!.fine);
  expect(st.deductions).toBe(st.installments + st.pallets + st.remanent + st.plan!);
  expect(s.lastReport!.detail!.trust.reasons.some(([r]) => r === 'plan')).toBe(true);
  expect(s.franchisee.plan!.stage).toBe(1);
});
it('stopień 2 zawiesza premię od obrotu i podwaja wagę audytu', () => {
  /* dwa biegi z tego samego stanu, zaufanie 90, plan nie do chybienia; w drugim stage = 2 przed zamknięciem miesiąca */
  expect(bonusStage0 - bonusStage2).toBe(Math.round(0.01 * revenue));              // premia od obrotu przy zaufaniu ≥ 85 to 1%
  expect(cardContext(s, info).planStage).toBe(2);
});
it('trzecia wpadka z rzędu kończy grę komunikatem o planie', () => {
  /* trzy miesiące z planem nie do zrobienia */
  expect(s.gameOver).toBe(true);
  expect(events.filter((e) => e.kind === 'gameover').map((e) => e.text)).toEqual([PLAN_GAMEOVER_TEXT]);
});
it('zaufanie 0 i stopień 3 naraz: jedno zdarzenie gameover, o zaufaniu', () => { /* stage = 2 + plan nie do zrobienia + trust.value = 0 przed zamknięciem */ });
it('komunikat przedostatniego dnia tylko przy prognozie 90–100%', () => { /* target ustawiony na 105% tempa → 1 zdarzenie reason 'short'; na 50% i na 200% → 0 */ });
it('stary zapis w środku miesiąca: zapowiedź, miesiąc bez rozliczenia, plan od następnego', () => {
  /* stan z 5 raportami w historii, bez bloku, dzień 10 miesiąca */
  expect(events.some((e) => e.kind === 'plan' && e.plan?.reason === 'announce')).toBe(true);
  expect(s.lastReport!.plan).toBeUndefined(); expect(s.franchisee.plan!.target).toBeGreaterThan(0);
});
it('dzień zamknięty remontem nie liczy się do dni otwartych', () => {
  /* remontUntil ustawione na dwa pełne dni od 5. dnia miesiąca */
  expect(s.franchisee.plan!.openDays).toBe(4); /* po zamknięciu 6. dnia */
});
it('zapis i odczyt: blok planu i raport z planem wracają bajt w bajt', () => { /* sanitizeEconomy(JSON round-trip) */ });
```

- [ ] **Step 2:** `npx vitest run src/sim/economy/planEconomy.test.ts` → FAIL.
- [ ] **Step 3:** Zaimplementuj zmiany z listy Files według „Zachowanie”. `buildStatement` dopisuje klucz `plan` dopiero po `partial`
  i tylko przy `i.plan > 0`; `sanitizeStatement` czyta go tylko wtedy, gdy jest liczbą dodatnią.
- [ ] **Step 4:** `npx vitest run src/sim/economy tests/simGolden.test.ts tests/rankedSeason.test.ts tests/judgeBundle.test.ts` → PASS,
  `GOLDEN` bez zmian (bramka P1 i P2 specu).
- [ ] **Step 5:** `npm run build` → OK. Commit `feat(sim): plan Centrali w zamknięciu dnia i miesiąca, kara w wyciągu, koniec umowy po trzech wpadkach`.

### Task 3: Firma: zamknięcie sklepu planem i przełącznik dobicia — model: sonnet

**Files:**
- Modify: `src/sim/firm/commands.ts` (`FirmCommand`, `FIRM_COMMAND_TYPES`, `VALID`, `applyFirmCommand`)
- Modify: `src/sim/firm/types.ts` (`FirmRefusal` + `'plan'`)
- Modify: `src/sim/firm/closure.ts` (`endedByPlan`, `closeStore` z powodem `'plan'`, `settle`, `closeDueStores`)
- Modify: `src/sim/firm/firm.ts` (`IMPORTANT` + `'plan'`; ukrycie `gameover` sklepu zamykanego planem, gdy inny gra dalej)
- Modify: `src/sim/firm/preview.ts` i `src/sim/firm/replay.ts` tylko tam, gdzie wyliczają typy poleceń albo powody końca gry
- Test: `src/sim/firm/plan.test.ts`

**Interfaces:**
- Consumes: `planTerminates`, `PlanState` (Task 1); `gameover` z `PLAN_GAMEOVER_TEXT` (Task 2).
- Produces:
  - `FirmCommand`: `{ type: 'planTopUp'; storeId: number; on: boolean }`; odmowy: `'store'` (nie ma takiego otwartego sklepu), `'plan'`
    (sklep nie ma jeszcze bloku planu).
  - `export const endedByPlan = (st: FirmStore, events: readonly EconEvent[]): boolean` — `gameOver`, `planTerminates(plan)`, zdarzenie
    `month` w tej minucie i zaufanie powyżej zera.
  - `closeStore(f, id, reason: 'trust' | 'notice' | 'plan', out)`; zdarzenie `closed` niesie `params.reason = 'plan'`.
  - `settle()` usuwa `fr.plan` (plan należy do umowy; ponowny wynajem zaczyna od miesiąca zapowiedzi).

- [ ] **Step 1: Testy (czerwone)** w `src/sim/firm/plan.test.ts`, na `tests/firmKit.ts` (`partnerSession`, `openSecond`, `playTo`, `tick`):

```ts
it('planTopUp przełącza dobicie we wskazanym sklepie, także w tle', () => { /* sklep 2 w tle z blokiem planu: ok, topUp === true; sklep bez bloku: reason 'plan'; id 99: reason 'store' */ });
it('trzecia wpadka w drugim sklepie zamyka tylko ten sklep, z rozliczeniem końcowym', () => {
  expect(out.firm.filter((e) => e.kind === 'closed')).toEqual([{ kind: 'closed', storeId: 2, params: { reason: 'plan' } }]);
  expect(out.firm.some((e) => e.kind === 'settlement' && e.storeId === 2)).toBe(true);
  expect(f.over).toBeNull(); expect(f.stores[1]!.closed).toBe(true); expect(f.stores[1]!.econ.franchisee.plan).toBeUndefined();
  expect([...out.active, ...out.background.map((b) => b.event)].some((e) => e.kind === 'gameover')).toBe(false);
});
it('trzecia wpadka w ostatnim sklepie kończy grę bez rozliczenia', () => { expect(f.over).toBe('closed'); /* brak 'settlement' */ });
it('zaufanie 0 i plan naraz: sklep zamknięty raz, powód trust', () => {});
it('dwa sklepy z dobiciem w tej samej minucie: drugi liczy na portfelu po pierwszym i nie schodzi poniżej DEBT_WARN', () => {});
it('sklep wynajęty ponownie zaczyna od miesiąca zapowiedzi, bez starego stopnia', () => { /* closeStoreFitted + reopenLot */ });
it('zdarzenie plan sklepu w tle jest ważne (czeka na OK)', () => { expect(out.background.find((b) => b.event.kind === 'plan')!.important).toBe(true); });
```

- [ ] **Step 2:** `npx vitest run src/sim/firm/plan.test.ts` → FAIL.
- [ ] **Step 3:** Zaimplementuj. W `closeDueStores` kolejność powodów: `trust`, `plan`, `notice`.
- [ ] **Step 4:** `npx vitest run src/sim/firm src/game tests/architecture.test.ts` → PASS (w tym `firmSave` i `session`: polecenie firmy
  przechodzi zapis i odtworzenie).
- [ ] **Step 5:** Commit `feat(firma): wypowiedzenie placówki za plan i polecenie dobicia planu`.

### Task 4: Prognoza planu i podgląd miesiąca — model: sonnet

**Files:**
- Modify: `src/sim/economy/forecast.ts` (`MonthForecast.plan`, kara i zawieszona premia w prognozowanym wyciągu)
- Modify: `src/sim/firm/forecast.ts` i `src/sim/firm/preview.ts` (suma sieci niesie plany sklepów)
- Test: `src/sim/economy/forecast.test.ts` (dopisane przypadki), `tests/planForecast.test.ts`

**Interfaces:**
- Consumes: `planOutlook`, `firstPlanPreview` (Task 1); `planOf` (Task 2).
- Produces:
  - `MonthForecast.plan: PlanOutlook | null` oraz `MonthForecast.planFirst: number | null` (pierwszy plan z `firstPlanPreview`, gdy bloku
    jeszcze nie ma, a dzień jest pierwszym dniem czwartego miesiąca).
  - Prognozowany wyciąg ma `plan` (kara) przy werdykcie `miss`, a przy stopniu ≥ 2 nie ma premii od obrotu.
  - `openDaysAhead` = dni do końca miesiąca (z dzisiejszym, jeśli dzień się jeszcze nie zamknął) minus dni zasłonięte przez `remontUntil`.
  - `FirmPreview` dostaje `plans: { storeId: number; plan: PlanMonth }[]` z raportów sklepów w podglądzie.

- [ ] **Step 1: Testy (czerwone).**

```ts
// forecast.test.ts
it('bez planu prognoza jest taka jak dziś, a plan jest null', () => {});
it('prognoza poniżej planu niesie karę w wyciągu i stopień po rozliczeniu', () => {
  expect(f.plan).toMatchObject({ verdict: 'miss', stageAfter: 1 }); expect(f.statement.plan).toBe(f.plan!.fine);
});
it('z włączonym dobiciem i prognozą 95%: werdykt topup, koszt w cashAfter, bez kary', () => {});
// tests/planForecast.test.ts — bramka P7
it('każda kara z zamknięcia miesiąca była w podglądzie miesiąca uruchomionym rano ostatniego dnia', () => {
  /* 2 seedy × 8 miesięcy z planem, bot bez zakupów; dla każdego miesiąca z report.plan.fine > 0:
     startMonthPreview rano ostatniego dnia → result().statement.plan === report.statement.plan */
});
```

- [ ] **Step 2:** uruchom oba pliki → FAIL.
- [ ] **Step 3:** Zaimplementuj. `forecastMonth` używa tej samej prognozy obrotu (`revenue`), którą już liczy.
- [ ] **Step 4:** `npx vitest run src/sim/economy/forecast.test.ts tests/planForecast.test.ts src/sim/firm` → PASS.
- [ ] **Step 5:** Commit `feat(sim): plan Centrali w prognozie paska i w podglądzie miesiąca`.

### Task 5: Interfejs planu — model: sonnet

**Files:**
- Create: `src/ui/game/plan.tsx` (pasek planu z przełącznikiem), `src/ui/game/planText.ts` (wszystkie zdania o planie)
- Modify: `src/ui/game/Hud.tsx` (`ForecastRow`: wiersz planu pod paskiem prognozy), `src/ui/game/monthPreview.tsx` (wiersze planu,
  ostrzeżenie o końcu umowy `plan`), `src/ui/game/statement.tsx` (wiersz „Plan Centrali” w potrąceniach), `src/ui/game/reportBody.tsx`
  (sekcja planu), `src/ui/game/overlays.tsx` (okno zdarzenia `plan`, ekran końca gry z planem)
- Modify: `src/ui/city/storeSwitcherModel.ts` (`StoreWarning` + `'plan'`, `StoreMini.plan`), `src/ui/city/StoreSwitcher.tsx`,
  `src/ui/city/firmText.ts` (`firmEventText` dla `closed` z powodem `plan`, `refusalText` dla `'plan'`, `backgroundToastText`)
- Modify: `src/i18n/en/ui.ts`, `src/i18n/en/sim.ts` (teksty zdarzeń symulacji)
- Test: `src/ui/game/plan.test.tsx`, dopisane przypadki w `monthPreview.test.tsx`, `overlays.test.tsx`, `storeSwitcherModel.test.ts`, `firmText.test.ts`

**Interfaces:**
- Consumes: `MonthForecast.plan`, `planFirst` (Task 4); `MonthReport.plan`, `Statement.plan`, zdarzenie `'plan'` (Task 2); polecenie
  `planTopUp` (Task 3); `PLAN` (Task 1).
- Produces: `export function PlanRow({ plan, first, storeId }: { plan: PlanOutlook | null; first: number | null; storeId: number })`,
  `export function planLines(o: PlanOutlook): { head: string; progress: string; verdict: string; tone: 'ok' | 'warn' | 'danger' }`,
  `export const STAGE_NAME: readonly string[]` = `['W planie', 'Rozmowa z partnerem regionalnym', 'Program naprawczy', 'Wypowiedzenie placówki']`.

Teksty (dokładne, po polsku; angielskie odpowiedniki pisze wykonawca w tonie dotychczasowych okólników):
- pasek, `planLines`: `Plan Centrali: 412 000 zł · seria: 3 mies.` / `wykonane 61% · prognoza 97%` / werdykt jeden z:
  `Prognoza: plan zrobiony.` · `Jeśli nic się nie zmieni: dobicie z kieszeni ok. 9 960 zł.` ·
  `Jeśli nic się nie zmieni: kara 1 240 zł, stopień 1 (Rozmowa z partnerem regionalnym).` ·
  przy `stageAfter === 3`: `Jeśli nic się nie zmieni: Centrala wypowie umowę na tę placówkę.`
- przed pierwszym planem (`first`): `Od dziś obowiązuje plan Centrali: 412 000 zł w tym miesiącu.`
- przełącznik: `Dobij plan z własnej kieszeni, jeśli zabraknie do 10%` z dopiskiem `Kupujesz brakujący towar sam. Miesiąc jest zaliczony, ale następny plan rośnie.`
- raport, „dlaczego tyle”: `Nowy plan: 431 000 zł. Średni obrót dzienny z trzech miesięcy 13 290 zł × 31 dni, plus 3,5% za serię 3 trafień.`
  albo po wpadce `…Centrala łaskawie obniża bazę o 5%.`
- zdarzenia: `start` → tytuł `Koniec okresu wdrożenia`, tekst `Gwarancja się skończyła. Od dziś Centrala przysyła plan sprzedaży: 412 000 zł w tym miesiącu. „Wierzymy w Ciebie. Liczbowo.”`;
  `announce` → `Od przyszłego miesiąca ten sklep ma plan sprzedaży Centrali. W tym miesiącu jeszcze bez rozliczenia.`;
  `short` → `Do planu brakuje ok. 18 400 zł. Dobicie z kieszeni: ok. 15 270 zł. Bez dobicia: kara 1 840 zł i stopień 1.`
- raport, zmiana stopnia (raport miesiąca już zatrzymuje grę): sekcja planu zaczyna się listem partnera regionalnego. Stopień w górę:
  `Partner regionalny: „Widzimy spadek zaangażowania. Od dziś: {nazwa stopnia}.”`; stopień w dół:
  `Partner regionalny: „Dziękujemy za powrót do standardu. Na razie.”`
- raport trzeciego miesiąca umowy (`history.length === PLAN.startMonths` po zamknięciu): wiersz
  `Koniec okresu wdrożenia. Od jutra obowiązuje plan sprzedaży Centrali: 412 000 zł.` z `firstPlanPreview(history, day + 1)`.
- podgląd miesiąca sieci pokazuje przy każdym sklepie wynik planu z `FirmPreview.plans`.
- ton paska: `danger` przy `stageAfter >= 2`, `warn` przy werdykcie `miss` albo `topup`, inaczej `ok`.

- [ ] **Step 1: Testy (czerwone).** `plan.test.tsx`: `planLines` dla trzech werdyktów i dla `stageAfter === 3` (dokładne zdania powyżej);
  `PlanRow` z `plan = null` i `first = null` nie renderuje nic; kliknięcie przełącznika wysyła `{ type: 'planTopUp', storeId, on: true }`.
  `monthPreview.test.tsx`: wiersz „Plan Centrali” z karą; ostrzeżenie przy `gameOver === 'plan'`. `overlays.test.tsx`: zdarzenie `plan`
  zatrzymuje grę i ma „OK”; ekran końca gry z powodu planu pokazuje przeżyte miesiące, gotówkę i ostatni plan z wykonaniem.
  `storeSwitcherModel.test.ts`: sklep ze stopniem ≥ 1 ma ostrzeżenie `'plan'`. `firmText.test.ts`: `closed` z `reason: 'plan'`.
- [ ] **Step 2:** `npx vitest run src/ui` → FAIL w nowych przypadkach.
- [ ] **Step 3:** Zaimplementuj. Przewijanie dni nie staje na zdarzeniu `plan`: trafia ono na listę „co się wydarzyło” (ten sam mechanizm,
  którym przewijanie obsługuje dziś zdarzenia `story` sklepu; znajdź go w `src/game/loop.ts` i `src/ui/game/overlays.tsx`).
- [ ] **Step 4:** `npx vitest run src/ui tests/i18n.test.ts` → PASS; `npm run build` → OK.
- [ ] **Step 5:** Commit `feat(ui): pasek planu Centrali, dobicie z kieszeni, plan w raporcie i w Mieście`.

### Task 6: Balans na botach, zapis, smoke i raport — model: opus

**Files:**
- Modify: `tests/progresjaPlay.ts` (strategia `rozsadny`; `ProgMonth` dostaje `plans: { storeId: number; share: number; stage: number; fine: number }[]`;
  `ProgResult` dostaje `closedByPlan: { storeId: number; month: number }[]`)
- Create: `tests/measure/plan.measure.test.ts` (`MEASURE=1`), `tests/planBalance.test.ts` (szybka bramka w `npm test`)
- Modify: `src/ui/ranking/saveTransfer.test.ts` (najgorszy przypadek z blokami planu i raportem z planem)
- Modify: `scripts/city-smoke.mjs` (kroki `5a-a`…`5a-c`), `tests/citySmoke.test.ts`
- Create: `docs/superpowers/reports/2026-11-17-plan-centrali-5a.md`

**Interfaces:**
- Consumes: wszystko z Tasków 1–5.
- Produces: raport dla właściciela z tabelą bramek i listą zmienionych liczb `PLAN`.

Bot `rozsadny`: jak `siec`, ale kupuje (najtańsza rzecz, gotówka albo raty) tylko wtedy, gdy `forecastMonth(...).plan` któregoś sklepu ma
`forecastShare < 1.05`; poza tym oszczędza. Nie włącza dobicia.

Bramki (spec §6.7; 5 seedów `traszka-1, kopytka-541, makieta, lublin-9, seed-3`, 24 miesiące):

| Bramka | Asercja w `plan.measure.test.ts` |
|---|---|
| P3 | `mistrz`: pierwsza wpadka w miesiącach 5–9 na każdym seedzie; `closedByPlan` niepuste przed końcem 18. miesiąca |
| P4 | `jeden`: mediana miesiąca pierwszej wpadki ≥ 12 |
| P5 | `siec12`: pierwsza wpadka któregokolwiek sklepu w miesiącach 13–16 |
| P6 | `rozsadny`: portfel ≥ 1 000 000 zł w miesiącach 14–22 na ≥ 3 z 5 seedów; sklep startowy nigdy w `closedByPlan` |

- [ ] **Step 1:** Dopisz bota i pola wyników w `tests/progresjaPlay.ts`; napisz `plan.measure.test.ts` z asercjami z tabeli.
- [ ] **Step 2:** `MEASURE=1 npx vitest run tests/measure/plan.measure.test.ts` → zapisz liczby wyjściowe do raportu (oczekiwane: część bramek FAIL).
- [ ] **Step 3:** Strój wyłącznie stałe `PLAN` (`growthBase`, `growthPerHit`, `growthMax`, `baseFloor`, `fineShare`, `bonusShare`). Każdą
  zmianę zapisz w raporcie jako „było → jest → dlaczego” i popraw oczekiwane liczby w `plan.test.ts`. Jeśli P3–P6 nie dają się spełnić
  razem, nie ruszaj reszty ekonomii: opisz lukę w raporcie i zostaw decyzję właścicielowi (spec §6.7).
- [ ] **Step 4:** `tests/planBalance.test.ts`: `mistrz` i `rozsadny`, 13 miesięcy, seedy `traszka-1` i `kopytka-541`; asercje: `mistrz` ma
  wpadkę do 9. miesiąca, `rozsadny` nie traci sklepu startowego, brak końca gry z debetu, każdy raport z karą ma `statement.plan > 0`.
  Limit czasu 240 s na test (jak `progresjaBalance`).
- [ ] **Step 5:** `saveTransfer.test.ts`: najgorszy przypadek dostaje w każdym otwartym sklepie blok planu z liczbami sześciocyfrowymi
  i `lastReport.plan`; asercja `< 62 000` B bez zmiany progu. Jeśli nie przechodzi, `compactStore` skraca `lastReport.plan`
  do pól potrzebnych oknu końca gry (`target`, `due`, `turnover`, `share`, `stage`).
- [ ] **Step 6:** Smoke: `5a-a` (zapis z czterema raportami i bez bloku: po wczytaniu i jednym dniu gry okno zapowiedzi planu, bez błędów
  konsoli), `5a-b` (zapis z planem i prognozą 95%: pasek planu, włączenie przełącznika, po zamknięciu miesiąca raport z dobiciem),
  `5a-c` (po angielsku: pasek i raport bez polskich zdań). Telefon 390×844 i komputer 1440×900; zrzuty do
  `docs/superpowers/reports/2026-11-17-plan-centrali-5a/`.
- [ ] **Step 7:** Pełne bramki w tej kolejności: `npm run build`, `npm test`, `npm run check:vercel-build`,
  `PLAYWRIGHT_ROOT=… npm run city:smoke`. Wszystkie zielone; `GOLDEN` bez zmian.
- [ ] **Step 8:** Raport `docs/superpowers/reports/2026-11-17-plan-centrali-5a.md` w układzie raportu 4b: co weszło, pomiar, bramki
  P1–P7, strojenie „było → jest”, zapas paczki zapisu, smoke, rulingi, co zostaje do decyzji właściciela. Commit
  `test(balans): plan Centrali na botach, zapis, smoke i raport`.
