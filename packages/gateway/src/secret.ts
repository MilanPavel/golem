/** 32 random bytes as base64url without padding (43 characters). */
export function randomSecret(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** True for a value `randomSecret` could have made. An empty or damaged token never matches. */
export function isSecretShape(value: string): boolean {
  return SECRET_SHAPE.test(value);
}

/** Compares UTF-8 bytes in time that depends only on the length. A different length is false at once. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
