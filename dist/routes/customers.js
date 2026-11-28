"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const requestSync_1 = require("../services/requestSync");
const middleware_1 = require("../auth/middleware");
const phone_1 = require("../lib/phone");
exports.customersRouter = (0, express_1.Router)();
const addressSchema = zod_1.z.object({
    label: zod_1.z.string().max(100).optional(),
    city: zod_1.z.string().max(100).optional(),
    district: zod_1.z.string().max(100).optional(),
    street: zod_1.z.string().max(300).optional(),
    mapUrl: zod_1.z.string().url().max(500).optional(),
    latitude: zod_1.z.number().min(-90).max(90).optional(),
    longitude: zod_1.z.number().min(-180).max(180).optional(),
});
const customerSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    type: zod_1.z.enum(['individual', 'company']).default('individual'),
    mobile: zod_1.z.string().min(7).max(20),
    whatsapp: zod_1.z.string().max(20).optional(),
    email: zod_1.z.string().email().max(256).optional(),
    vatNumber: zod_1.z.string().max(20).optional(),
    source: zod_1.z.string().max(100).optional(),
    notes: zod_1.z.string().max(4000).optional(),
    addresses: zod_1.z.array(addressSchema).max(10).optional(),
    /** Set to true after the user has seen the duplicate warning and still wants to create the customer. */
    force: zod_1.z.boolean().optional(),
});
exports.customersRouter.get('/', (0, middleware_1.requirePerm)('customers.view'), (0, errors_1.h)(async (req, res) => {
    await (0, requestSync_1.backfillConfirmed)(req.user.companyId, req.user.id);
    const q = (0, errors_1.parse)(zod_1.z.object({ q: zod_1.z.string().max(100).optional(), page: zod_1.z.coerce.number().int().min(1).default(1), pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(25) }), req.query);
    const like = q.q ? `%${(0, phone_1.escapeLike)(q.q.trim())}%` : null;
    const digits = q.q ? (0, phone_1.normalizeMobile)(q.q) : '';
    const mobileLike = digits.length >= 3 ? `%${(0, phone_1.escapeLike)(digits)}%` : null;
    const where = `c.CompanyId = @c AND c.IsDeleted = 0 AND (@like IS NULL OR c.Name LIKE @like ESCAPE '\\' OR c.Code LIKE @like ESCAPE '\\' OR (@mlike IS NOT NULL AND c.Mobile LIKE @mlike ESCAPE '\\'))`;
    const p = { c: req.user.companyId, like, mlike: mobileLike, off: (q.page - 1) * q.pageSize, ps: q.pageSize };
    const items = await (0, db_1.query)(`SELECT c.Id, c.Code, c.Name, c.Type, c.Mobile, c.Email, c.CreatedAt FROM Customers c WHERE ${where}
        ORDER BY c.CreatedAt DESC, c.Id DESC OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY`, p);
    const total = await (0, db_1.query)(`SELECT COUNT(*) AS n FROM Customers c WHERE ${where}`, p);
    res.json({ items, total: total[0].n, page: q.page, pageSize: q.pageSize });
}));
exports.customersRouter.get('/:id', (0, middleware_1.requirePerm)('customers.view'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const rows = await (0, db_1.query)(`SELECT * FROM Customers WHERE Id = @i AND CompanyId = @c AND IsDeleted = 0`, { i: id, c: req.user.companyId });
    if (!rows[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    const addresses = await (0, db_1.query)(`SELECT * FROM CustomerAddresses WHERE CustomerId = @i AND IsDeleted = 0`, { i: id });
    res.json({ ...rows[0], addresses });
}));
exports.customersRouter.post('/', (0, middleware_1.requirePerm)('customers.create'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(customerSchema, req.body);
    const u = req.user;
    const mobile = (0, phone_1.normalizeMobile)(b.mobile);
    const dup = await (0, db_1.query)(`SELECT TOP 1 Id, Code, Name FROM Customers WHERE CompanyId = @c AND Mobile = @m AND IsDeleted = 0`, { c: u.companyId, m: mobile });
    if (dup[0] && !b.force) {
        throw new errors_1.HttpError(409, 'DUPLICATE_CUSTOMER', 'A customer with this mobile number already exists', dup[0]);
    }
    const created = await (0, db_1.withTx)(async (tx) => {
        const rows = await (0, db_1.query)(`INSERT INTO Customers (CompanyId, Code, Name, Type, Mobile, Whatsapp, Email, VatNumber, Source, Notes, CreatedBy)
         OUTPUT INSERTED.Id, INSERTED.Code
         VALUES (@c, 'C-' + RIGHT('000000' + CAST(NEXT VALUE FOR CustomerCodeSeq AS VARCHAR(12)), 6), @n, @t, @m, @w, @e, @v, @s, @notes, @u)`, { c: u.companyId, n: b.name, t: b.type, m: mobile, w: b.whatsapp ? (0, phone_1.normalizeMobile)(b.whatsapp) : null, e: b.email ?? null, v: b.vatNumber ?? null, s: b.source ?? null, notes: b.notes ?? null, u: u.id }, tx);
        const id = Number(rows[0].Id);
        for (const a of b.addresses ?? []) {
            await insertAddress(id, a, tx);
        }
        await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','Customer',@e)`, { c: u.companyId, u: u.id, e: String(id) }, tx);
        return { id, code: rows[0].Code };
    });
    res.status(201).json(created);
}));
async function insertAddress(customerId, a, tx) {
    const rows = await (0, db_1.query)(`INSERT INTO CustomerAddresses (CustomerId, Label, City, District, Street, MapUrl, Latitude, Longitude)
     OUTPUT INSERTED.Id VALUES (@cu, @l, @ci, @d, @s, @m, @la, @lo)`, { cu: customerId, l: a.label ?? null, ci: a.city ?? null, d: a.district ?? null, s: a.street ?? null, m: a.mapUrl ?? null, la: a.latitude ?? null, lo: a.longitude ?? null }, tx);
    return Number(rows[0].Id);
}
exports.customersRouter.put('/:id', (0, middleware_1.requirePerm)('customers.update'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const b = (0, errors_1.parse)(customerSchema.omit({ addresses: true, force: true }), req.body);
    const rows = await (0, db_1.query)(`UPDATE Customers SET Name=@n, Type=@t, Mobile=@m, Whatsapp=@w, Email=@e, VatNumber=@v, Source=@s, Notes=@notes, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u
       OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId, n: b.name, t: b.type, m: (0, phone_1.normalizeMobile)(b.mobile), w: b.whatsapp ? (0, phone_1.normalizeMobile)(b.whatsapp) : null, e: b.email ?? null, v: b.vatNumber ?? null, s: b.source ?? null, notes: b.notes ?? null, u: req.user.id });
    if (!rows[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.json({ id });
}));
exports.customersRouter.post('/:id/addresses', (0, middleware_1.requirePerm)('customers.update'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const a = (0, errors_1.parse)(addressSchema, req.body);
    const own = await (0, db_1.query)(`SELECT Id FROM Customers WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!own[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.status(201).json({ id: await insertAddress(id, a) });
}));
exports.customersRouter.delete('/:id', (0, middleware_1.requirePerm)('customers.delete'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const open = await (0, db_1.query)(`SELECT COUNT(*) AS n FROM Bookings WHERE CustomerId=@i AND IsDeleted=0 AND Status NOT IN ('closed','cancelled','done')`, { i: id });
    if (open[0].n > 0)
        throw new errors_1.HttpError(409, 'HAS_OPEN_BOOKINGS', 'Customer has open bookings');
    const rows = await (0, db_1.query)(`UPDATE Customers SET IsDeleted=1, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId, u: req.user.id });
    if (!rows[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.status(204).end();
}));
