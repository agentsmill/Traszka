import { describe, expect, it } from 'vitest';
import { QUARTER_MIN, TASK_DWELL_S, TaskHold } from './taskHold';
import type { StaffAssignment, StaffDuty } from './types';

const one = (task: StaffDuty, id = 1): StaffAssignment[] => [{ id, task }];

describe('stałe', () => {
  it('kwadrans gry to 15 minut, a osoba trzyma zadanie co najmniej 6 s czasu widoku', () => {
    expect(QUARTER_MIN).toBe(15);
    expect(TASK_DWELL_S).toBe(6);
  });
});

describe('TaskHold: nowa i zwolniona osoba', () => {
  it('nowa osoba dostaje od razu to, czego chce ekonomia; kogoś, kogo nie było, get nie zna', () => {
    const hold = new TaskHold();
    expect(hold.get(1)).toBeUndefined();
    hold.update(100, 0, [{ id: 1, task: 'kasa' }, { id: 2, task: 'sprzatanie' }]);
    expect(hold.get(1)).toBe('kasa');
    expect(hold.get(2)).toBe('sprzatanie');
    expect(hold.get(3)).toBeUndefined();
  });

  it('osoba, która dołącza później, od razu dostaje swoje zadanie i liczy dwell od chwili dołączenia', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(10, 20, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'rozladunek' }]);
    expect(hold.get(2)).toBe('rozladunek');
    hold.update(14, 22, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wykladanie' }]);
    hold.update(15, 23, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wykladanie' }]);
    expect(hold.get(1)).toBe('sprzatanie');   // 23 s od początku: wolno
    expect(hold.get(2)).toBe('rozladunek');    // ma dopiero 3 s od dołączenia, mimo że głosy przeważają za wykładaniem
  });

  it('nowa osoba nie ma głosów za czas sprzed dołączenia: pierwszy update tylko ustawia jej zadanie', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(10, 20, [{ id: 1, task: 'kasa' }, { id: 2, task: 'rozladunek' }]);
    // Okno 0..15: osoba 2 istnieje od minuty 10 i do granicy chce kasy przez 5 minut. Dziesięciu minut rozładunku
    // z czasu, gdy jej jeszcze nie było, nie dostaje.
    hold.update(15, 30, [{ id: 1, task: 'kasa' }, { id: 2, task: 'kasa' }]);
    expect(hold.get(2)).toBe('kasa');
  });

  it('zwolniona osoba znika od razu, a po powrocie jest traktowana jak nowa', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(1, 1, []);
    expect(hold.get(1)).toBeUndefined();
    hold.update(2, 2, one('rozladunek'));
    expect(hold.get(1)).toBe('rozladunek');
  });

  it('po powrocie nie ma starych głosów ani starego „od kiedy”', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    for (let m = 1; m <= 12; m++) hold.update(m, m, one('sprzatanie'));  // 12 głosów za sprzątaniem
    hold.update(13, 13, []);                                            // zwolniona
    hold.update(14, 14, one('rozladunek'));                             // wraca jako nowa: rozładunek
    hold.update(15, 15, one('rozladunek'));                             // granica kwadransa, głosów tylko za rozładunkiem
    expect(hold.get(1)).toBe('rozladunek');
  });

  it('osoby są od siebie niezależne', () => {
    const hold = new TaskHold();
    hold.update(0, 0, [{ id: 1, task: 'kasa' }, { id: 2, task: 'kasa' }]);
    for (let m = 1; m <= 15; m++) hold.update(m, m, [{ id: 1, task: 'kasa' }, { id: 2, task: 'wykladanie' }]);
    expect(hold.get(1)).toBe('kasa');
    expect(hold.get(2)).toBe('wykladanie');
  });

  it('powtórzone id w jednym update: liczy się pierwsze wystąpienie', () => {
    const hold = new TaskHold();
    hold.update(0, 0, [{ id: 1, task: 'kasa' }, { id: 1, task: 'sprzatanie' }]);
    expect(hold.get(1)).toBe('kasa');
    hold.update(1, 1, [{ id: 1, task: 'kasa' }, { id: 1, task: 'sprzatanie' }]);
    expect(hold.get(1)).toBe('kasa');
  });
});

