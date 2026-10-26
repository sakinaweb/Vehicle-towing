import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;

/** Uniformly random 6-digit code from the OS CSPRNG (leading zeros allowed). */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * Keyed hash of the code, bound to the phone number. A 6-digit code has only a
 * million values, so a plain hash would be trivially reversible from a DB dump;
 * the server-side pepper (OTP_SECRET) prevents that.
 */
export function hashOtp(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

/** Constant-time comparison so response timing reveals nothing about the code. */
export function otpMatches(
  secret: string,
  phone: string,
  code: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashOtp(secret, phone, code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
