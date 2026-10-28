import { describe, expect, it } from 'vitest';
import { NICK_ERRORS, NICK_MAX, RESERVED_NICKS, nickKey, normalizeNick } from './nick';

const ok = (raw: string): string => {
  const r = normalizeNick(raw);
  if (!('nick' in r)) throw new Error(`oczekiwano nicku, jest błąd: ${r.error} (${JSON.stringify(raw)})`);
  return r.nick;
};
const bad = (raw: string): string => {
  const r = normalizeNick(raw);
  if (!('error' in r)) throw new Error(`oczekiwano błędu, jest nick: ${r.nick} (${JSON.stringify(raw)})`);
  return r.error;
};

describe('normalizeNick: kształt wyniku i komunikaty', () => {
  it('poprawny nick to samo { nick }, błąd to samo { error } (serwer rankingu użyje tej samej funkcji)', () => {
    expect(normalizeNick('Mateusz')).toEqual({ nick: 'Mateusz' });
    expect(normalizeNick('')).toEqual({ error: 'Nazwa może mieć od 1 do 20 znaków' });
    expect(NICK_ERRORS).toEqual({
      length: 'Nazwa może mieć od 1 do 20 znaków',
      chars: 'Dozwolone są litery, cyfry, spacja i znaki _ - .',
      reserved: 'Ta nazwa jest zarezerwowana',
    });
    expect(NICK_MAX).toBe(20);
  });
});

describe('normalizeNick: przycięcie, spacje i wielkość liter', () => {
  it('przycina brzegi i zwija spacje (także tabulatory i nowe wiersze), wielkość liter zostaje do wyświetlania', () => {
    expect(ok('  Mateusz   Paw  ')).toBe('Mateusz Paw');
    expect(ok('Ala\tma\nkota')).toBe('Ala ma kota');
    expect(ok('MaTeuSz')).toBe('MaTeuSz');
  });

  it('spacje zwijają się przed liczeniem długości: długi odstęp nie robi z krótkiego nicku za długiego', () => {
    expect(ok(`a${' '.repeat(40)}b`)).toBe('a b');
  });

  it('same spacje to pusty nick', () => {
    expect(bad('   ')).toBe(NICK_ERRORS.length);
    expect(bad('\t\n ')).toBe(NICK_ERRORS.length);
  });
});

describe('normalizeNick: dozwolone znaki', () => {
  it('litery łacińskie, polskie (małe i wielkie), cyfry, spacja i _ - . przechodzą', () => {
    expect(ok('Zażółć gęślą jaźń')).toBe('Zażółć gęślą jaźń');
    expect(ok('ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż')).toBe('ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż');
    expect(ok('abcXYZ 0123456789')).toBe('abcXYZ 0123456789');
    expect(ok('a_b-c.d')).toBe('a_b-c.d');
    expect(ok('_-.')).toBe('_-.');
  });

  it('emoji nie przechodzą (też pojedyncze, w środku i na końcu)', () => {
    for (const raw of ['🍕', 'Pizza🍕', '🍕 Pizza', 'a😀b', '👨‍👩‍👧', '❤']) expect(bad(raw), raw).toBe(NICK_ERRORS.chars);
  });

  it('„Mateusz” z cyrylickim „а” nie podszyje się pod oryginał', () => {
    const cyrillic = 'Mateusz'.replace('a', 'а');
    expect(cyrillic).not.toBe('Mateusz');
    expect(bad(cyrillic)).toBe(NICK_ERRORS.chars);
    expect(bad('Matеusz')).toBe(NICK_ERRORS.chars);   // cyrylickie „е”
    expect(bad('Αlfa')).toBe(NICK_ERRORS.chars);       // greckie „Α”
  });

  it('litery spoza łaciny z polskimi i znaki sterujące albo niewidzialne są odrzucone', () => {
    for (const raw of ['José', 'Müller', 'Ça', 'a/b', 'a@b', 'a!', '(x)', 'a,b', 'a\u0000b', 'a​b', 'a‮b']) {
      expect(bad(raw), JSON.stringify(raw)).toBe(NICK_ERRORS.chars);
    }
  });
});

