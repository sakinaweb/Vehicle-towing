import {
  formatUaeMobile,
  isUaeMobileE164,
  maskPhone,
  normalizeIndiaMobile,
  normalizeUaeMobile,
} from './phone.js';

describe('normalizeUaeMobile', () => {
  it.each([
    ['+971501234567', '+971501234567'],
    ['+971 50 123 4567', '+971501234567'],
    ['00971 52 123 4567', '+971521234567'],
    ['971541234567', '+971541234567'],
    ['055-123-4567', '+971551234567'],
    ['0561234567', '+971561234567'],
    ['58 123 4567', '+971581234567'],
    ['(050) 123.4567', '+971501234567'],
  ])('accepts %s → %s', (input, expected) => {
    expect(normalizeUaeMobile(input)).toBe(expected);
  });

  it.each([
    ['51 123 4567', 'unassigned mobile prefix 51'],
    ['04 123 4567', 'Dubai landline'],
    ['+44 7700 900123', 'foreign number'],
    ['+1 501 234 5678', 'foreign number that looks local'],
    ['+91 98765 43210', 'Indian number'],
    ['0091 98765 43210', 'Indian number with 00 prefix'],
    ['50 123 456', 'too short'],
    ['50 123 45678', 'too long'],
    ['50-ABC-4567', 'letters'],
    ['', 'empty'],
    ['++971501234567', 'malformed'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeUaeMobile(input)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizeUaeMobile(501234567)).toBeNull();
    expect(normalizeUaeMobile(undefined)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('formats for display', () => {
    expect(formatUaeMobile('+971501234567')).toBe('+971 50 123 4567');
  });

  it('masks for logs', () => {
    expect(maskPhone('+971501234567')).toBe('+97150*****67');
  });
});

describe('normalizeIndiaMobile (development only)', () => {
  it.each([
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['+91-60000-00000', '+916000000000'],
  ])('accepts %s', (input, e164) => {
    expect(normalizeIndiaMobile(input)).toBe(e164);
  });

  it.each([
    ['98765 43210', 'no country code'],
    ['919876543210', 'country code without + or 00'],
    ['+91 58765 43210', 'not a mobile range'],
    ['+91 98765 4321', 'too short'],
    ['+971501234567', 'UAE number'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeIndiaMobile(input)).toBeNull();
  });

  it('is not a UAE number', () => {
    expect(isUaeMobileE164('+919876543210')).toBe(false);
    expect(isUaeMobileE164('+971501234567')).toBe(true);
  });
});