describe('TaskHold: zmiana zadania tylko na granicy kwadransa', () => {
  it('ekonomia przestawia zadanie co minutę, a trzymane zmienia się dopiero na granicy kwadransa', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    for (let m = 1; m <= 14; m++) {
      hold.update(m, m * 0.5, one('sprzatanie'));  // w czasie widoku 7 s: dwell dawno spełniony
      expect(hold.get(1)).toBe('kasa');
    }
    hold.update(15, 7.5, one('sprzatanie'));
    expect(hold.get(1)).toBe('sprzatanie');
  });

  it('granica kwadransa bez spełnionego dwellu nie zmienia zadania, a głosy z okna przepadają', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    for (let m = 1; m <= 15; m++) hold.update(m, m * 0.1, one('sprzatanie'));  // 1,5 s < TASK_DWELL_S
    expect(hold.get(1)).toBe('kasa');
    // Następne okno liczy się od zera: gdyby 15 minut „sprzątania” z okna 0 zostało, na granicy 30 wygrałoby sprzątanie.
    for (let m = 16; m <= 29; m++) hold.update(m, 10, one('kasa'));
    hold.update(30, 10, one('sprzatanie'));
    expect(hold.get(1)).toBe('kasa');
  });

  it('dwell liczy się od ostatniej zmiany: tuż po przełączeniu kolejna zmiana jest blokowana', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    for (let m = 1; m <= 15; m++) hold.update(m, 6 + m * 0.01, one('sprzatanie'));
    expect(hold.get(1)).toBe('sprzatanie');                                   // zmiana w czasie ≈ 6,15 s
    for (let m = 16; m <= 30; m++) hold.update(m, 6.2 + (m - 16) * 0.01, one('kasa'));
    expect(hold.get(1)).toBe('sprzatanie');                                   // 0,2 s po zmianie: za wcześnie
    for (let m = 31; m <= 45; m++) hold.update(m, 12.2 + (m - 31) * 0.01, one('kasa'));
    expect(hold.get(1)).toBe('kasa');                                         // 6,05 s po zmianie: wolno
  });

  it('dwell to „co najmniej” TASK_DWELL_S: dokładnie tyle wystarcza, odrobina mniej nie', () => {
    const exact = new TaskHold();
    exact.update(0, 0, one('kasa'));
    for (let m = 1; m <= 14; m++) exact.update(m, 0, one('sprzatanie'));
    exact.update(15, TASK_DWELL_S, one('sprzatanie'));
    expect(exact.get(1)).toBe('sprzatanie');

    const short = new TaskHold();
    short.update(0, 0, one('kasa'));
    for (let m = 1; m <= 14; m++) short.update(m, 0, one('sprzatanie'));
    short.update(15, TASK_DWELL_S - 0.01, one('sprzatanie'));
    expect(short.get(1)).toBe('kasa');
  });

  it('przy zadaniu losowym co minutę zmiany są rzadkie, tylko na granicach kwadransa i nie częściej niż co dwell', () => {
    const hold = new TaskHold();
    const duties: StaffDuty[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny'];
    let seed = 12345;
    const rand = (): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const MIN_PER_S = 20;   // tempo gry: ~20 minut gry na sekundę rzeczywistą
    let changes = 0;
    let lastChangeClock = -Infinity;
    let prev: StaffDuty | undefined;
    const minutes = 20 * 60;
    for (let m = 0; m <= minutes; m++) {
      const clock = m / MIN_PER_S;
      hold.update(m, clock, one(duties[Math.floor(rand() * duties.length)]!));
      const now = hold.get(1);
      if (prev !== undefined && now !== prev) {
        changes++;
        expect(m % QUARTER_MIN).toBe(0);                                  // tylko tuż po przekroczeniu kwadransa
        expect(clock - lastChangeClock).toBeGreaterThanOrEqual(TASK_DWELL_S);
        lastChangeClock = clock;
      }
      if (prev === undefined) lastChangeClock = clock;
      prev = now;
    }
    // 60 s widoku: przy dwellu 6 s zmian jest najwyżej 10, a losowe głosy dają ich na pewno kilka.
    expect(changes).toBeGreaterThanOrEqual(3);
    expect(changes).toBeLessThanOrEqual(Math.floor(minutes / MIN_PER_S / TASK_DWELL_S));
  });
});

