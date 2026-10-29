/**
 * Skróty i losowość serwera rankingu (WebCrypto: jest w Node na Vercelu i w testach, bez importów).
 */

const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 tekstu (UTF-8) jako 64 znaki szesnastkowe. */
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Zaimportowany klucz HMAC ostatnio użytego sekretu: import robi się raz na życie instancji, nie przy każdym skrócie. */
let hmacKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function keyFor(secret: string): Promise<CryptoKey> {
  if (hmacKey?.secret !== secret) {
    const key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKey = { secret, key };
    key.catch(() => { if (hmacKey?.key === key) hmacKey = null; });   // nieudany import nie zostaje w pamięci
  }
  return hmacKey.key;
}

/**
 * HMAC-SHA256 tekstu (UTF-8) kluczem z sekretu (UTF-8) jako 64 znaki szesnastkowe. Klucz importuje się raz (`CryptoKey` nie da się
 * odczytać z powrotem), a zmiana sekretu między wywołaniami wymienia go. Długości sekretu nie sprawdza: robi to wołający.
 */
export async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await keyFor(secret), new TextEncoder().encode(text)));
}

/** Losowe bajty (do podmiany w testach). */
export type RandomBytes = (n: number) => Uint8Array;
export const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** `n` losowych bajtów jako tekst szesnastkowy. */
export const randomHex = (n: number, random: RandomBytes = cryptoBytes): string =>
  Array.from(random(n), (b) => b.toString(16).padStart(2, '0')).join('');