describe('normalizeNick: NFKC', () => {
  it('pełnoszerokie „Ｍ” daje zwykłą literę, ligatura rozwija się do liter', () => {
    expect(ok('Ｍateusz')).toBe('Mateusz');
    expect(ok('Ａｌａ')).toBe('Ala');
    expect(ok('oﬁs')).toBe('ofis');   // ligatura „ﬁ” → „fi”
  });

  it('akcent złożony z dwóch znaków składa się w polską literę', () => {
    expect(ok('Zóra')).toBe('Zóra');   // „o” + akcent → „ó”
  });

  it('długość liczy się po NFKC: rozwinięcie ponad 20 znaków to za długi nick', () => {
    expect(bad('ﬁ'.repeat(11))).toBe(NICK_ERRORS.length);   // 11 ligatur = 22 litery
    expect(ok('ﬁ'.repeat(10))).toBe('fi'.repeat(10));
  });

  it('pełnoszerokie i nierozdzielne spacje to zwykłe spacje', () => {
    expect(ok('Ala　ma kota')).toBe('Ala ma kota');
  });
});

describe('normalizeNick: długość 1–20 po normalizacji', () => {
  it('1 i 20 znaków przechodzą, 21 nie', () => {
    expect(ok('a')).toBe('a');
    expect(ok('a'.repeat(20))).toBe('a'.repeat(20));
    expect(bad('a'.repeat(21))).toBe(NICK_ERRORS.length);
    expect(bad('a'.repeat(500))).toBe(NICK_ERRORS.length);
  });

  it('puste to błąd długości', () => {
    expect(bad('')).toBe(NICK_ERRORS.length);
  });

  it('dwadzieścia znaków z polskimi literami też mieści się w 20 (znak to znak, nie bajt)', () => {
    expect(ok('ąćęłńóśźż'.repeat(2) + 'ab')).toHaveLength(20);
    expect(bad('ąćęłńóśźż'.repeat(2) + 'abc')).toBe(NICK_ERRORS.length);
  });

  it('znaki spoza dozwolonych wygrywają z długością, żeby gracz dostał poprawną wskazówkę', () => {
    expect(bad('a'.repeat(30) + '🍕')).toBe(NICK_ERRORS.chars);
  });
});

describe('normalizeNick: nazwy zarezerwowane', () => {
  it('Centrala, Traszka, Admin, Administrator, Moderator, System: bez względu na wielkość liter', () => {
    expect(RESERVED_NICKS).toEqual(['centrala', 'traszka', 'admin', 'administrator', 'moderator', 'system']);
    for (const name of RESERVED_NICKS) {
      for (const variant of [name, name.toUpperCase(), name[0]!.toUpperCase() + name.slice(1), name.toUpperCase().toLowerCase()]) {
        expect(bad(variant), variant).toBe(NICK_ERRORS.reserved);
      }
    }
    expect(bad('CENTRALA')).toBe(NICK_ERRORS.reserved);
  });

  it('rezerwacja działa po normalizacji: spacje na brzegach i pełnoszerokie litery nie pomagają', () => {
    expect(bad('  Traszka  ')).toBe(NICK_ERRORS.reserved);
    expect(bad('ＣＥＮＴＲＡＬＡ')).toBe(NICK_ERRORS.reserved);   // pełnoszerokie „CENTRALA”
  });

  it('nick tylko zawierający zarezerwowane słowo przechodzi', () => {
    for (const raw of ['Centrala2', 'Mój system', 'Traszka Fan', 'adm1n', 'Administrator_', 'sys tem']) expect(ok(raw), raw).toBe(raw);
  });
});

describe('nickKey: klucz porównań', () => {
  it('małe litery (także polskie), więc „Łukasz” i „łUKASZ” to jeden nick', () => {
    expect(nickKey('Zażółć')).toBe('zażółć');
    expect(nickKey('ŁUKASZ')).toBe(nickKey('łukasz'));
    expect(nickKey('Mateusz')).toBe('mateusz');
  });

  it('ten sam klucz dla zapisu pełnoszerokiego i zwykłego, ze zwiniętymi spacjami', () => {
    expect(nickKey('Ｍateusz')).toBe(nickKey('MATEUSZ'));
    expect(nickKey('  Ala   ma  ')).toBe('ala ma');
  });

  it('idempotentny, a klucz poprawnego nicku nie przestaje być poprawnym nickiem', () => {
    for (const raw of ['Mateusz', 'Zażółć gęślą', 'A_b-c.d 9', 'Ｍateusz']) {
      const nick = ok(raw);
      expect(nickKey(nickKey(nick))).toBe(nickKey(nick));
      expect(normalizeNick(nickKey(nick))).toEqual({ nick: nickKey(nick) });
    }
  });

  it('„Mateusz” z cyrylicą ma inny klucz niż oryginał (a i tak nie przejdzie walidacji)', () => {
    expect(nickKey('Mateusz'.replace('a', 'а'))).not.toBe(nickKey('Mateusz'));
  });
});