describe('TaskHold: głosowanie w oknie', () => {
  it('zadanie przeważające w oknie wygrywa z ostatnim chcianym', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('wolny'));
    for (let m = 1; m <= 10; m++) hold.update(m, m, one('kasa'));          // 10 minut kasy
    for (let m = 11; m <= 14; m++) hold.update(m, m, one('rozladunek'));   // 4 minuty rozładunku
    hold.update(15, 15, one('rozladunek'));                                // 5 minut, ostatni głos
    expect(hold.get(1)).toBe('kasa');
  });

  it('głos waży tyle minut, ile minęło od poprzedniego update', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('wolny'));
    hold.update(2, 2, one('kasa'));          // 2 minuty kasy
    hold.update(3, 3, one('wykladanie'));    // 1 minuta wykładania
    hold.update(4, 4, one('kasa'));          // +1: kasa 3
    hold.update(15, 15, one('wykladanie'));  // +11: wykładanie 12, kasa 3
    expect(hold.get(1)).toBe('wykladanie');
  });

  it('głosy z poprzedniego okna nie przechodzą do następnego', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('wolny'));
    for (let m = 1; m <= 15; m++) hold.update(m, m, one('kasa'));          // okno 0: kasa, zmiana w 15
    expect(hold.get(1)).toBe('kasa');
    for (let m = 16; m <= 22; m++) hold.update(m, 20 + m, one('rozladunek'));  // 7 minut rozładunku
    for (let m = 23; m <= 30; m++) hold.update(m, 20 + m, one('sprzatanie'));  // 8 minut sprzątania
    expect(hold.get(1)).toBe('sprzatanie');   // gdyby 15 minut kasy z okna 0 zostało, wygrałaby kasa
  });

  it('remis zostaje przy trzymanym zadaniu', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(7.5, 8, one('rozladunek'));   // rozładunek 7,5
    hold.update(15, 16, one('kasa'));         // kasa 7,5: remis, a trzymane to kasa
    expect(hold.get(1)).toBe('kasa');

    const other = new TaskHold();
    other.update(0, 0, one('rozladunek'));
    other.update(7.5, 8, one('kasa'));
    other.update(15, 16, one('rozladunek'));  // ten sam remis, ale trzymane jest rozładunek
    expect(other.get(1)).toBe('rozladunek');
  });

  it('remis bez trzymanego zadania rozstrzyga kolejność kasa, rozładunek, wykładanie, sprzątanie, wolny', () => {
    const run = (a: StaffDuty, b: StaffDuty, held: StaffDuty): StaffDuty | undefined => {
      const hold = new TaskHold();
      hold.update(0, 0, one(held));
      hold.update(7.5, 8, one(a));
      hold.update(15, 16, one(b));
      return hold.get(1);
    };
    expect(run('sprzatanie', 'rozladunek', 'wolny')).toBe('rozladunek');
    expect(run('rozladunek', 'sprzatanie', 'wolny')).toBe('rozladunek');
    expect(run('wolny', 'kasa', 'wykladanie')).toBe('kasa');
    expect(run('wolny', 'sprzatanie', 'kasa')).toBe('sprzatanie');
    expect(run('wykladanie', 'sprzatanie', 'wolny')).toBe('wykladanie');
  });

  it('osoba bez żadnego głosu w oknie (dołączyła w update na granicy kwadransa) zostaje przy swoim zadaniu', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(15, 100, [{ id: 1, task: 'kasa' }, { id: 2, task: 'sprzatanie' }]);
    expect(hold.get(2)).toBe('sprzatanie');   // remis wszystkich zadań po zerach: trzymane, a nie pierwsze z kolejności
  });

  it('powtórzona minuta nie dolicza głosów', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(8, 8, one('rozladunek'));                                      // rozładunek 8
    for (let i = 0; i < 50; i++) hold.update(8, 9 + i, one('kasa'));           // ta sama minuta wiele razy: bez przyrostu
    hold.update(15, 100, one('kasa'));                                         // kasa 7 vs rozładunek 8
    expect(hold.get(1)).toBe('rozladunek');
  });
});

