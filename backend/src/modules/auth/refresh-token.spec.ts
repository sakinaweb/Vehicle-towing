import {
  formatRefreshToken,
  hashRefreshSecret,
  newRefreshSecret,
  parseRefreshToken,
  refreshSecretMatches,
} from './refresh-token.js';

const SESSION = '3f2b8a52-6f0e-4a8c-9d1e-0c5b7a9e4d21';

describe('refresh tokens', () => {
  it('round-trips format → parse', () => {
    const secret = newRefreshSecret();
    expect(parseRefreshToken(formatRefreshToken(SESSION, secret))).toEqual({
      sessionId: SESSION,
      secret,
    });
  });

  it('creates unpredictable 256-bit secrets', () => {
    const secrets = new Set(Array.from({ length: 100 }, newRefreshSecret));
    expect(secrets.size).toBe(100);
    for (const s of secrets) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    ['missing dot', 'abc'],
    ['bad uuid', `not-a-uuid.${'a'.repeat(43)}`],
    ['short secret', `${SESSION}.abc`],
    ['non-string', 42],
    ['sql-ish', `${SESSION}.' OR 1=1 --${'a'.repeat(30)}`],
  ])('rejects malformed tokens (%s)', (_label, token) => {
    expect(parseRefreshToken(token)).toBeNull();
  });

  it('stores only a hash and compares in constant time', () => {
    const secret = newRefreshSecret();
    const stored = hashRefreshSecret(secret);
    expect(stored).not.toContain(secret);
    expect(refreshSecretMatches(secret, stored)).toBe(true);
    expect(refreshSecretMatches(newRefreshSecret(), stored)).toBe(false);
    expect(refreshSecretMatches(secret, 'deadbeef')).toBe(false);
  });
});
