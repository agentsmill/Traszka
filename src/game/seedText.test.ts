import { describe, expect, it } from 'vitest';
import { createRng } from '@/sim/rng';
import { SEED_MAX, normalizeSeed } from './seeds';
import { isShowableSeed, stripHiddenSeedChars } from './seedText';

// Testy opisują, jaki tekst jest seedem do pokazania w rankingu, bez zaglądania do definicji w seedText.ts: znaki zapisane liczbami,
// flagi złożone ze znaczników tutaj, nie z tamtych stałych. Jedna definicja ma obsługiwać grę (czyszczenie) i serwer (odrzucanie).

const range = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i));
/** Litery ASCII zapisane znacznikami (U+E0020–U+E007E): „g” to U+E0067. */
const tags = (letters: string): string => Array.from(letters, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
/** Flaga podziału z Unicode: czarna flaga, kod zapisany znacznikami, znacznik końca (U+E007F). */
const flag = (code: string): string => `\u{1f3f4}${tags(code)}\u{e007f}`;
const hex = (s: string): string => Array.from(s).slice(0, 14).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

const ENGLAND = flag('gbeng');
const SCOTLAND = flag('gbsct');
const WALES = flag('gbwls');
const FAMILY = '👨\u{200d}👩\u{200d}👧';

/**
 * Pojedyncze znaki, których nie widać (formatujące Cf), puste litery albo które służą do ukrywania tekstu (cały blok znaczników
 * i selektory wariantów dodatkowe). Korpus z zadania i z rundy poprawek 1 (druga linia od `\u{034f}`).
 */
const HIDDEN_CHARS: string[] = [
  '\u{00ad}', '\u{061c}', '\u{180e}', ...range(0x200b, 0x200f), ...range(0x202a, 0x202e), ...range(0x2060, 0x2064), ...range(0x2066, 0x206f),
  '\u{feff}', ...range(0xfff9, 0xfffb), ...range(0x600, 0x605), '\u{06dd}', '\u{070f}', '\u{110bd}', ...range(0x1d173, 0x1d17a), ...range(0x1bca0, 0x1bca3),
  '\u{034f}', ...range(0x115f, 0x1160), ...range(0x17b4, 0x17b5), ...range(0x180b, 0x180f), '\u{2065}', '\u{3164}', ...range(0xfe00, 0xfe0e), '\u{ffa0}',
  ...range(0xfff0, 0xfff8), ...range(0xe0000, 0xe0fff),
];

/** Dłuższe sekwencje i znaki z innych powodów kłopotliwe: okaleczone flagi, ZWJ, surogaty, sterujące, spacje, same niewidoczne. */
const TRICKY: Array<[name: string, text: string]> = [
  ['flaga Anglii', ENGLAND], ['flaga Szkocji', SCOTLAND], ['flaga Walii', WALES],
  ['flaga z obcą sekwencją (gbxxx)', flag('gbxxx')], ['flaga Teksasu (RGI, ale poza białą listą)', flag('ustx')], ['flaga wielkimi literami', flag('GBENG')],
  ['flaga bez znacznika końca', `\u{1f3f4}${tags('gbeng')}`], ['flaga urwana w połowie kodu', `\u{1f3f4}${tags('gbe')}`],
  ['flaga z dopisaną literą', `\u{1f3f4}${tags('gbengx')}\u{e007f}`], ['flaga ze znacznikiem końca w środku', `\u{1f3f4}${tags('gb')}\u{e007f}${tags('eng')}\u{e007f}`],
  ['flaga i drugi znacznik końca', `${ENGLAND}\u{e007f}`], ['trzy flagi pod rząd', ENGLAND + SCOTLAND + WALES],
  ['znaczniki bez czarnej flagi', `${tags('gbeng')}\u{e007f}`], ['tekst ukryty znacznikami', tags('tajna wiadomosc')],
  ['znaczniki po innym emoji', `🍕${tags('gbeng')}\u{e007f}`], ['sama czarna flaga', '\u{1f3f4}'],
  ['rodzina emoji (ZWJ między emoji)', FAMILY], ['osamotniony ZWJ', '\u{200d}'], ['ZWJ pod rząd', '\u{200d}\u{200d}\u{200d}'], ['pirat (ZWJ po czarnej fladze)', '\u{1f3f4}\u{200d}☠\u{fe0f}'],
  ['wysoki surogat', '\ud83d'], ['niski surogat', '\ude00'], ['surogaty w odwrotnej kolejności', '\ude00\ud83d'], ['dwa wysokie surogaty', '\ud83d\ud83d'],
  ['NUL', '\0'], ['tabulator', '\t'], ['nowy wiersz', '\n'], ['powrót karetki', '\r'], ['DEL', '\u007f'], ['NEL (U+0085)', '\u0085'],
  ['U+2028', '\u{2028}'], ['U+2029', '\u{2029}'], ['spacja niełamliwa', '\u{00a0}'], ['spacja ideograficzna', '\u{3000}'], ['spacja em', '\u{2003}'],
  ['same znaki niewidoczne', '\u{200b}\u{00ad}\u{2060}\u{feff}\u{202e}\u{e0067}\u{200d}'], ['same znaki niewidoczne i spacje', ' \u{200b} \u{00ad} \u{3000}'],
  ['puste litery i selektory wariantów', '\u{3164}\u{ffa0}\u{115f}\u{1160}\u{fe00}\u{fe0e}\u{e0100}\u{e01ef}'],
  // ⓜ (po zamianie na małe litery) nie jest już emoji, więc ZWJ obok niego trzeba zdjąć dopiero po zamianie wielkości liter
  ['Ⓜ ZWJ 👩 (wielka litera jest emoji, mała nie)', '\u{24c2}\u{200d}\u{1f469}'], ['👩 ZWJ Ⓜ', '\u{1f469}\u{200d}\u{24c2}'],
];

const CASES: Array<[name: string, text: string]> = [...HIDDEN_CHARS.map((c): [string, string] => [hex(c), c]), ...TRICKY];

/** Każdy znak z korpusu w wielu położeniach: sam, na początku, w środku, na końcu, powtórzony, po odcinku emoji, w parze z ZWJ, na granicy limitu. */
const placements = (c: string): string[] => [
  c, `${c}pierogi`, `pie${c}rogi`, `pierogi${c}`, c.repeat(6), `pie${c.repeat(3)}rogi`, ` ${c} `, `a ${c} b`,
  `🍕${c}`, `🍕${c}🍕`, `${c}🍕`, `${c}\u{200d}`, `\u{200d}${c}`, `👩${c}\u{200d}💻`, `👩\u{200d}${c}💻`, `${FAMILY}${c}${FAMILY}`,
  `${'a'.repeat(39)}${c}`, `${'a'.repeat(38)}${c}ab`, `${'a'.repeat(34)}${c}`,
];

const DRAW = (): string => 'pierogi-731';

describe('seed z gry zawsze przechodzi walidator, który stosuje serwer (jedna definicja czyszczenia i odrzucania)', () => {
  it('każdy trudny znak z korpusu, w każdym położeniu: po normalizeSeed seed da się pokazać i mieści się w limicie gry', () => {
    let checked = 0;
    for (const [name, c] of CASES) {
      for (const raw of placements(c)) {
        const seed = normalizeSeed(raw, DRAW);
        expect(isShowableSeed(seed, SEED_MAX), `${name}: ${hex(raw)} → ${hex(seed)}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(CASES.length * placements('x').length);
    expect(checked).toBeGreaterThan(80000);
  });

  it('losowe napisy z korpusu, liter, spacji i emoji (kilka tysięcy, ustalone ziarno): to samo, a normalizacja jest idempotentna', () => {
    const rng = createRng('seedText-property');
    const plain = ['a', 'B', 'ż', 'Ł', ' ', ' ', '-', '9', '·', '🍕', '👩', '💻', '🏽', '\u{fe0f}', '\u{0301}', '\u{200d}', '\u{200d}', '\u{1f3f4}'];
    const tricky = [...CASES.map(([, text]) => text), ENGLAND, SCOTLAND, WALES, ENGLAND, SCOTLAND, WALES];
    const token = (): string => (rng.chance(0.5) ? rng.pick(plain) : rng.pick(tricky));   // połowa to zwykłe znaki, korpus (z blokiem 4096 znaczników) nie zagłusza reszty
    for (let i = 0; i < 6000; i++) {
      const raw = Array.from({ length: rng.int(0, 31) }, token).join('');
      const seed = normalizeSeed(raw, DRAW);
      expect(isShowableSeed(seed, SEED_MAX), `${hex(raw)} → ${hex(seed)}`).toBe(true);
      expect(normalizeSeed(seed, DRAW), `idempotencja: ${hex(raw)}`).toBe(seed);
      expect(stripHiddenSeedChars(stripHiddenSeedChars(raw)), `strip idempotentny: ${hex(raw)}`).toBe(stripHiddenSeedChars(raw));
    }
  });

  it('flagi powtórzone tak, że granica 40 znaków wypada w każdym miejscu sekwencji: nic okaleczonego nie zostaje', () => {
    const flags = [ENGLAND, SCOTLAND, WALES, flag('gbxxx'), `${ENGLAND}\u{200d}`];
    for (const f of flags) {
      for (let lead = 0; lead <= 45; lead++) {
        for (const count of [1, 2, 3, 6, 9]) {
          const raw = `${'a'.repeat(lead)}${f.repeat(count)}`;
          const seed = normalizeSeed(raw, DRAW);
          expect(isShowableSeed(seed, SEED_MAX), `${lead} × a, ${count} × ${hex(f)}`).toBe(true);
          expect(normalizeSeed(seed, DRAW)).toBe(seed);
        }
      }
    }
  });

  it('obcięcie w środku flagi zostawia samą czarną flagę, a nie urwane znaczniki; flaga, która się mieści, zostaje cała', () => {
    expect(normalizeSeed(`${'a'.repeat(33)}${ENGLAND}`, DRAW)).toBe(`${'a'.repeat(33)}${ENGLAND}`);          // 33 + 7 = 40
    expect(normalizeSeed(`${'a'.repeat(34)}${ENGLAND}`, DRAW)).toBe(`${'a'.repeat(34)}\u{1f3f4}`);
    expect(normalizeSeed(`${'a'.repeat(39)}${WALES}`, DRAW)).toBe(`${'a'.repeat(39)}\u{1f3f4}`);
    expect(normalizeSeed(`${'a'.repeat(39)}👩\u{200d}💻`, DRAW)).toBe('a'.repeat(39) + '👩');                  // jak dotąd: bez ZWJ na końcu
  });
});

describe('normalizeSeed: znaki formatujące i znaczniki zdejmowane, flagi z Unicode zostają', () => {
  it('wszystkie znaki formatujące, także te, których gra dotąd nie wymieniała (miękki łącznik, znak arabski, operatory niewidoczne)', () => {
    expect(normalizeSeed('pie\u{00ad}rogi', DRAW)).toBe('pierogi');
    expect(normalizeSeed('pie\u{061c}rogi', DRAW)).toBe('pierogi');
    expect(normalizeSeed('pie\u{180e}rogi', DRAW)).toBe('pierogi');
    expect(normalizeSeed('pie\u{2062}\u{2063}\u{2064}rogi', DRAW)).toBe('pierogi');
    expect(normalizeSeed('\u{0600}\u{0601}pierogi\u{110bd}\u{1d173}', DRAW)).toBe('pierogi');
    expect(normalizeSeed('pierogi\u{fff9}\u{fffa}\u{fffb}', DRAW)).toBe('pierogi');
  });

  it('flagi Anglii, Szkocji i Walii zostają w całości (małe litery nie ruszają znaczników)', () => {
    expect(normalizeSeed(`Moja ${ENGLAND} FLAGA`, DRAW)).toBe(`moja ${ENGLAND} flaga`);
    expect(normalizeSeed(SCOTLAND + WALES, DRAW)).toBe(SCOTLAND + WALES);
    expect(normalizeSeed(`${ENGLAND}-1`, DRAW)).toBe(`${ENGLAND}-1`);
  });

  it('każdy inny znacznik znika: obca flaga to sama czarna flaga, tekst ukryty znacznikami to jawny tekst bez ukrytego', () => {
    expect(normalizeSeed(flag('gbxxx'), DRAW)).toBe('\u{1f3f4}');
    expect(normalizeSeed(flag('ustx'), DRAW)).toBe('\u{1f3f4}');
    expect(normalizeSeed(flag('GBENG'), DRAW)).toBe('\u{1f3f4}');
    expect(normalizeSeed(`hej${tags('tajna wiadomosc')}`, DRAW)).toBe('hej');
    expect(normalizeSeed(`🍕${ENGLAND}`, DRAW)).toBe(`🍕${ENGLAND}`);                                       // flaga po innym emoji to nadal flaga
    expect(normalizeSeed(`a${tags('gbeng')}\u{e007f}b`, DRAW)).toBe('ab');                                // znaczniki bez czarnej flagi
    expect(normalizeSeed(`\u{1f3f4}${tags('gbeng')}`, DRAW)).toBe('\u{1f3f4}');                          // bez znacznika końca
    expect(normalizeSeed(`${ENGLAND}\u{e007f}`, DRAW)).toBe(ENGLAND);                                     // nadmiarowy znacznik końca
  });

  it('znak niewidoczny wewnątrz flagi psuje ją: zostaje czarna flaga (nie da się ukryć drugiego tekstu w środku sekwencji)', () => {
    const [head, ...rest] = Array.from(ENGLAND);
    expect(normalizeSeed(`${head}\u{200b}${rest.join('')}`, DRAW)).toBe(head);
  });

  it('znak niewidoczny między emoji nie przeszkadza spójnikowi, a osamotniony spójnik znika', () => {
    expect(normalizeSeed('👩\u{00ad}\u{200d}\u{200b}💻', DRAW)).toBe('👩\u{200d}💻');
    expect(normalizeSeed(`a\u{200d}b${FAMILY}\u{200d}`, DRAW)).toBe(`ab${FAMILY}`);
    expect(normalizeSeed('\u{200d}\u{200d}', DRAW)).toBe('pierogi-731');
  });

  it('ZWJ między emoji, z których jedno po zamianie na małe litery przestaje być emoji (Ⓜ → ⓜ), znika: ostatnie czyszczenie jest po zamianie wielkości liter', () => {
    expect(normalizeSeed('\u{24c2}\u{200d}\u{1f469}', DRAW)).toBe('\u{24dc}\u{1f469}');
    expect(normalizeSeed('\u{1f469}\u{200d}\u{24c2}', DRAW)).toBe('\u{1f469}\u{24dc}');
  });

  it('selektor wariantu emoji U+FE0F zostaje, a inne selektory wariantów, wypełniacze Hangul i znaki z bloku do U+E0FFF znikają; flagi zostają', () => {
    expect(normalizeSeed('\u{2764}\u{fe0f}\u{fe0e}\u{3164}\u{ffa0}\u{e0100}', DRAW)).toBe('\u{2764}\u{fe0f}');
    expect(normalizeSeed('\u{2764}\u{fe0f}\u{200d}\u{1f525}', DRAW)).toBe('\u{2764}\u{fe0f}\u{200d}\u{1f525}');
    expect(normalizeSeed(`Flaga ${ENGLAND}\u{e0100}\u{e01ef}`, DRAW)).toBe(`flaga ${ENGLAND}`);
    expect(normalizeSeed(`${SCOTLAND}\u{3164}${WALES}`, DRAW)).toBe(SCOTLAND + WALES);
    expect(normalizeSeed(`\u{1f3f4}\u{e0100}${tags('gbeng')}\u{e007f}`, DRAW)).toBe('\u{1f3f4}');   // znak w środku flagi psuje ją, jak każdy inny
    expect(normalizeSeed('pie\u{034f}\u{17b4}\u{17b5}\u{180b}\u{115f}\u{1160}\u{2065}\u{fff0}\u{fff8}rogi', DRAW)).toBe('pierogi');
  });

  it('ten sam napis ze znakami niewidocznymi i bez nich to ten sam seed', () => {
    expect(normalizeSeed(`\u{00ad}Moja\u{2062} PIZZA${tags('x')}\u{fff9}`, DRAW)).toBe(normalizeSeed('Moja PIZZA', DRAW));
  });
});

describe('isShowableSeed: niedozwolone znaki w surowym tekście (tego, co przysyła klient, nikt nie czyści)', () => {
  it('każdy znak niewidoczny z korpusu odrzuca seed: sam, na początku, w środku i na końcu', () => {
    for (const c of HIDDEN_CHARS) {
      for (const raw of [c, `${c}pierogi`, `pie${c}rogi`, `pierogi${c}`, `${c}${c}`]) expect(isShowableSeed(raw), hex(raw)).toBe(false);
    }
  });

  it('U+FE0F zostaje (emoji z selektorem wariantu przechodzi), a U+FE0E, U+E0100 i U+3164 nie; trzy flagi RGI nadal przechodzą', () => {
    for (const raw of ['\u{2764}\u{fe0f}', '\u{2764}\u{fe0f}\u{200d}\u{1f525}', '\u{263a}\u{fe0f} kawa', ENGLAND, SCOTLAND, WALES, `x${ENGLAND}y${WALES}`]) {
      expect(isShowableSeed(raw), hex(raw)).toBe(true);
    }
    const bad = [
      '\u{fe0e}', '\u{2764}\u{fe0e}', '\u{263a}\u{fe0e}', '\u{fe00}', '\u{e0100}', 'a\u{e0100}b', '\u{e01ef}', '\u{e0fff}', '\u{3164}', 'pie\u{3164}rogi', 'pie\u{ffa0}rogi',
      'a\u{034f}b', 'a\u{115f}b', 'a\u{1160}b', 'a\u{17b4}b', 'a\u{17b5}b', 'a\u{180b}b', 'a\u{180f}b', 'a\u{2065}b', 'a\u{fff0}b', 'a\u{fff8}b',
      `${ENGLAND}\u{e0100}`, `\u{1f3f4}\u{e0100}${tags('gbeng')}\u{e007f}`, `${WALES}\u{3164}`,
    ];
    for (const raw of bad) expect(isShowableSeed(raw), hex(raw)).toBe(false);
    expect(isShowableSeed('a\u{2800}b')).toBe(true);        // Braille zostaje (poza zakresem, opisane w nagłówku seedText.ts)
  });

  it('znaki sterujące i separatory wierszy (też w środku): odrzucone', () => {
    for (const c of ['\0', '\t', '\n', '\r', '\v', '\f', '\u001f', '\u007f', '\u0085', '\u{2028}', '\u{2029}']) {
      expect(isShowableSeed(`pie${c}rogi`), hex(c)).toBe(false);
      expect(isShowableSeed(c), hex(c)).toBe(false);
    }
  });

  it('osamotnione surogaty (nie da się ich zapisać w adresie): odrzucone, a poprawna para (emoji) przechodzi', () => {
    for (const raw of ['\ud83d', '\ude00', 'pie\ud83drogi', 'pie\ude00rogi', '\ude00\ud83d', '🍕\ud83d', '\ud83d🍕', '\ud83d\ud83d']) {
      expect(isShowableSeed(raw), hex(raw)).toBe(false);
    }
    expect(isShowableSeed('🍕')).toBe(true);
    expect(isShowableSeed('😀')).toBe(true);
  });

  it('flagi Anglii, Szkocji i Walii w całości: przechodzą (sama, w tekście, kilka pod rząd)', () => {
    for (const raw of [ENGLAND, SCOTLAND, WALES, `moja ${ENGLAND} flaga`, `${ENGLAND}-1`, ENGLAND + SCOTLAND + WALES, `x${WALES}`]) {
      expect(isShowableSeed(raw), hex(raw)).toBe(true);
    }
  });

  it('okaleczone i obce flagi oraz znaczniki bez czarnej flagi: odrzucone', () => {
    const bad = [
      flag('gbxxx'), flag('ustx'), flag('GBENG'), `\u{1f3f4}${tags('gbeng')}`, `\u{1f3f4}${tags('gbe')}\u{e007f}`,
      `\u{1f3f4}${tags('gbengx')}\u{e007f}`, `${ENGLAND}\u{e007f}`, `${tags('gbeng')}\u{e007f}`, `a${tags('gbeng')}\u{e007f}`, `🍕${tags('gbeng')}\u{e007f}`,
      `\u{1f3f4}\u{e007f}`, `\u{1f3f4}\u{200b}${tags('gbeng')}\u{e007f}`, `\u{1f3f4}${tags('gb')}\u{200b}${tags('eng')}\u{e007f}`, tags('tajna wiadomosc'), `hej${tags('x')}`,
      `${ENGLAND}${tags('x')}`, `\u{e0001}${ENGLAND}`, `${ENGLAND}\u{e0000}`,
    ];
    for (const raw of bad) expect(isShowableSeed(raw), hex(raw)).toBe(false);
    expect(isShowableSeed('\u{1f3f4}')).toBe(true);          // sama czarna flaga to zwykłe emoji
  });

  it('ZWJ tylko między emoji: rodzina i zawód przechodzą, luzem, między literami i na brzegach nie (także na serwerze)', () => {
    for (const raw of [FAMILY, '👩\u{200d}💻', '👩🏽\u{200d}💻', '❤\u{fe0f}\u{200d}🔥', '\u{1f3f4}\u{200d}☠\u{fe0f}']) expect(isShowableSeed(raw), hex(raw)).toBe(true);
    for (const raw of ['\u{200d}', 'a\u{200d}b', 'a\u{200d}👩', '👩\u{200d}a', '👩\u{200d}', '\u{200d}👩', '👩\u{200d}\u{200d}💻', ' \u{200d} ', `${ENGLAND}\u{200d}👩`]) {
      expect(isShowableSeed(raw), hex(raw)).toBe(false);
    }
  });

  it('niepusty, bez spacji na brzegach; spacja w środku jest w porządku', () => {
    expect(isShowableSeed('')).toBe(false);
    for (const raw of [' ', ' pierogi', 'pierogi ', ' pierogi ', '\u{00a0}pierogi', 'pierogi\u{3000}']) expect(isShowableSeed(raw), hex(raw)).toBe(false);
    expect(isShowableSeed('moja pizza')).toBe(true);
  });

  it('długość: bez limitu nie jest sprawdzana, z limitem liczą się punkty kodowe (emoji to jeden znak), a limit jest włącznie', () => {
    expect(isShowableSeed('x'.repeat(5000))).toBe(true);
    expect(isShowableSeed('x'.repeat(48), 48)).toBe(true);
    expect(isShowableSeed('x'.repeat(49), 48)).toBe(false);
    expect(isShowableSeed('🍕'.repeat(48), 48)).toBe(true);     // 96 jednostek UTF-16, 48 znaków
    expect(isShowableSeed('🍕'.repeat(49), 48)).toBe(false);
    expect(isShowableSeed(ENGLAND, 7)).toBe(true);              // flaga to siedem punktów kodowych
    expect(isShowableSeed(ENGLAND, 6)).toBe(false);
  });

  it('zwykłe seedy z gry i z pola: słowo-liczba, polskie litery, sąsiedni lokal, emoji ze spójnikiem', () => {
    for (const raw of ['pierogi-731', 'kiełbasa-42', 'pierogi-731·2', 'Moja Pizza', '🍕', '👩\u{200d}🍳 kuchnia', 'ab\u{0301}c', '日本語', 'x'.repeat(48)]) {
      expect(isShowableSeed(raw, 48), hex(raw)).toBe(true);
    }
  });
});

describe('stripHiddenSeedChars: co znika, co zostaje', () => {
  it('odstępy, które nie wolno pokazać (tabulator, nowy wiersz, separatory wierszy i akapitów), stają się spacją; reszta sterujących znika', () => {
    for (const c of ['\t', '\n', '\v', '\f', '\r', '\u{2028}', '\u{2029}']) expect(stripHiddenSeedChars(`a${c}b`), hex(c)).toBe('a b');
    for (const c of ['\0', '\u0007', '\u001f', '\u007f', '\u0085', '\u009f']) expect(stripHiddenSeedChars(`a${c}b`), hex(c)).toBe('ab');
  });

  it('znak formatujący, który jest dla \\s spacją (BOM), znika, a nie zamienia się w spację', () => {
    expect(stripHiddenSeedChars('a\u{feff}b')).toBe('ab');
    expect(stripHiddenSeedChars('\u{feff}a')).toBe('a');
  });

  it('zostawia litery, cyfry, zwykłe spacje, NBSP, emoji, selektor wariantu, odcienie skóry i cały tekst bez ukrytych znaków', () => {
    for (const raw of ['pierogi-731', 'Moja  Pizza', 'a\u{00a0}b', '🍕', '❤\u{fe0f}', '👩🏽', 'ab\u{0301}c', ENGLAND, FAMILY, '日本語']) expect(stripHiddenSeedChars(raw), hex(raw)).toBe(raw);
  });

  it('jest idempotentne i nie dotyka tekstu, który już nic ukrytego nie ma (to samo daje walidatorowi odpowiedź tak)', () => {
    for (const [name, c] of CASES) {
      for (const raw of placements(c)) {
        const once = stripHiddenSeedChars(raw);
        expect(stripHiddenSeedChars(once), `${name}: ${hex(raw)}`).toBe(once);
      }
    }
  });
});
