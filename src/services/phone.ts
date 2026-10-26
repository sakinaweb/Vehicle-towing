/**
 * UAE mobile helpers for forms. Mirrors the API's rules (backend/src/common/phone.ts);
 * the API remains the authority — this only gives instant feedback.
 */
export function toUaeE164(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, '');
  if (digits.startsWith('00971')) digits = digits.slice(5);
  else if (digits.startsWith('971')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^5[024568]\d{7}$/.test(digits) ? `+971${digits}` : null;
}

/** Indian mobile with its country code ("+91 98765 43210", "0091…"); the API accepts it only with DEV_ALLOW_INDIA_PHONES. */
export function toIndiaE164(input: string): string | null {
  const match = /^(?:\+|00)91([6-9]\d{9})$/.exec(input.replace(/[\s\-().]/g, ''));
  return match ? `+91${match[1]}` : null;
}

const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;

/** Sign-in numbers: UAE, plus Indian test numbers in the dev build only. */
export function toSignInE164(input: string, dev = viteEnv?.DEV === true): string | null {
  return toUaeE164(input) ?? (dev ? toIndiaE164(input) : null);
}

/** "+971501234567" → "50 123 4567" (the part after the +971 prefix shown in the UI); other numbers stay E.164. */
export function formatLocal(e164: string): string {
  if (!e164.startsWith('+971')) return e164;
  const n = e164.replace(/^\+971/, '');
  return `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}

/** formatLocal() output with its country code, for display: "+971 50 123 4567" or "+919876543210". */
export const displayPhone = (local: string): string =>
  local.startsWith('+') ? local : `+971 ${local}`;
