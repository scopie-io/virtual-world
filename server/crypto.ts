// HMAC signing on WebCrypto — identical on Node 20+ and Cloudflare Workers.
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class Signer {
  private key: Promise<CryptoKey>;
  constructor(secret: string) {
    this.key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  async mac(payload: string, len = 22): Promise<string> {
    const sig = await crypto.subtle.sign('HMAC', await this.key, enc.encode(payload));
    return b64url(new Uint8Array(sig)).slice(0, len);
  }

  /** `payload.sig` — payload must not contain a dot-free guarantee; we split on the LAST dot. */
  async sign(payload: string): Promise<string> {
    return `${payload}.${await this.mac(payload)}`;
  }

  async verify(token: string | undefined | null): Promise<string | null> {
    if (!token) return null;
    const i = token.lastIndexOf('.');
    if (i < 1) return null;
    const payload = token.slice(0, i);
    const expected = await this.mac(payload);
    return timingSafeEqual(expected, token.slice(i + 1)) ? payload : null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function shortCode(n = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
