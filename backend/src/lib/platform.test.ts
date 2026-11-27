import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, isSaudiMobile, safeEqualHex, toInternational } from './otp';
import { CR_RE, VAT_RE, missingForReview } from './company';

test('otp codes are 6 digits and hash is bound to phone, purpose and secret', () => {
  for (let i = 0; i < 50; i++) assert.match(generateCode(), /^\d{6}$/);
  const a = hashCode('s', '0551234567', 'login', '123456');
  assert.equal(a, hashCode('s', '0551234567', 'login', '123456'));
  assert.notEqual(a, hashCode('s', '0551234568', 'login', '123456'));
  assert.notEqual(a, hashCode('s', '0551234567', 'company_register', '123456'));
  assert.notEqual(a, hashCode('t', '0551234567', 'login', '123456'));
  assert.ok(safeEqualHex(a, a));
  assert.ok(!safeEqualHex(a, hashCode('s', '0551234567', 'login', '123457')));
  assert.ok(!safeEqualHex(a, 'zz'));
});

test('phone helpers', () => {
  assert.ok(isSaudiMobile('0551234567'));
  assert.ok(!isSaudiMobile('0451234567'));
  assert.ok(!isSaudiMobile('055123456'));
  assert.equal(toInternational('0551234567'), '966551234567');
});

test('CR / VAT formats and submit completeness', () => {
  assert.ok(CR_RE.test('1010123456'));
  assert.ok(!CR_RE.test('101012345'));
  assert.ok(VAT_RE.test('300000000000003'));
  assert.ok(!VAT_RE.test('400000000000003'));
  assert.ok(!VAT_RE.test('30000000000003'));
  const addr = { buildingNo: '1234', street: 'King Fahd', district: 'Olaya', city: 'Riyadh', postalCode: '12211', additionalNo: '5678' };
  assert.deepEqual(missingForReview({ name: 'Co', crNumber: '1010123456', vatNumber: '300000000000003', nationalAddress: addr, sectorCount: 1 }), []);
  assert.deepEqual(missingForReview({ name: 'Co', sectorCount: 0 }).sort(), ['crNumber', 'nationalAddress', 'sectors', 'vatNumber']);
});
