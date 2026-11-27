/** Marketplace onboarding: OTP, registration, review workflow, tenant gating. Needs SQL Server (RUN_INTEGRATION=1). */
import test, { before, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';

const enabled = process.env.RUN_INTEGRATION === '1';
const DB = `NQPlat_${Date.now()}`;
const PLAT = { email: 'plat@test.local', password: 'Platform-Passphrase-1' };
const OWNER = { email: 'owner@test.local', password: 'Owner-Passphrase-123', phone: '0551112233' };
const ADDR = { buildingNo: '1234', street: 'King Fahd Rd', district: 'Olaya', city: 'Riyadh', postalCode: '12211', additionalNo: '5678' };

describe('marketplace onboarding and review', { skip: !enabled }, () => {
  let app: Express;
  let ownerToken = '';
  let platToken = '';
  let companyId = 0;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OTP_DEV_MODE = '1';
    process.env.DB_NAME = DB;
    process.env.APP_URL = 'https://example.test';
    process.env.JWT_ACCESS_SECRET = 'integration-test-secret-integration-test-secret';
    const { migrate } = await import('../scripts/migrate');
    const { bootstrapPlatform } = await import('../scripts/bootstrap-platform');
    const { createApp } = await import('../app');
    await migrate();
    await bootstrapPlatform({ adminEmail: PLAT.email, adminPassword: PLAT.password });
    app = createApp();
    const l = await request(app).post('/api/auth/login').send(PLAT);
    assert.equal(l.status, 200);
    platToken = l.body.accessToken;
  });

  test('registration needs a valid OTP; wrong codes are rejected and limited', async () => {
    const r = await request(app).post('/api/onboarding/otp/request').send({ phone: OWNER.phone });
    assert.equal(r.status, 200);
    assert.match(r.body.devCode, /^\d{6}$/);
    const again = await request(app).post('/api/onboarding/otp/request').send({ phone: OWNER.phone });
    assert.equal(again.status, 429);
    const body = { phone: OWNER.phone, companyName: 'Clean Co', ownerName: 'Owner', email: OWNER.email, password: OWNER.password, sectorCodes: ['cleaning'] };
    const wrong = r.body.devCode === '000000' ? '000001' : '000000';
    assert.equal((await request(app).post('/api/onboarding/register').send({ ...body, code: wrong })).status, 400);
    const ok = await request(app).post('/api/onboarding/register').send({ ...body, code: r.body.devCode });
    assert.equal(ok.status, 201);
    ownerToken = ok.body.accessToken;
    companyId = ok.body.user.companyId;
    // code is single-use
    assert.equal((await request(app).post('/api/onboarding/register').send({ ...body, code: r.body.devCode })).status, 409);
  });

  test('five wrong guesses lock the code', async () => {
    const phone = '0552223344';
    const r = await request(app).post('/api/onboarding/otp/request').send({ phone });
    const wrong = r.body.devCode === '111111' ? '222222' : '111111';
    const body = { phone, companyName: 'X Co', ownerName: 'Owner', email: 'x@test.local', password: 'Another-Passphrase-1', sectorCodes: ['plumbing'] };
    for (let i = 0; i < 5; i++) assert.equal((await request(app).post('/api/onboarding/register').send({ ...body, code: wrong })).status, 400);
    assert.equal((await request(app).post('/api/onboarding/register').send({ ...body, code: r.body.devCode })).status, 400);
  });

  test('draft company cannot use tenant APIs but can edit its profile', async () => {
    assert.equal((await request(app).get('/api/customers').set(auth(ownerToken))).status, 403);
    assert.equal((await request(app).get('/api/company').set(auth(ownerToken))).body.status, 'draft');
  });

  test('cannot submit incomplete; validates CR and VAT formats', async () => {
    const s = await request(app).post('/api/company/submit').set(auth(ownerToken));
    assert.equal(s.status, 409);
    assert.ok(s.body.error.details.missing.includes('crNumber'));
    assert.equal((await request(app).put('/api/company').set(auth(ownerToken)).send({ crNumber: '123' })).status, 400);
    assert.equal((await request(app).put('/api/company').set(auth(ownerToken)).send({ vatNumber: '400000000000003' })).status, 400);
  });

  test('not visible in the public marketplace before approval; platform permission enforced', async () => {
    const put = await request(app).put('/api/company').set(auth(ownerToken)).send({ crNumber: '1010123456', vatNumber: '300000000000003', nationalAddress: ADDR, slug: 'clean-co' });
    assert.equal(put.status, 200);
    // Documents are mandatory: without them the submit is refused.
    const noDocs = await request(app).post('/api/company/submit').set(auth(ownerToken));
    assert.equal(noDocs.status, 409);
    assert.deepEqual(noDocs.body.error.details.missing, ['doc:cr', 'doc:vat', 'doc:address']);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    assert.equal((await request(app).put('/api/company/documents/cr').set(auth(ownerToken)).send({ fileName: 'cr.pdf', dataBase64: pdf })).status, 200);
    assert.equal((await request(app).put('/api/company/documents/vat').set(auth(ownerToken)).send({ fileName: 'vat.png', dataBase64: png })).status, 200);
    // A text file renamed to .pdf is refused by its content, not its name.
    const fake = await request(app).put('/api/company/documents/address').set(auth(ownerToken)).send({ fileName: 'a.pdf', dataBase64: Buffer.from('hello world, not a pdf at all').toString('base64') });
    assert.equal(fake.status, 415);
    assert.equal((await request(app).put('/api/company/documents/address').set(auth(ownerToken)).send({ fileName: 'a.pdf', dataBase64: pdf })).status, 200);
    const file = await request(app).get('/api/company/documents/vat/file').set(auth(ownerToken));
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.equal((await request(app).post('/api/company/submit').set(auth(ownerToken))).status, 200);
    // Locked once submitted; platform staff can read the files, other tenants cannot.
    assert.equal((await request(app).put('/api/company/documents/cr').set(auth(ownerToken)).send({ fileName: 'cr2.pdf', dataBase64: pdf })).status, 409);
    const det = await request(app).get(`/api/platform/companies/${companyId}`).set(auth(platToken));
    assert.equal(det.body.documents.length, 3);
    assert.equal((await request(app).get(`/api/platform/companies/${companyId}/documents/cr/file`).set(auth(platToken))).status, 200);
    assert.equal((await request(app).get(`/api/platform/companies/${companyId}/documents/cr/file`).set(auth(ownerToken))).status, 403);
    assert.equal((await request(app).get('/api/market/companies/clean-co')).status, 404);
    assert.equal((await request(app).get('/api/platform/companies').set(auth(ownerToken))).status, 403);
    assert.equal((await request(app).post(`/api/platform/companies/${companyId}/approve`).set(auth(ownerToken))).status, 403);
    assert.equal((await request(app).get('/api/platform/companies')).status, 401);
  });

  test('reject requires a reason, owner can fix and resubmit, then approval opens the dashboard', async () => {
    assert.equal((await request(app).post(`/api/platform/companies/${companyId}/reject`).set(auth(platToken)).send({})).status, 400);
    assert.equal((await request(app).post(`/api/platform/companies/${companyId}/reject`).set(auth(platToken)).send({ reason: 'CR document unreadable' })).status, 200);
    const p = await request(app).get('/api/company').set(auth(ownerToken));
    assert.equal(p.body.status, 'rejected');
    assert.equal(p.body.reviewNote, 'CR document unreadable');
    assert.equal((await request(app).post('/api/company/submit').set(auth(ownerToken))).status, 200);
    const a = await request(app).post(`/api/platform/companies/${companyId}/approve`).set(auth(platToken));
    assert.equal(a.status, 200);
    assert.equal(a.body.dashboardUrl, 'https://example.test/login');
    assert.equal((await request(app).post(`/api/platform/companies/${companyId}/approve`).set(auth(platToken))).status, 409);
    assert.equal((await request(app).get('/api/customers').set(auth(ownerToken))).status, 200);
  });

  test('approved company is public; legal fields are locked; platform staff cannot use tenant data', async () => {
    const m = await request(app).get('/api/market/companies/clean-co');
    assert.equal(m.status, 200);
    assert.equal(m.body.name, 'Clean Co');
    assert.equal(m.body.crNumber, undefined);
    assert.equal((await request(app).put('/api/company').set(auth(ownerToken)).send({ crNumber: '1010999999' })).status, 409);
    assert.equal((await request(app).put('/api/company').set(auth(ownerToken)).send({ description: 'We clean.' })).status, 200);
    const list = await request(app).get('/api/market/companies?sector=cleaning');
    assert.equal(list.body.items.length, 1);
    assert.equal((await request(app).get('/api/market/companies?sector=plumbing')).body.items.length, 0);
    assert.equal((await request(app).get('/api/customers').set(auth(platToken))).status, 403);
  });

  test('visitor booking request reaches only the right company; validation and cover URL', async () => {
    const { query } = await import('../db');
    const svc = (await query<{ Id: number }>(`INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes) OUTPUT INSERTED.Id VALUES (@c, N'Deep clean', 'fixed', 120)`, { c: companyId }))[0].Id;
    const day = new Date(Date.now() + 3 * 86400_000 + 3 * 3600_000).toISOString().slice(0, 10);
    const ok = { serviceId: svc, customerName: 'Ahmed', phone: '0551112233', date: day, period: 'morning' };
    assert.equal((await request(app).post('/api/market/companies/clean-co/requests').send(ok)).status, 201);
    assert.equal((await request(app).post('/api/market/companies/clean-co/requests').send({ ...ok, phone: '12345' })).status, 400);
    assert.equal((await request(app).post('/api/market/companies/clean-co/requests').send({ ...ok, date: '2020-01-01' })).status, 400);
    assert.equal((await request(app).post('/api/market/companies/clean-co/requests').send({ ...ok, serviceId: svc + 9999 })).status, 400);
    assert.equal((await request(app).post('/api/market/companies/nope-co/requests').send(ok)).status, 404);
    const list = await request(app).get('/api/requests').set(auth(ownerToken));
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal((await request(app).get('/api/requests').set(auth(platToken))).status, 403);
    assert.equal((await request(app).patch(`/api/requests/${list.body.items[0].Id}`).set(auth(ownerToken)).send({ status: 'contacted' })).status, 200);
    const cover = await request(app).put('/api/company').set(auth(ownerToken)).send({ coverUrl: 'https://example.test/c.jpg' });
    assert.equal(cover.body.coverUrl, 'https://example.test/c.jpg');
    assert.equal((await request(app).put('/api/company').set(auth(ownerToken)).send({ coverUrl: 'http://example.test/c.jpg' })).status, 400);
  });

  test('suspension blocks tenant APIs immediately and hides the storefront', async () => {
    assert.equal((await request(app).post(`/api/platform/companies/${companyId}/suspend`).set(auth(platToken)).send({ reason: 'Policy violation' })).status, 200);
    assert.equal((await request(app).get('/api/customers').set(auth(ownerToken))).status, 403);
    assert.equal((await request(app).get('/api/market/companies/clean-co')).status, 404);
    assert.equal((await request(app).post(`/api/platform/companies/${companyId}/reactivate`).set(auth(platToken))).status, 200);
    assert.equal((await request(app).get('/api/customers').set(auth(ownerToken))).status, 200);
  });

  test('login by phone OTP; unknown numbers get the same answer', async () => {
    const known = await request(app).post('/api/auth/otp/request').send({ phone: OWNER.phone });
    assert.equal(known.status, 200);
    const unknown = await request(app).post('/api/auth/otp/request').send({ phone: '0559998877' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.devCode, undefined);
    const v = await request(app).post('/api/auth/otp/verify').send({ phone: OWNER.phone, code: known.body.devCode });
    assert.equal(v.status, 200);
    assert.equal(v.body.user.companyId, companyId);
  });

  test('platform logo is a setting: only https, admin only, public read', async () => {
    assert.equal((await request(app).get('/api/market/brand')).body.logoUrl, null);
    assert.equal((await request(app).put('/api/platform/brand').set(auth(ownerToken)).send({ logoUrl: 'https://x.test/l.png' })).status, 403);
    assert.equal((await request(app).put('/api/platform/brand').set(auth(platToken)).send({ logoUrl: 'http://x.test/l.png' })).status, 400);
    assert.equal((await request(app).put('/api/platform/brand').set(auth(platToken)).send({ logoUrl: 'https://x.test/l.png' })).status, 200);
    assert.equal((await request(app).get('/api/market/brand')).body.logoUrl, 'https://x.test/l.png');
    assert.equal((await request(app).put('/api/platform/brand').set(auth(platToken)).send({ logoUrl: null })).status, 200);
    assert.equal((await request(app).get('/api/market/brand')).body.logoUrl, null);
  });

  test('with PHONE_VERIFICATION=0 a company can register without a code and phone sign-in is off', async () => {
    process.env.PHONE_VERIFICATION = '0';
    try {
      assert.equal((await request(app).get('/api/market/config')).body.phoneVerification, false);
      const body = { phone: '0553334455', companyName: 'No Otp Co', ownerName: 'Owner', email: 'nootp@test.local', password: 'Another-Passphrase-2', sectorCodes: ['ac'] };
      const r = await request(app).post('/api/onboarding/register').send(body);
      assert.equal(r.status, 201);
      assert.equal((await request(app).post('/api/auth/otp/request').send({ phone: body.phone })).status, 404);
      assert.equal((await request(app).post('/api/auth/otp/verify').send({ phone: body.phone, code: '123456' })).status, 404);
    } finally {
      delete process.env.PHONE_VERIFICATION;
    }
    assert.equal((await request(app).get('/api/market/config')).body.phoneVerification, true);
  });

  test('demo seed creates marketplace data and purge removes exactly it', async () => {
    const { seedDemo, purgeDemo } = await import('../scripts/seed-demo');
    const { query } = await import('../db');
    const r = await seedDemo();
    assert.equal(r.owners.length, 8);
    const n = async (sql: string) => Number((await query<{ N: number }>(sql))[0].N);
    assert.equal(await n(`SELECT COUNT(*) N FROM Bookings b JOIN Companies c ON c.Id=b.CompanyId WHERE c.Slug LIKE 'demo-%'`), 150);
    assert.equal(await n(`SELECT COUNT(*) N FROM Customers cu JOIN Companies c ON c.Id=cu.CompanyId WHERE c.Slug LIKE 'demo-%'`), 60);
    const list = await request(app).get('/api/market/companies');
    assert.equal(list.body.items.length, 6); // 5 demo + the real one
    await purgeDemo();
    assert.equal(await n(`SELECT COUNT(*) N FROM Companies WHERE Slug LIKE 'demo-%'`), 0);
    assert.equal(await n(`SELECT COUNT(*) N FROM Companies WHERE Id=${companyId}`), 1);
  });
});
