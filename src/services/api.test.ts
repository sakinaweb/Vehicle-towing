import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, isSpentOtpRejection } from './api.ts';

// Regression: a number registered in the other app gets 409 after its code is spent; the
// sign-in hook must leave the code step, or a retry reports "code has expired".
test('403/409 from OTP verify mean the code is spent', () => {
  assert.equal(isSpentOtpRejection(new ApiError(409, 'registered as a customer account')), true);
  assert.equal(isSpentOtpRejection(new ApiError(403, 'not active')), true);
  for (const status of [400, 401, 429, 503]) {
    assert.equal(isSpentOtpRejection(new ApiError(status, 'x')), false);
  }
  assert.equal(isSpentOtpRejection(new Error('offline')), false);
});
