/**
 * Integration tests against a real SQL Server. Skipped unless RUN_INTEGRATION=1 and DB_* are set
 * (CI starts a SQL Server service and runs them). Each run uses a throw-away database.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import request from 'supertest';
import type { Express } from 'express';

const enabled = process.env.RUN_INTEGRATION === '1';
const DB = `NQTest_${Date.now()}`;
const ADMIN = { email: 'admin@test.local', password: 'S3cure-Passphrase-1' };
const AGENT = { email: 'agent@test.local', password: 'Agent-Passphrase-123' };

describe('booking lifecycle, conflicts, permissions', { skip: !enabled }, () => {
  let app: Express;
  let adminToken = '';
  let agentToken = '';
  let branchId = 0;
  let customerId = 0;
  let addressId = 0;
  let serviceId = 0;
  const techs: number[] = [];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const slot = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 10, h, m)).toISOString();

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_NAME = DB;
    process.env.JWT_ACCESS_SECRET = 'integration-test-secret-integration-test-secret';
    const { migrate } = await import('../scripts/migrate');
    const { bootstrap } = await import('../scripts/bootstrap');
    const { createApp } = await import('../app');
    const { query } = await import('../db');
    await migrate();
    await bootstrap({ companyName: 'Test Co', branchName: 'Main', adminName: 'Admin', adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    app = createApp();

    const login = await request(app).post('/api/auth/login').send(ADMIN);
    assert.equal(login.status, 200);
    adminToken = login.body.accessToken;
    branchId = Number((await query<{ Id: number }>(`SELECT TOP 1 Id FROM Branches`))[0].Id);

    const cust = await request(app).post('/api/customers').set(auth(adminToken)).send({
      name: 'Test Customer', mobile: '+966 55 000 1111', addresses: [{ label: 'Home', city: 'Riyadh' }],
    });
    assert.equal(cust.status, 201);
    customerId = cust.body.id;
    addressId = Number((await query<{ Id: number }>(`SELECT TOP 1 Id FROM CustomerAddresses WHERE CustomerId=@c`, { c: customerId }))[0].Id);

    const svc = await request(app).post('/api/services').set(auth(adminToken)).send({ name: 'Deep cleaning', pricingMethod: 'fixed', defaultMinutes: 120, price: 100 });
    assert.equal(svc.status, 201);
    serviceId = svc.body.id;

    for (const n of ['Tech A', 'Tech B']) {
      const t = await request(app).post('/api/technicians').set(auth(adminToken)).send({ fullName: n, branchId });
      assert.equal(t.status, 201);
      techs.push(t.body.id);
    }

    const roles = await request(app).get('/api/users/roles').set(auth(adminToken));
    const agentRole = roles.body.items.find((r: { Name: string }) => r.Name === 'Booking Agent').Id;
    const u = await request(app).post('/api/users').set(auth(adminToken)).send({ fullName: 'Agent', email: AGENT.email, password: AGENT.password, branchId, roleIds: [agentRole] });
    assert.equal(u.status, 201);
    const al = await request(app).post('/api/auth/login').send(AGENT);
    agentToken = al.body.accessToken;
  });

  after(async () => {
    if (!enabled) return;
    const { closePool } = await import('../db');
    await closePool();
    const { config } = await import('../config');
    const master = await new sql.ConnectionPool({
      server: config.db.server, port: config.db.port, user: config.db.user, password: config.db.password, database: 'master',
      options: { encrypt: config.db.encrypt, trustServerCertificate: config.db.trustServerCertificate },
    }).connect();
    await master.request().query(`ALTER DATABASE [${DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB}]`);
    await master.close();
  });

  const book = (over: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post('/api/bookings').set(auth(token)).send({
      customerId, addressId, branchId, startAt: slot(10), endAt: slot(12), lines: [{ serviceId, quantity: 2 }], technicianIds: [], ...over,
    });

  test('creates a booking with correct totals (VAT 15%) and history', async () => {
    const r = await book({ technicianIds: [techs[0]] });
    assert.equal(r.status, 201);
    assert.equal(r.body.subtotal, 200);
    assert.equal(r.body.vat, 30);
    assert.equal(r.body.total, 230);
    assert.equal(r.body.status, 'assigned');
    const d = await request(app).get(`/api/bookings/${r.body.id}`).set(auth(adminToken));
    assert.equal(d.body.history.length, 1);
    assert.equal(d.body.assignments.length, 1);
  });

  test('overlapping booking for the same technician is rejected, including the travel buffer', async () => {
    const same = await book({ technicianIds: [techs[0]], startAt: slot(11), endAt: slot(13) });
    assert.equal(same.status, 409);
    assert.equal(same.body.error.code, 'TECHNICIAN_CONFLICT');
    const tooClose = await book({ technicianIds: [techs[0]], startAt: slot(12, 10), endAt: slot(14) });
    assert.equal(tooClose.status, 409);
    const ok = await book({ technicianIds: [techs[0]], startAt: slot(13), endAt: slot(15) });
    assert.equal(ok.status, 201);
  });

  test('concurrent requests for the same technician: exactly one succeeds', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => book({ technicianIds: [techs[1]], startAt: slot(8), endAt: slot(9) })),
    );
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [201, 409, 409, 409, 409, 409]);
  });

  test('database trigger blocks overlapping assignments even when the API is bypassed', async () => {
    const { query } = await import('../db');
    const rows = await query<{ Id: number }>(`SELECT TOP 1 BookingId AS Id FROM BookingAssignments WHERE TechnicianId=@t AND IsActive=1`, { t: techs[1] });
    await assert.rejects(
      query(`INSERT INTO BookingAssignments (BookingId, TechnicianId, StartAt, EndAt) VALUES (@b,@t,@s,@e)`, { b: rows[0].Id, t: techs[1], s: new Date(slot(8, 30)), e: new Date(slot(9, 30)) }),
      /TECHNICIAN_OVERLAP/,
    );
  });

  test('idempotency key returns the same booking instead of duplicating', async () => {
    const key = `idem-${Date.now()}-abcdef`;
    const a = await book({ idempotencyKey: key, startAt: slot(16), endAt: slot(17) });
    const b = await book({ idempotencyKey: key, startAt: slot(16), endAt: slot(17) });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.body.id, b.body.id);
  });

  test('status machine: invalid jump rejected, reason required, cancel frees the technician', async () => {
    const r = await book({ technicianIds: [techs[1]], startAt: slot(18), endAt: slot(19) });
    assert.equal(r.status, 201);
    const bad = await request(app).post(`/api/bookings/${r.body.id}/status`).set(auth(adminToken)).send({ status: 'done' });
    assert.equal(bad.status, 409);
    const noReason = await request(app).post(`/api/bookings/${r.body.id}/status`).set(auth(adminToken)).send({ status: 'cancelled' });
    assert.equal(noReason.status, 400);
    const blocked = await book({ technicianIds: [techs[1]], startAt: slot(18), endAt: slot(19) });
    assert.equal(blocked.status, 409);
    const cancel = await request(app).post(`/api/bookings/${r.body.id}/status`).set(auth(adminToken)).send({ status: 'cancelled', reason: 'customer request' });
    assert.equal(cancel.status, 200);
    const freed = await book({ technicianIds: [techs[1]], startAt: slot(18), endAt: slot(19) });
    assert.equal(freed.status, 201);
  });

  test('reschedule re-checks conflicts', async () => {
    const r = await book({ technicianIds: [techs[1]], startAt: slot(20), endAt: slot(21) });
    assert.equal(r.status, 201);
    const clash = await request(app).post(`/api/bookings/${r.body.id}/reschedule`).set(auth(adminToken)).send({ startAt: slot(8), endAt: slot(9), reason: 'test' });
    assert.equal(clash.status, 409);
    const fine = await request(app).post(`/api/bookings/${r.body.id}/reschedule`).set(auth(adminToken)).send({ startAt: slot(22), endAt: slot(23), reason: 'test' });
    assert.equal(fine.status, 200);
  });

  test('permissions are enforced by the API, not the UI', async () => {
    assert.equal((await request(app).get('/api/dashboard').set(auth(agentToken))).status, 403);
    assert.equal((await request(app).get('/api/users').set(auth(agentToken))).status, 403);
    assert.equal((await request(app).post('/api/bookings/1/assign').set(auth(agentToken)).send({ technicianIds: [techs[0]] })).status, 403);
    const disc = await book({ discount: 10, startAt: slot(5), endAt: slot(6) }, agentToken);
    assert.equal(disc.status, 403);
    const priced = await book({ lines: [{ serviceId, quantity: 1, unitPrice: 1 }], startAt: slot(5), endAt: slot(6) }, agentToken);
    assert.equal(priced.status, 403);
    const plain = await book({ startAt: slot(5), endAt: slot(6) }, agentToken);
    assert.equal(plain.status, 201);
    assert.equal((await request(app).get('/api/bookings')).status, 401);
  });

  test('duplicate customer needs explicit confirmation', async () => {
    const body = { name: 'Same Phone', mobile: '0550001111' };
    const dup = await request(app).post('/api/customers').set(auth(adminToken)).send(body);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_CUSTOMER');
    const forced = await request(app).post('/api/customers').set(auth(adminToken)).send({ ...body, force: true });
    assert.equal(forced.status, 201);
  });

  test('refresh tokens rotate and reuse revokes the session', async () => {
    const login = await request(app).post('/api/auth/login').send(ADMIN);
    const first = login.body.refreshToken;
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    assert.equal(rotated.status, 200);
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    assert.equal(reuse.status, 401);
    const afterReuse = await request(app).post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    assert.equal(afterReuse.status, 401);
  });

  test('dashboard is computed from real rows', async () => {
    const d = await request(app).get('/api/dashboard').set(auth(adminToken));
    assert.equal(d.status, 200);
    assert.ok(Array.isArray(d.body.topServices));
    assert.equal(d.body.technicians.available + d.body.technicians.busy + d.body.technicians.absent + d.body.technicians.offDuty, 2);
  });
});
