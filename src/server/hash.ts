/**
 * Skróty i losowość serwera rankingu (WebCrypto: jest w Node na Vercelu i w testach, bez importów).
 */

/** SHA-256 tekstu (UTF-8) jako 64 znaki szesnastkowe. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Losowe bajty (do podmiany w testach). */
export type RandomBytes = (n: number) => Uint8Array;
export const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** `n` losowych bajtów jako tekst szesnastkowy. */
export const randomHex = (n: number, random: RandomBytes = cryptoBytes): string =>
  Array.from(random(n), (b) => b.toString(16).padStart(2, '0')).join('');
