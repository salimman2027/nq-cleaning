import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, isSaudiMobile, safeEqualHex, toInternational } from './otp';
import { CR_RE, VAT_RE, missingForReview } from './company';
import { mismatches, parseDocumentText, sanitizeExtracted, sniffMime, westernDigits } from './documents';
import { extractFromFile } from '../services/extract';

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


test('sniffs real file types and rejects others', () => {
  assert.equal(sniffMime(Buffer.from('%PDF-1.7 x')), 'application/pdf');
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(sniffMime(Buffer.alloc(0)), null);
});
test('converts Arabic digits and validates extracted values like manual entry', () => {
  assert.equal(westernDigits('١٠١٠١٢٣٤٥٦'), '1010123456');
  assert.deepEqual(sanitizeExtracted('cr', { crNumber: '١٠١٠١٢٣٤٥٦' }), { crNumber: '1010123456' });
  assert.deepEqual(sanitizeExtracted('cr', { crNumber: '123' }), {});
  assert.deepEqual(sanitizeExtracted('vat', { vatNumber: '300000000000003' }), { vatNumber: '300000000000003' });
  assert.deepEqual(sanitizeExtracted('vat', { vatNumber: '400000000000003' }), {});
  const a = sanitizeExtracted('address', { nationalAddress: { buildingNo: '1234', street: 'King Fahd', district: 'Olaya', city: 'Riyadh', postalCode: '12211', additionalNo: '5678' } });
  assert.equal(a.nationalAddress?.postalCode, '12211');
  assert.deepEqual(sanitizeExtracted('address', { nationalAddress: { buildingNo: '12' } }), {});
  assert.deepEqual(sanitizeExtracted('address', { nationalAddress: { buildingNo: '1234', postalCode: '12' } }), { nationalAddress: { buildingNo: '1234' } });
});
test('reads numbers from PDF text with Arabic digits, either label order, and ignores unrelated numbers', () => {
  assert.deepEqual(parseDocumentText('cr', 'وزارة التجارة\nرقم السجل التجاري: ١٠١٠١٢٣٤٥٦\nهاتف 0551234567'), { crNumber: '1010123456' });
  assert.deepEqual(parseDocumentText('cr', '1010123456 :السجل التجاري'), { crNumber: '1010123456' });
  assert.deepEqual(parseDocumentText('cr', 'no registration here 12345'), {});
  assert.deepEqual(parseDocumentText('vat', 'الرقم الضريبي ٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣'), { vatNumber: '300000000000003' });
  assert.deepEqual(parseDocumentText('vat', 'VAT 400000000000003'), {});
  const a = parseDocumentText('address', 'رقم المبنى: 1234\nالرقم الإضافي: 5678\nالرمز البريدي: 12211\nالشارع: طريق الملك فهد\nالحي: العليا\nالمدينة: الرياض');
  assert.equal(a.nationalAddress?.buildingNo, '1234');
  assert.equal(a.nationalAddress?.additionalNo, '5678');
  assert.equal(a.nationalAddress?.postalCode, '12211');
  assert.equal(a.nationalAddress?.city, undefined); // text fields are never taken from PDF text (letter-reversal risk)
});
test('flags mismatches between file values and typed values', () => {
  assert.deepEqual(mismatches({ crNumber: '1010123456' }, { crNumber: '1010123457' }), ['crNumber']);
  assert.deepEqual(mismatches({ crNumber: '1010123456' }, { crNumber: '1010123456' }), []);
  assert.deepEqual(mismatches(null, { crNumber: '1' }), []);
});
test('extraction is skipped without a key and sanitises model output with one', async () => {
  assert.equal((await extractFromFile('cr', 'application/pdf', Buffer.from('%PDF-'))).status, 'skipped');
  const { config } = await import('../config');
  config.extract.apiKey = 'test-key';
  try {
    const ok = await extractFromFile('cr', 'image/png', Buffer.from([1]), (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"crNumber":"1010123456"}' }] }))) as typeof fetch);
    assert.deepEqual(ok, { status: 'ok', values: { crNumber: '1010123456' } });
    const bad = await extractFromFile('cr', 'image/png', Buffer.from([1]), (async () => new Response('{}', { status: 500 })) as typeof fetch);
    assert.equal(bad.status, 'failed');
  } finally { config.extract.apiKey = ''; }
});
