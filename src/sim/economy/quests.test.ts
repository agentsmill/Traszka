import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { createEconomy } from './economy';
import { QUEST_KINDS, newQuest, questTitle, type QuestKind } from './quests';
import { computeStoreInfo } from './storeInfo';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));

describe('tytuł zlecenia (L9): liczony przy wyświetlaniu, nie trzymany w stanie', () => {
  it('newQuest zwraca zlecenie bez klucza title', () => {
    const s = createEconomy(SEED, info);
    const q = newQuest(s, { dailyCustomers: 600, dailyMargin: 4000 });
    expect('title' in q).toBe(false);
    expect(Object.keys(q).sort()).toEqual(['id', 'kind', 'reward', 'start', 'target']);
  });

  it('stan z trzema zleceniami nie zawiera żadnego tytułu (tylko liczby i identyfikatory)', () => {
    const s = createEconomy(SEED, info);
    expect(s.quests).toHaveLength(3);
    for (const q of s.quests) expect('title' in q).toBe(false);
    expect(JSON.stringify(s)).not.toContain('"title"');
  });

  it('questTitle: ten sam napis co dotąd (liczba w formacie pl-PL)', () => {
    expect(questTitle({ kind: 'serve', target: 1500 })).toBe(`Obsłuż ${(1500).toLocaleString('pl-PL')} klientów`);
    expect(questTitle({ kind: 'margin', target: 50_000 })).toBe(`Zarób ${(50_000).toLocaleString('pl-PL')} zł marży`);
    expect(questTitle({ kind: 'hot', target: 2000 })).toBe(`Sprzedaj ${(2000).toLocaleString('pl-PL')} hot-dogów i kaw`);
  });

  it('questTitle: odmiana i pozostałe rodzaje zleceń', () => {
    expect(questTitle({ kind: 'pallets', target: 1 })).toBe('Rozładuj 1 paletę');
    expect(questTitle({ kind: 'pallets', target: 3 })).toBe('Rozładuj 3 palety');
    expect(questTitle({ kind: 'pallets', target: 5 })).toBe('Rozładuj 5 palet');
    expect(questTitle({ kind: 'taps', target: 90 })).toBe('Pomóż osobiście: 90 stuknięć w palety albo kasę');
    expect(questTitle({ kind: 'upgrade', target: 1 })).toBe('Zainwestuj: kup dowolne ulepszenie albo sprzęt');
    expect(questTitle({ kind: 'clean', target: 1 })).toBe('Zamknij dzień bez mandatu');
    expect(questTitle({ kind: 'clean', target: 2 })).toBe('Zamknij 2 dni bez mandatu');
    expect(questTitle({ kind: 'rep', target: 75 })).toBe('Podnieś reputację do 75');
  });

  it('questTitle: każdy rodzaj daje niepusty napis, także dla pełnego zlecenia ze stanu', () => {
    for (const kind of QUEST_KINDS) expect(questTitle({ kind: kind as QuestKind, target: 10 }).length, kind).toBeGreaterThan(0);
    for (const q of createEconomy(SEED, info).quests) expect(questTitle(q).length).toBeGreaterThan(0);
  });
});
