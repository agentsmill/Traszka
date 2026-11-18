import type { Dict, Plurals } from '../ui';

/* Górny pasek gry (`ui/game/Hud.tsx`) i napisy prognozy końca miesiąca (`ui/game/forecastText.ts`): trzy kieszenie, ostrzeżenia przy zakupach. */

export const HUD_UI: Dict = {
  // przyciski prędkości (`SPEEDS`, tytuły przez `tr`)
  'Pauza (spacja)': 'Pause (Space)',
  'Czas normalnie': 'Normal speed',
  'Czas ×2': 'Speed ×2',
  'Czas ×4': 'Speed ×4',
  'Czas ×8': 'Speed ×8',
  // Hud.tsx
  'Zaufanie {0}: {1}': 'Trust {0}: {1}',
  'Zaufanie Centrali {0} / 100: {1}. {2}': 'Head Office’s trust {0} / 100: {1}. {2}',
  '{0} {1} na odbiór nagrody': '{0} {1} waiting to be claimed',
  '{0}: zakładka Cele': '{0}: Goals tab',
  'Ranking': 'Leaderboard',
  'Saldo': 'Balance',
  'u Centrali': 'at Head Office',
  'Raty': 'Instalments',
  'sieć': 'network',
  'Sieć: {0}': 'Network: {0}',
  'Prognoza całej sieci: liczą się wszystkie sklepy, bo gotówka jest wspólna.': 'Whole-network forecast: every shop counts, because the cash is shared.',
  'Po zamknięciu': 'After close you’ll',
  'zostanie': 'keep',
  'Poziom {0}': 'Level {0}',
  'Gotówka': 'Cash',
  'Reputacja sklepu (0–100): ściąga klientów': 'Shop reputation (0–100): brings in customers',
  'Ogonki: nagrody za cele, wydajesz w Ulepszeniach': 'Ogonki (Traszka loyalty points): rewards for goals, spent in Upgrades',
  'Jak grać': 'How to play',
  'Ustawienia': 'Settings',
  '· remont': '· refit',
  'Prędkość czasu': 'Game speed',
  // forecastText.ts
  'Po zamknięciu miesiąca, z pierwszą ratą, zostanie Ci': 'After the month closes, with the first instalment, you’ll keep',
  'Po zamknięciu miesiąca zostanie Ci': 'After the month closes you’ll keep',
  '{0} {1}: gotówka zejdzie pod zero.': '{0} {1}: your cash will go below zero.',
  '{0} {1}, poniżej progu ostrzeżenia ({2}).': '{0} {1}, below the warning threshold ({2}).',
  '{0} {1}, poniżej granicy debetu ({2}): Centrala wypowie umowę.': '{0} {1}, below the debt limit ({2}): Head Office will terminate your agreement.',
  'Saldo u Centrali {0}, raty w tym miesiącu {1}, po zamknięciu zostanie {2}':
    'Head Office balance {0}, instalments this month {1}, you’ll keep {2} after the month closes',
  'Poniżej granicy debetu ({0}) Centrala wypowie umowę.': 'Below the debt limit ({0}) Head Office will terminate your agreement.',
  'Blisko granicy debetu ({0}).': 'Close to the debt limit ({0}).',
  'Saldo u Centrali to marża i premie naliczone w tym miesiącu ({0}): przyjdą przelewem przy zamknięciu miesiąca, a gotówka rusza się dopiero wtedy.':
    'Your Head Office balance is the margin and bonuses earned this month ({0}): they arrive as a transfer when the month closes, and your cash only moves then.',
  'Z przelewu Centrala potrąca raty ({0}) i palety ponad darmowe, a Ty płacisz pensje, media, ZUS, VAT i księgową.':
    'From the transfer Head Office deducts instalments ({0}) and pallets over the free allowance, and you pay wages, utilities, ZUS (Polish social security), VAT and your accountant.',
  'Po zamknięciu miesiąca zostanie Ci {0}, czyli gotówka {1} (teraz {2}).{3}': 'After the month closes you’ll keep {0}, leaving you {1} in cash (now {2}).{3}',
  'To szybki szacunek z dotychczasowego obrotu. Dokładny wyciąg: stuknij.': 'This is a quick estimate based on turnover so far. Tap for the exact statement.',
  // plan sprzedaży Centrali: pasek, przełącznik i zdania o planie (ui/game/planText.ts, plan.tsx)
  'Prognoza: plan zrobiony.': 'Forecast: plan met.',
  'Prognoza: plan na styk. Jeśli zabraknie choć trochę, będzie kara.': 'Forecast: plan only just met. Fall even slightly short and there will be a penalty.',
  'Prognoza: plan na styk. Jeśli zabraknie choć trochę, Centrala wypowie umowę na tę placówkę.':
    'Forecast: plan only just met. Fall even slightly short and Head Office will terminate the agreement for this branch.',
  'Jeśli nic się nie zmieni: dobicie z kieszeni ok. {0}.': 'If nothing changes: top-up from your own pocket, approx. {0}.',
  'Jeśli nic się nie zmieni: Centrala wypowie umowę na tę placówkę.': 'If nothing changes: Head Office will terminate the agreement for this branch.',
  'Jeśli nic się nie zmieni: kara {0}, stopień {1} ({2}).': 'If nothing changes: penalty {0}, stage {1} ({2}).',
  'Plan Centrali: {0} · seria: {1} mies.': 'Head Office plan: {0} · streak: {1} mo.',
  'wykonane {0} · prognoza {1}': 'achieved {0} · forecast {1}',
  'Od dziś obowiązuje plan Centrali: {0} w tym miesiącu.': 'From today the Head Office plan applies: {0} this month.',
  'Dobij plan z własnej kieszeni, jeśli zabraknie do {0}': 'Top up the plan from your own pocket if you fall short by up to {0}',
  'Kupujesz brakujący towar sam. Miesiąc jest zaliczony, ale następny plan rośnie.': 'You buy the missing goods yourself. The month counts as met, but next month’s plan goes up.',
  'W planie': 'On plan',
  'Rozmowa z partnerem regionalnym': 'Talk with the regional partner',
  'Program naprawczy': 'Recovery programme',
  'Wypowiedzenie placówki': 'Branch termination',
  'Koniec okresu wdrożenia': 'End of the onboarding period',
  'Plan sprzedaży Centrali': 'Head Office sales plan',
  'Plan: brakuje do progu': 'Plan: short of the threshold',
};

export const HUD_PLURALS: Plurals = {
  'cel czeka|cele czekają|celów czeka': ['goal reward', 'goal rewards'],
};
