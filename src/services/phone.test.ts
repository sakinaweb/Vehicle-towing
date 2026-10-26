import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayPhone, formatLocal, toSignInE164 } from './phone.ts';

test('UAE numbers are accepted in every build', () => {
  for (const dev of [true, false]) {
    assert.equal(toSignInE164('50 123 4567', dev), '+971501234567');
    assert.equal(toSignInE164('+971501234567', dev), '+971501234567');
  }
});

test('Indian (+91) test numbers are accepted only in the dev build', () => {
  assert.equal(toSignInE164('+919876543210', true), '+919876543210');
  assert.equal(toSignInE164('0091 98765 43210', true), '+919876543210');
  assert.equal(toSignInE164('+919876543210', false), null);
  assert.equal(toSignInE164('9876543210', true), null); // country code required
  assert.equal(toSignInE164('+915876543210', true), null);
});

test('display keeps the right country code', () => {
  assert.equal(displayPhone(formatLocal('+971501234567')), '+971 50 123 4567');
  assert.equal(displayPhone(formatLocal('+919876543210')), '+919876543210');
});
