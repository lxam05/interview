import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/*
 * Admin session tokens: "<expiry ms>.<hmac>". Stateless and signed with the
 * server secret, so a token cannot be forged or extended without it.
 */

export const SESSION_COOKIE = "admin_session";
export const SESSION_HOURS = 12;

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`admin:${payload}`).digest("base64url");
}

function same(a: string, b: string) {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function createSessionToken(secret: string, now = Date.now()): { token: string; expires: Date } {
  const exp = now + SESSION_HOURS * 3_600_000;
  return { token: `${exp}.${sign(String(exp), secret)}`, expires: new Date(exp) };
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp)) return false;
  if (Number(exp) <= now) return false;
  return same(mac, sign(exp, secret));
}

/** Constant-time password check. An unset password never matches. */
export function passwordMatches(input: string, expected: string | undefined): boolean {
  if (!expected) return false;
  return same(input, expected);
}
