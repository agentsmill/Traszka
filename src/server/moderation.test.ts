import { describe, expect, it } from 'vitest';
import { BANNED_ROOTS } from './bannedWords';
import { isBanned, skeleton } from './moderation';

describe('szkielet tekstu do porównań z listą zakazanych słów', () => {
  it('małe litery, bez polskich znaków i akcentów, bez separatorów, cyfry i znaki „leet” jako litery', () => {
    expect(skeleton('Żółć Gęślą Jaźń')).toBe('zolcgeslajazn');
    expect(skeleton('K.u-r_w a')).toBe('kurwa');
    expect(skeleton('$h1T')).toBe('shit');
    expect(skeleton('4dm1n')).toBe('admin');
    expect(skeleton('Łódź')).toBe('lodz');
    expect(skeleton('Ｋｕｒｗａ')).toBe('kurwa');
    expect(skeleton('🍕pizza🍕')).toBe('pizza');
  });
});

describe('zakazane słowa w nickach i seedach (ponad reguły nicka)', () => {
  it('przekleństwa przechodzą przez wielkość liter, separatory, diakrytyki, „leet” i powtórzenia', () => {
    for (const bad of ['kurwa', 'KURWA', 'K u r w a', 'k.u.r.w.a', 'kuuurwa', 'Kurvа', 'qrwa', 'kurwa-123', 'JEBAĆ', 'ch_u_j', 'Pi3rd0l3c', 'h00j'.replace('00', 'u')]) {
      expect(isBanned(bad), bad).toBe(true);
    }
  });

  it('podszywanie się pod obsługę gry i Centralę też odpada (nazwy zarezerwowane są w nick.ts, tu wszystko, co je zawiera)', () => {
    for (const bad of ['Admin123', 'Moderator_Gry', 'CentralaOficjalnie', 'Traszka Official', 'oficjalny-sklep']) {
      expect(isBanned(bad), bad).toBe(true);
    }
  });

  it('zwykłe nicki i seedy przechodzą', () => {
    for (const ok of ['Mateusz', 'Kasia_99', 'pierogi-731', 'kiełbasa-42', 'Zuzanna', 'Szmaragd', 'Ciotka Basia', 'Hubert', 'Kurek', 'Traszkowiec', 'Jan Kowalski', 'Łukasz', 'zapiekanka·2', 'Niger']) {
      expect(isBanned(ok), ok).toBe(false);
    }
  });

  it('lista ma same szkielety (inaczej słowo nigdy by nie pasowało)', () => {
    for (const root of BANNED_ROOTS) expect(skeleton(root), root).toBe(root);
    expect(new Set(BANNED_ROOTS).size).toBe(BANNED_ROOTS.length);
  });
});
