import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { escapeLike, normalizeMobile } from '../lib/phone';

export const customersRouter = Router();

const addressSchema = z.object({
  label: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  street: z.string().max(300).optional(),
  mapUrl: z.string().url().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const customerSchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(['individual', 'company']).default('individual'),
  mobile: z.string().min(7).max(20),
  whatsapp: z.string().max(20).optional(),
  email: z.string().email().max(256).optional(),
  vatNumber: z.string().max(20).optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(4000).optional(),
  addresses: z.array(addressSchema).max(10).optional(),
  /** Set to true after the user has seen the duplicate warning and still wants to create the customer. */
  force: z.boolean().optional(),
});

customersRouter.get(
  '/',
  requirePerm('customers.view'),
  h(async (req, res) => {
    const q = parse(z.object({ q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
    const like = q.q ? `%${escapeLike(q.q.trim())}%` : null;
    const digits = q.q ? normalizeMobile(q.q) : '';
    const mobileLike = digits.length >= 3 ? `%${escapeLike(digits)}%` : null;
    const where = `c.CompanyId = @c AND c.IsDeleted = 0 AND (@like IS NULL OR c.Name LIKE @like ESCAPE '\\' OR c.Code LIKE @like ESCAPE '\\' OR (@mlike IS NOT NULL AND c.Mobile LIKE @mlike ESCAPE '\\'))`;
    const p = { c: req.user!.companyId, like, mlike: mobileLike, off: (q.page - 1) * q.pageSize, ps: q.pageSize };
    const items = await query(
      `SELECT c.Id, c.Code, c.Name, c.Type, c.Mobile, c.Email, c.CreatedAt FROM Customers c WHERE ${where}
        ORDER BY c.CreatedAt DESC, c.Id DESC OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY`,
      p,
    );
    const total = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM Customers c WHERE ${where}`, p);
    res.json({ items, total: total[0].n, page: q.page, pageSize: q.pageSize });
  }),
);

customersRouter.get(
  '/:id',
  requirePerm('customers.view'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const rows = await query(`SELECT * FROM Customers WHERE Id = @i AND CompanyId = @c AND IsDeleted = 0`, { i: id, c: req.user!.companyId });
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    const addresses = await query(`SELECT * FROM CustomerAddresses WHERE CustomerId = @i AND IsDeleted = 0`, { i: id });
    res.json({ ...rows[0], addresses });
  }),
);

customersRouter.post(
  '/',
  requirePerm('customers.create'),
  h(async (req, res) => {
    const b = parse(customerSchema, req.body);
    const u = req.user!;
    const mobile = normalizeMobile(b.mobile);
    const dup = await query<{ Id: number; Code: string; Name: string }>(
      `SELECT TOP 1 Id, Code, Name FROM Customers WHERE CompanyId = @c AND Mobile = @m AND IsDeleted = 0`,
      { c: u.companyId, m: mobile },
    );
    if (dup[0] && !b.force) {
      throw new HttpError(409, 'DUPLICATE_CUSTOMER', 'A customer with this mobile number already exists', dup[0]);
    }
    const created = await withTx(async (tx) => {
      const rows = await query<{ Id: number; Code: string }>(
        `INSERT INTO Customers (CompanyId, Code, Name, Type, Mobile, Whatsapp, Email, VatNumber, Source, Notes, CreatedBy)
         OUTPUT INSERTED.Id, INSERTED.Code
         VALUES (@c, 'C-' + RIGHT('000000' + CAST(NEXT VALUE FOR CustomerCodeSeq AS VARCHAR(12)), 6), @n, @t, @m, @w, @e, @v, @s, @notes, @u)`,
        { c: u.companyId, n: b.name, t: b.type, m: mobile, w: b.whatsapp ? normalizeMobile(b.whatsapp) : null, e: b.email ?? null, v: b.vatNumber ?? null, s: b.source ?? null, notes: b.notes ?? null, u: u.id },
        tx,
      );
      const id = Number(rows[0].Id);
      for (const a of b.addresses ?? []) {
        await insertAddress(id, a, tx);
      }
      await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','Customer',@e)`, { c: u.companyId, u: u.id, e: String(id) }, tx);
      return { id, code: rows[0].Code };
    });
    res.status(201).json(created);
  }),
);

async function insertAddress(customerId: number, a: z.infer<typeof addressSchema>, tx?: import('mssql').Transaction): Promise<number> {
  const rows = await query<{ Id: number }>(
    `INSERT INTO CustomerAddresses (CustomerId, Label, City, District, Street, MapUrl, Latitude, Longitude)
     OUTPUT INSERTED.Id VALUES (@cu, @l, @ci, @d, @s, @m, @la, @lo)`,
    { cu: customerId, l: a.label ?? null, ci: a.city ?? null, d: a.district ?? null, s: a.street ?? null, m: a.mapUrl ?? null, la: a.latitude ?? null, lo: a.longitude ?? null },
    tx,
  );
  return Number(rows[0].Id);
}

customersRouter.put(
  '/:id',
  requirePerm('customers.update'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const b = parse(customerSchema.omit({ addresses: true, force: true }), req.body);
    const rows = await query(
      `UPDATE Customers SET Name=@n, Type=@t, Mobile=@m, Whatsapp=@w, Email=@e, VatNumber=@v, Source=@s, Notes=@notes, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u
       OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`,
      { i: id, c: req.user!.companyId, n: b.name, t: b.type, m: normalizeMobile(b.mobile), w: b.whatsapp ? normalizeMobile(b.whatsapp) : null, e: b.email ?? null, v: b.vatNumber ?? null, s: b.source ?? null, notes: b.notes ?? null, u: req.user!.id },
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.json({ id });
  }),
);

customersRouter.post(
  '/:id/addresses',
  requirePerm('customers.update'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const a = parse(addressSchema, req.body);
    const own = await query(`SELECT Id FROM Customers WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user!.companyId });
    if (!own[0]) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.status(201).json({ id: await insertAddress(id, a) });
  }),
);

customersRouter.delete(
  '/:id',
  requirePerm('customers.delete'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const open = await query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM Bookings WHERE CustomerId=@i AND IsDeleted=0 AND Status NOT IN ('closed','cancelled','done')`,
      { i: id },
    );
    if (open[0].n > 0) throw new HttpError(409, 'HAS_OPEN_BOOKINGS', 'Customer has open bookings');
    const rows = await query(
      `UPDATE Customers SET IsDeleted=1, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`,
      { i: id, c: req.user!.companyId, u: req.user!.id },
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.status(204).end();
  }),
);
