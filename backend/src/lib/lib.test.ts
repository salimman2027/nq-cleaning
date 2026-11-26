import test from 'node:test';
import assert from 'node:assert/strict';
import { calcTotals, lineTotal } from './pricing';
import { canTransition, nextStatuses, STATUSES } from './transitions';
import { riyadhDayRange, riyadhMonthRange } from './time';
import { normalizeMobile, escapeLike } from './phone';

test('calcTotals: VAT 15% with discount, no float drift', () => {
  const t = calcTotals([{ quantity: 3, unitPrice: 33.33 }, { quantity: 1, unitPrice: 0.1 }], 10, 15);
  assert.equal(t.subtotal, 100.09);
  assert.equal(t.discount, 10);
  assert.equal(t.vat, 13.51); // (90.09 * 0.15 = 13.5135)
  assert.equal(t.total, 103.6);
});

test('calcTotals rejects discount above subtotal', () => {
  assert.throws(() => calcTotals([{ quantity: 1, unitPrice: 50 }], 60, 15), RangeError);
  assert.throws(() => calcTotals([{ quantity: 1, unitPrice: 50 }], -1, 15), RangeError);
});

test('lineTotal rounds to 2 decimals', () => {
  assert.equal(lineTotal({ quantity: 1.5, unitPrice: 33.33 }), 50);
});

test('status machine: valid and invalid transitions', () => {
  assert.ok(canTransition('new', 'confirmed'));
  assert.ok(canTransition('in_progress', 'awaiting_review'));
  assert.ok(!canTransition('new', 'done'));
  assert.ok(!canTransition('cancelled', 'confirmed'));
  assert.deepEqual(nextStatuses('closed'), []);
  assert.equal(STATUSES.length, 15);
  for (const s of STATUSES) for (const n of nextStatuses(s)) assert.ok(STATUSES.includes(n));
});

test('riyadhDayRange respects UTC+3', () => {
  // 2026-11-26T22:30Z is already 27 Nov 01:30 in Riyadh
  const r = riyadhDayRange(new Date('2026-11-26T22:30:00Z'));
  assert.equal(r.start.toISOString(), '2026-11-26T21:00:00.000Z');
  assert.equal(r.end.toISOString(), '2026-11-27T21:00:00.000Z');
  const m = riyadhMonthRange(new Date('2026-11-26T22:30:00Z'));
  assert.equal(m.start.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(m.end.toISOString(), '2026-11-30T21:00:00.000Z');
});

test('normalizeMobile', () => {
  assert.equal(normalizeMobile('+966 55 123 4567'), '0551234567');
  assert.equal(normalizeMobile('00966551234567'), '0551234567');
  assert.equal(normalizeMobile('551234567'), '0551234567');
  assert.equal(normalizeMobile('0551234567'), '0551234567');
});

test('escapeLike', () => {
  assert.equal(escapeLike('50%_[x]'), '50\\%\\_\\[x]');
});
