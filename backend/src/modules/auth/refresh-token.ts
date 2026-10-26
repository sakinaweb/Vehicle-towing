import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh token format: "<sessionId>.<secret>".
 * The session id locates the row; only SHA-256(secret) is stored, so a database
 * leak cannot be replayed. 32 random bytes make guessing infeasible, which is
 * why a fast hash (not bcrypt) is the right tool here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

export function newRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: unknown): { sessionId: string; secret: string } | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return UUID.test(sessionId) && SECRET.test(secret) ? { sessionId, secret } : null;
}

export function refreshSecretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashRefreshSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