describe('TaskHold: cofnięcie minuty i skoki', () => {
  it('cofnięcie minuty czyści stan: wszyscy są nowi, nikogo spoza desired nie ma', () => {
    const hold = new TaskHold();
    hold.update(100, 0, [{ id: 1, task: 'kasa' }, { id: 2, task: 'kasa' }]);
    for (let m = 101; m <= 110; m++) hold.update(m, m, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'sprzatanie' }]);
    hold.update(5, 111, one('rozladunek'));   // nowa oś czasu (np. nowa gra), czas widoku nie wrócił
    expect(hold.get(1)).toBe('rozladunek');   // od razu, bez czekania na dwell i kwadrans
    expect(hold.get(2)).toBeUndefined();
  });

  it('po cofnięciu nie zostają stare głosy, a nowa oś czasu ocenia dopiero na swoim kwadransie', () => {
    const hold = new TaskHold();
    hold.update(100, 0, one('wolny'));
    for (let m = 101; m <= 104; m++) hold.update(m, m, one('kasa'));       // 4 głosy za kasą na starej osi
    hold.update(0, 105, one('wykladanie'));                                // reset: nowa osoba
    for (let m = 1; m <= 14; m++) {
      hold.update(m, 105 + m * 2, one('sprzatanie'));
      expect(hold.get(1)).toBe('wykladanie');                              // bez oceny przed granicą 15
    }
    hold.update(15, 135, one('sprzatanie'));
    expect(hold.get(1)).toBe('sprzatanie');
  });

  it('po cofnięciu pierwsza ocena kwadransa jest znowu świeża', () => {
    const hold = new TaskHold();
    hold.update(100, 0, one('kasa'));
    hold.update(3, 50, one('rozladunek'));
    hold.update(4, 51, one('rozladunek'));
    expect(hold.get(1)).toBe('rozladunek');   // cofnięcie nie zostawiło „ostatniego kwadransa” ze starej osi
    hold.update(14, 60, one('sprzatanie'));
    expect(hold.get(1)).toBe('rozladunek');
  });

  it('przeskok o godzinę ocenia kwadrans jeden raz i nie gubi głosów z okna', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('wolny'));
    hold.update(14, 10, one('kasa'));         // kasa 14
    hold.update(16, 11, one('rozladunek'));   // przekroczenie granicy: rozładunek 2, a kasa 14 nie przepadła
    expect(hold.get(1)).toBe('kasa');

    const jump = new TaskHold();
    jump.update(0, 0, one('wolny'));
    jump.update(5, 10, one('kasa'));          // kasa 5
    jump.update(65, 20, one('rozladunek'));   // godzina: przyrost przycięty do 15 minut, wygrywa rozładunek
    expect(jump.get(1)).toBe('rozladunek');
  });

  it('przeskok o wiele kwadransów zmienia zadanie najwyżej raz i zeruje „od kiedy”', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(60, 10, one('rozladunek'));   // 4 kwadranse naraz: jedna ocena, jedna zmiana
    expect(hold.get(1)).toBe('rozladunek');
    // Zmiana nastąpiła w czasie 10 s, więc kolejna na następnej granicy (75) w czasie 12 s jest za wcześnie.
    hold.update(74, 11, one('wykladanie'));
    hold.update(75, 12, one('wykladanie'));
    expect(hold.get(1)).toBe('rozladunek');
    // A po dwellu (od 10 s minęło 6 s) ta sama zmiana przechodzi na kolejnej granicy.
    for (let m = 76; m <= 89; m++) hold.update(m, 13, one('wykladanie'));
    hold.update(90, 16, one('wykladanie'));
    expect(hold.get(1)).toBe('wykladanie');
  });

  it('po przeskoku okno liczy się od nowa: kolejna ocena dopiero na następnym kwadransie', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(100, 50, one('kasa'));        // kwadrans 6; ocena zeruje okno
    hold.update(101, 51, one('sprzatanie'));  // nadal kwadrans 6: bez oceny
    hold.update(104, 80, one('sprzatanie'));
    expect(hold.get(1)).toBe('kasa');
    hold.update(105, 81, one('sprzatanie'));  // granica kwadransa 7: sprzątanie ma 5 minut, kasa 0
    expect(hold.get(1)).toBe('sprzatanie');
  });
});

describe('TaskHold: niedopuszczalne wejścia', () => {
  it('NaN i Infinity w minucie albo czasie nie zmieniają niczego', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('kasa'));
    hold.update(Number.NaN, 5, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wolny' }]);
    hold.update(5, Number.NaN, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wolny' }]);
    hold.update(Infinity, 5, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wolny' }]);
    hold.update(-Infinity, 5, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wolny' }]);
    hold.update(5, Infinity, [{ id: 1, task: 'sprzatanie' }, { id: 2, task: 'wolny' }]);
    hold.update(5, -Infinity, []);
    expect(hold.get(1)).toBe('kasa');                 // nikt nie wypadł i nic się nie zmieniło
    expect(hold.get(2)).toBeUndefined();              // nowa osoba nie wpadła z błędnego wywołania
  });

  it('błędne wywołanie nie psuje poprzedniej minuty ani głosów i nie liczy się jako głos', () => {
    const hold = new TaskHold();
    hold.update(0, 0, one('wolny'));
    hold.update(5, 5, one('kasa'));                    // kasa 5
    hold.update(14, Number.NaN, one('rozladunek'));    // zignorowane w całości: gdyby liczyło się, rozładunek miałby 9
    hold.update(15, 15, one('sprzatanie'));            // sprzątanie 10 (od minuty 5) vs kasa 5
    expect(hold.get(1)).toBe('sprzatanie');
  });

  it('błędne pierwsze wywołanie nie zakłada osi czasu', () => {
    const hold = new TaskHold();
    hold.update(Number.NaN, 0, one('kasa'));
    expect(hold.get(1)).toBeUndefined();
    hold.update(50, 0, one('rozladunek'));
    expect(hold.get(1)).toBe('rozladunek');
  });
});

describe('TaskHold.reset', () => {
  it('czyści wszystkich i oś czasu', () => {
    const hold = new TaskHold();
    hold.update(100, 0, [{ id: 1, task: 'kasa' }, { id: 2, task: 'wolny' }]);
    hold.reset();
    expect(hold.get(1)).toBeUndefined();
    expect(hold.get(2)).toBeUndefined();
    hold.update(3, 1, one('sprzatanie'));       // minuta „wcześniejsza” niż przed resetem: bez błędu, nowa osoba
    expect(hold.get(1)).toBe('sprzatanie');
  });
});
