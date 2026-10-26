// Run: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOOKING_STATUS_LABELS,
  TOW_SERVICES,
  TOW_TYPE_LABELS,
  VEHICLE_ISSUES,
  disputeReasonError,
  ratingComment,
  statusLabel,
  visiblePaymentMethods,
} from './catalog.ts';

const dart = (path: string) => readFileSync(new URL(`../../mobile/${path}`, import.meta.url), 'utf8');

test('status labels match mobile format.dart exactly', () => {
  const src = dart('townow_core/lib/src/format.dart');
  const start = src.indexOf('bookingStatusLabels');
  const block = src.slice(start, src.indexOf('};', start));
  const mobile = Object.fromEntries([...block.matchAll(/'(\w+)': '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(BOOKING_STATUS_LABELS, mobile);
  assert.equal(statusLabel('in_transit'), 'Towing to destination');
  assert.equal(statusLabel('unknown_status'), 'unknown_status');
});

test('equipment labels match mobile towTypeLabels', () => {
  const src = dart('townow_core/lib/src/format.dart');
  const start = src.indexOf('towTypeLabels');
  const block = src.slice(start, src.indexOf('};', start));
  assert.deepEqual(TOW_TYPE_LABELS, Object.fromEntries([...block.matchAll(/'([\w-]+)': '([^']+)'/g)].map((m) => [m[1], m[2]])));
});

test('service titles match the mobile customer app', () => {
  const src = dart('customer_app/lib/widgets.dart');
  for (const s of TOW_SERVICES) {
    assert.match(src, new RegExp(`'${s.type}',\\s*'${s.title}',\\s*'${s.desc}'`));
  }
});

test('vehicle issues match mobile (same order, first is the default)', () => {
  const src = dart('townow_core/lib/src/format.dart');
  const block = src.slice(src.indexOf('vehicleIssues'), src.indexOf('];', src.indexOf('vehicleIssues')));
  assert.deepEqual([...VEHICLE_ISSUES], [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
});

test('payment options follow the server: cash only while payments are off', () => {
  assert.deepEqual(visiblePaymentMethods(['cash']), ['cash']);
  assert.deepEqual(visiblePaymentMethods(null), ['cash']); // not loaded / request failed
  assert.deepEqual(visiblePaymentMethods(['cash', 'card', 'apple_pay']), ['cash', 'card', 'apple_pay']);
  assert.deepEqual(visiblePaymentMethods(['card', 'cash']), ['cash', 'card']); // cash first
});

test('rating comment combines tags and text within 500 chars', () => {
  assert.equal(ratingComment([], '  '), undefined);
  assert.equal(ratingComment(['Careful Handling'], ''), 'Careful Handling');
  assert.equal(ratingComment(['A', 'B'], ' great '), 'A, B — great');
  assert.equal(ratingComment([], 'x'.repeat(600))?.length, 500);
});

test('dispute reason uses the API bounds (10–1000)', () => {
  assert.ok(disputeReasonError('too short'));
  assert.equal(disputeReasonError('Bumper scratched during loading'), null);
  assert.ok(disputeReasonError('x'.repeat(1001)));
});
