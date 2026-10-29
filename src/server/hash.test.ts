import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex } from './hash';

describe('hmacSha256Hex: HMAC-SHA256 jako 64 znaki szesnastkowe', () => {
  it('zgadza się z wektorami testowymi z RFC 4231 (przypadek 1 i 2) i z implementacją Node', async () => {
    expect(await hmacSha256Hex('\u{0B}'.repeat(20), 'Hi There')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    const secret = 'sekret-do-testu-0123456789';
    const text = 'traszka:limit:runs:3600:498108:203.0.113.7';
    expect(await hmacSha256Hex(secret, text)).toBe(createHmac('sha256', secret).update(text).digest('hex'));
  });

  it('inny sekret albo inny tekst daje inny skrót, ten sam sekret i tekst zawsze ten sam; to nie jest zwykły SHA-256 sklejonego tekstu', async () => {
    const [a, b, c] = [await hmacSha256Hex('sekret-A-0123456789', 'x'), await hmacSha256Hex('sekret-B-0123456789', 'x'), await hmacSha256Hex('sekret-A-0123456789', 'y')];
    expect(new Set([a, b, c]).size).toBe(3);
    expect(await hmacSha256Hex('sekret-A-0123456789', 'x')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await sha256Hex('sekret-A-0123456789x'));
    expect(a).not.toBe(await sha256Hex('sekret-A-0123456789:x'));
  });

  it('kolejne wywołania z tym samym sekretem i po zmianie sekretu (klucz zapamiętany, ale nie pomylony) dają poprawne skróty', async () => {
    const want = (secret: string, text: string): string => createHmac('sha256', secret).update(text).digest('hex');
    for (const [secret, text] of [['aaaaaaaaaaaaaaaa', '1'], ['aaaaaaaaaaaaaaaa', '2'], ['bbbbbbbbbbbbbbbb', '1'], ['aaaaaaaaaaaaaaaa', '1'], ['zażółć-gęślą-jaźń', 'ąę']] as const) {
      expect(await hmacSha256Hex(secret, text), `${secret} ${text}`).toBe(want(secret, text));
    }
  });

  it('równoległe pierwsze wywołania z tym samym sekretem dają ten sam wynik (jeden import klucza, bez wyścigu)', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => hmacSha256Hex('rownolegly-sekret-12345', String(i % 3))));
    expect(new Set(results).size).toBe(3);
  });
});
