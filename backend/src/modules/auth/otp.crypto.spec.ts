import { generateOtpCode, hashOtp, otpMatches } from './otp.crypto.js';

const SECRET = 's'.repeat(48);
const PHONE = '+971501234567';

describe('OTP crypto', () => {
  it('generates 6-digit numeric codes, including leading zeros', () => {
    const codes = Array.from({ length: 2000 }, generateOtpCode);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1900); // not repeating
  });

  it('never stores the code itself', () => {
    const hash = hashOtp(SECRET, PHONE, '123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
  });

  it('matches only the right code for the right phone and secret', () => {
    const hash = hashOtp(SECRET, PHONE, '042317');
    expect(otpMatches(SECRET, PHONE, '042317', hash)).toBe(true);
    expect(otpMatches(SECRET, PHONE, '042318', hash)).toBe(false);
    expect(otpMatches(SECRET, '+971501234568', '042317', hash)).toBe(false);
    expect(otpMatches('x'.repeat(48), PHONE, '042317', hash)).toBe(false);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(otpMatches(SECRET, PHONE, '123456', 'abc')).toBe(false);
  });
});
