/**
 * UAE mobile numbers: country code 971, then a 9-digit national number
 * starting 50, 52, 54, 55, 56 or 58 (Etisalat/e& and du ranges).
 */
const UAE_MOBILE = /^5[024568]\d{7}$/;

/**
 * Normalises the ways people type a UAE mobile number to E.164 (+9715XXXXXXXX).
 * Accepts: "+971 50 123 4567", "00971501234567", "971501234567", "0501234567",
 * "50 123 4567", with spaces, dashes, dots or brackets. Returns null if it is
 * not a valid UAE mobile number (landlines and foreign numbers are rejected).
 */
export function normalizeUaeMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  let national = compact.replace(/^\+/, '');
  if (national.startsWith('00971')) national = national.slice(5);
  else if (national.startsWith('971')) national = national.slice(3);
  else if (compact.startsWith('+')) return null; // another country code
  if (national.startsWith('0')) national = national.slice(1);

  return UAE_MOBILE.test(national) ? `+971${national}` : null;
}

/**
 * Development only (DEV_ALLOW_INDIA_PHONES): Indian mobile numbers, which need the country
 * code — "+91 98765 43210" or "0091…" → "+919876543210". Returns null otherwise.
 */
export function normalizeIndiaMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const match = /^(?:\+|00)91([6-9]\d{9})$/.exec(input.trim().replace(/[\s\-().]/g, ''));
  return match ? `+91${match[1]}` : null;
}

export const isUaeMobileE164 = (phone: string): boolean => /^\+9715[024568]\d{7}$/.test(phone);

/**
 * E.164 mobile ranges per supported sign-in country (keys = OTP_COUNTRIES values).
 * ponytail: hand-kept table; switch to libphonenumber-js once more than a few countries are needed.
 */
const MOBILE_E164: Record<string, RegExp> = {
  AE: /^\+9715[024568]\d{7}$/,
  IN: /^\+91[6-9]\d{9}$/,
};

/** ISO country of a normalised E.164 mobile number, or null if it is in no supported range. */
export function mobileCountry(e164: string): string | null {
  return Object.keys(MOBILE_E164).find((iso) => MOBILE_E164[iso].test(e164)) ?? null;
}

/** "+971501234567" → "+971 50 123 4567" for display and SMS text. */
export function formatUaeMobile(e164: string): string {
  const n = e164.replace(/^\+971/, '');
  return `+971 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}

/** "+971501234567" → "+97150*****67" for logs, so full numbers never reach log storage. */
export function maskPhone(e164: string): string {
  return e164.length > 8 ? `${e164.slice(0, 6)}*****${e164.slice(-2)}` : '***';
}
