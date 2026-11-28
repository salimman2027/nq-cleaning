"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.financeRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
/**
 * Expenses, staff performance and a simple monthly profit-and-loss. Everything is computed from stored data; there is no
 * ERP or inventory link yet. Time zone is Asia/Riyadh (UTC+3). Only bookings in status done/closed count as work performed.
 */
exports.financeRouter = (0, express_1.Router)();
const LOCAL = (col) => `CAST(DATEADD(hour,3,${col}) AS DATE)`;
const DONE = `('done','closed')`;
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const monthSchema = zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const monthRange = (m) => {
    const from = `${m}-01`;
    const d = new Date(Date.parse(`${from}T00:00:00Z`));
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    return { from, to };
};
const expenseSchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: zod_1.z.string().trim().min(2).max(60),
    description: zod_1.z.string().trim().max(300).optional(),
    amount: zod_1.z.number().positive().max(10_000_000),
});
exports.financeRouter.get('/expenses', (0, middleware_1.requirePerm)('finance.view_cost'), (0, errors_1.h)(async (req, res) => {
    const { month } = (0, errors_1.parse)(zod_1.z.object({ month: monthSchema.default(riyadhToday().slice(0, 7)) }), req.query);
    const { from, to } = monthRange(month);
    const items = await (0, db_1.query)(`SELECT Id, ExpenseDate, Category, Description, Amount FROM Expenses WHERE CompanyId=@c AND IsDeleted=0 AND ExpenseDate>=@f AND ExpenseDate<@t ORDER BY ExpenseDate DESC, Id DESC`, { c: req.user.companyId, f: from, t: to });
    res.json({ month, items });
}));
exports.financeRouter.post('/expenses', (0, middleware_1.requirePerm)('finance.view_cost'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(expenseSchema, req.body);
    if (Number.isNaN(Date.parse(b.date)))
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Invalid date');
    const r = await (0, db_1.query)(`INSERT INTO Expenses (CompanyId, ExpenseDate, Category, Description, Amount, CreatedBy) OUTPUT INSERTED.Id VALUES (@c,@d,@k,@n,@a,@u)`, { c: req.user.companyId, d: b.date, k: b.category, n: b.description ?? null, a: b.amount, u: req.user.id });
    await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','Expense',@e)`, { c: req.user.companyId, u: req.user.id, e: String(r[0].Id) });
    res.status(201).json({ id: Number(r[0].Id) });
}));
exports.financeRouter.delete('/expenses/:id', (0, middleware_1.requirePerm)('finance.view_cost'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const r = await (0, db_1.query)(`UPDATE Expenses SET IsDeleted=1 OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Expense not found');
    await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'delete','Expense',@e)`, { c: req.user.companyId, u: req.user.id, e: String(id) });
    res.status(204).end();
}));
/** Monthly profit and loss: revenue of finished bookings minus technician cost minus expenses. */
exports.financeRouter.get('/reports/profit', (0, middleware_1.requirePerm)('finance.view_cost'), (0, errors_1.h)(async (req, res) => {
    const { month } = (0, errors_1.parse)(zod_1.z.object({ month: monthSchema.default(riyadhToday().slice(0, 7)) }), req.query);
    const { from, to } = monthRange(month);
    const c = req.user.companyId;
    const p = { c, f: from, t: to };
    const rev = (await (0, db_1.query)(`SELECT COUNT(*) AS Orders, ISNULL(SUM(Total - Vat),0) AS Net, ISNULL(SUM(Vat),0) AS Vat, ISNULL(SUM(Total),0) AS Gross, ISNULL(SUM(Paid),0) AS Collected
       FROM Bookings WHERE CompanyId=@c AND IsDeleted=0 AND Status IN ${DONE} AND ${LOCAL('StartAt')} >= @f AND ${LOCAL('StartAt')} < @t`, p))[0];
    const pending = (await (0, db_1.query)(`SELECT COUNT(*) AS Orders, ISNULL(SUM(Total),0) AS Gross FROM Bookings WHERE CompanyId=@c AND IsDeleted=0 AND Status NOT IN ${DONE} AND Status NOT IN ('cancelled','postponed') AND ${LOCAL('StartAt')} >= @f AND ${LOCAL('StartAt')} < @t`, p))[0];
    const labor = (await (0, db_1.query)(`SELECT ISNULL(SUM(DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0 * t.HourlyCost),0) AS Cost, ISNULL(SUM(DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0),0) AS Hours
       FROM BookingAssignments a JOIN Bookings b ON b.Id=a.BookingId JOIN Technicians t ON t.Id=a.TechnicianId
      WHERE b.CompanyId=@c AND b.IsDeleted=0 AND a.IsActive=1 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} < @t`, p))[0];
    const byCat = await (0, db_1.query)(`SELECT Category, SUM(Amount) AS Total FROM Expenses WHERE CompanyId=@c AND IsDeleted=0 AND ExpenseDate>=@f AND ExpenseDate<@t GROUP BY Category ORDER BY SUM(Amount) DESC`, p);
    const expenses = byCat.reduce((a, r) => a + Number(r.Total), 0);
    const net = Number(rev.Net), laborCost = Math.round(Number(labor.Cost) * 100) / 100;
    const profit = Math.round((net - laborCost - expenses) * 100) / 100;
    res.json({
        month,
        revenue: { orders: Number(rev.Orders), net, vat: Number(rev.Vat), gross: Number(rev.Gross), collected: Number(rev.Collected) },
        expectedRevenue: { orders: Number(pending.Orders), gross: Number(pending.Gross) },
        laborCost, laborHours: Math.round(Number(labor.Hours) * 100) / 100,
        expenses: { total: expenses, byCategory: byCat.map((r) => ({ category: r.Category, total: Number(r.Total) })) },
        profit, isLoss: profit < 0,
        notes: ['revenue counts finished bookings only', 'technician cost = scheduled hours x hourly cost', 'no inventory or accounting-system link yet'],
    });
}));
const dateSchema = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Key indicators and the management summary for a period (default: this month to today). Computed from stored data only. */
exports.financeRouter.get('/reports/overview', (0, middleware_1.requirePerm)('finance.view_cost'), (0, errors_1.h)(async (req, res) => {
    const q = (0, errors_1.parse)(zod_1.z.object({ from: dateSchema.default(`${riyadhToday().slice(0, 7)}-01`), to: dateSchema.default(riyadhToday()) }), req.query);
    const p = { c: req.user.companyId, f: q.from, t: q.to };
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const reqs = (await (0, db_1.query)(`SELECT COUNT(*) AS Total, SUM(CASE WHEN Status='new' THEN 1 ELSE 0 END) AS New, SUM(CASE WHEN Status='confirmed' THEN 1 ELSE 0 END) AS Confirmed, SUM(CASE WHEN Status='cancelled' THEN 1 ELSE 0 END) AS Cancelled
       FROM BookingRequests WHERE CompanyId=@c AND ${LOCAL('CreatedAt')} >= @f AND ${LOCAL('CreatedAt')} <= @t`, p))[0];
    const bk = (await (0, db_1.query)(`SELECT COUNT(*) AS Total, SUM(CASE WHEN Status IN ${DONE} THEN 1 ELSE 0 END) AS Done, SUM(CASE WHEN Status='cancelled' THEN 1 ELSE 0 END) AS Cancelled,
            ISNULL(SUM(CASE WHEN Status IN ${DONE} THEN Total - Vat ELSE 0 END),0) AS Net, ISNULL(SUM(CASE WHEN Status IN ${DONE} THEN Total ELSE 0 END),0) AS Gross,
            ISNULL(SUM(CASE WHEN Status IN ${DONE} THEN Paid ELSE 0 END),0) AS Collected
       FROM Bookings WHERE CompanyId=@c AND IsDeleted=0 AND ${LOCAL('StartAt')} >= @f AND ${LOCAL('StartAt')} <= @t`, p))[0];
    const labor = (await (0, db_1.query)(`SELECT ISNULL(SUM(DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0 * t.HourlyCost),0) AS Cost FROM BookingAssignments a JOIN Bookings b ON b.Id=a.BookingId JOIN Technicians t ON t.Id=a.TechnicianId
      WHERE b.CompanyId=@c AND b.IsDeleted=0 AND a.IsActive=1 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} <= @t`, p))[0];
    const exp = (await (0, db_1.query)(`SELECT ISNULL(SUM(Amount),0) AS T FROM Expenses WHERE CompanyId=@c AND IsDeleted=0 AND ExpenseDate>=@f AND ExpenseDate<=@t`, p))[0];
    const rate = (await (0, db_1.query)(`SELECT AVG(CAST(r.Stars AS FLOAT)) AS Avg, COUNT(*) AS N FROM Ratings r WHERE r.CompanyId=@c AND r.Stars IS NOT NULL AND ${LOCAL('r.SubmittedAt')} >= @f AND ${LOCAL('r.SubmittedAt')} <= @t`, p))[0];
    const comp = (await (0, db_1.query)(`SELECT COUNT(*) AS OpenN FROM Complaints WHERE CompanyId=@c AND Status<>'resolved'`, { c: p.c }))[0];
    const byService = await (0, db_1.query)(`SELECT s.Name, COUNT(DISTINCT b.Id) AS Orders, ISNULL(SUM(d.LineTotal),0) AS Revenue FROM BookingDetails d JOIN Bookings b ON b.Id=d.BookingId JOIN Services s ON s.Id=d.ServiceId
      WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} <= @t GROUP BY s.Name ORDER BY SUM(d.LineTotal) DESC`, p);
    const bySup = await (0, db_1.query)(`SELECT s.Id, s.FullName, COUNT(b.Id) AS Orders, ISNULL(SUM(b.Total - b.Vat),0) AS Revenue,
            (SELECT AVG(CAST(r.Stars AS FLOAT)) FROM Ratings r JOIN Bookings bb ON bb.Id=r.BookingId WHERE bb.SupervisorId=s.Id AND r.Stars IS NOT NULL AND ${LOCAL('bb.StartAt')} >= @f AND ${LOCAL('bb.StartAt')} <= @t) AS AvgRating
       FROM Supervisors s LEFT JOIN Bookings b ON b.SupervisorId=s.Id AND b.CompanyId=@c AND b.IsDeleted=0 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} <= @t
      WHERE s.CompanyId=@c AND s.IsDeleted=0 GROUP BY s.Id, s.FullName ORDER BY COUNT(b.Id) DESC, s.FullName`, p);
    const dReq = await (0, db_1.query)(`SELECT CONVERT(VARCHAR(10), ${LOCAL('CreatedAt')}, 23) AS D, COUNT(*) AS N FROM BookingRequests WHERE CompanyId=@c AND ${LOCAL('CreatedAt')} >= @f AND ${LOCAL('CreatedAt')} <= @t GROUP BY ${LOCAL('CreatedAt')}`, p);
    const dRev = await (0, db_1.query)(`SELECT CONVERT(VARCHAR(10), ${LOCAL('StartAt')}, 23) AS D, COUNT(*) AS N, ISNULL(SUM(Total - Vat),0) AS R FROM Bookings WHERE CompanyId=@c AND IsDeleted=0 AND Status IN ${DONE} AND ${LOCAL('StartAt')} >= @f AND ${LOCAL('StartAt')} <= @t GROUP BY ${LOCAL('StartAt')}`, p);
    const reqMap = new Map(dReq.map((r) => [r.D, Number(r.N)])), revMap = new Map(dRev.map((r) => [r.D, r]));
    const daily = [];
    for (let t = Date.parse(`${q.from}T00:00:00Z`), end = Date.parse(`${q.to}T00:00:00Z`); t <= end && daily.length < 400; t += 86_400_000) {
        const date = new Date(t).toISOString().slice(0, 10), rv = revMap.get(date);
        daily.push({ date, requests: reqMap.get(date) ?? 0, bookings: rv ? Number(rv.N) : 0, revenue: rv ? r2(rv.R) : 0 });
    }
    const requests = Number(reqs.Total), confirmed = Number(reqs.Confirmed), bookings = Number(bk.Total), done = Number(bk.Done), cancelled = Number(bk.Cancelled);
    const net = Number(bk.Net), laborCost = r2(labor.Cost), expenses = r2(exp.T);
    res.json({
        from: q.from, to: q.to,
        requests: { total: requests, new: Number(reqs.New), confirmed, cancelled: Number(reqs.Cancelled), conversionPct: requests ? r2((confirmed / requests) * 100) : null },
        bookings: { total: bookings, done, cancelled, cancelPct: bookings ? r2((cancelled / bookings) * 100) : null },
        money: { net: r2(net), gross: r2(bk.Gross), collected: r2(bk.Collected), outstanding: r2(Number(bk.Gross) - Number(bk.Collected)), laborCost, expenses, profit: r2(net - laborCost - expenses) },
        rating: { average: rate.Avg == null ? null : r2(rate.Avg), count: Number(rate.N) },
        openComplaints: Number(comp.OpenN),
        daily: daily.slice(-92),
        byService: byService.map((s) => ({ name: s.Name, orders: Number(s.Orders), revenue: r2(s.Revenue) })),
        bySupervisor: bySup.map((s) => ({ id: s.Id, name: s.FullName, orders: Number(s.Orders), revenue: r2(s.Revenue), avgRating: s.AvgRating == null ? null : r2(s.AvgRating) })),
        notes: ['dates use Riyadh time', 'revenue counts finished bookings only', 'technician cost = scheduled hours x hourly cost', 'on-time rate is not tracked yet'],
    });
}));
/** Orders and hours per supervisor and per technician, with overtime above a standard working day. */
exports.financeRouter.get('/reports/staff', (0, middleware_1.requirePerm)('finance.view_cost'), (0, errors_1.h)(async (req, res) => {
    const q = (0, errors_1.parse)(zod_1.z.object({
        from: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(`${riyadhToday().slice(0, 7)}-01`),
        to: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(riyadhToday()),
        dayHours: zod_1.z.coerce.number().min(1).max(24).default(8),
    }), req.query);
    const p = { c: req.user.companyId, f: q.from, t: q.to, h: q.dayHours };
    const win = `b.CompanyId=@c AND b.IsDeleted=0 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} <= @t`;
    const supervisors = await (0, db_1.query)(`SELECT s.Id, s.FullName, COUNT(b.Id) AS Orders, ISNULL(SUM(b.Total - b.Vat),0) AS Revenue,
            ISNULL(SUM(DATEDIFF(MINUTE, b.StartAt, b.EndAt)) / 60.0, 0) AS Hours
       FROM Supervisors s LEFT JOIN Bookings b ON b.SupervisorId=s.Id AND ${win}
      WHERE s.CompanyId=@c AND s.IsDeleted=0 GROUP BY s.Id, s.FullName ORDER BY COUNT(b.Id) DESC, s.FullName`, p);
    const technicians = await (0, db_1.query)(`WITH w AS (
       SELECT a.TechnicianId, ${LOCAL('b.StartAt')} AS D, b.Id AS BookingId, DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0 AS H
         FROM BookingAssignments a JOIN Bookings b ON b.Id=a.BookingId WHERE a.IsActive=1 AND ${win}),
     d AS (SELECT TechnicianId, D, SUM(H) AS H FROM w GROUP BY TechnicianId, D)
     SELECT t.Id, t.FullName, t.HourlyCost, t.SupervisorId, sp.FullName AS SupervisorName,
            (SELECT COUNT(DISTINCT BookingId) FROM w WHERE w.TechnicianId=t.Id) AS Orders,
            ISNULL((SELECT SUM(H) FROM d WHERE d.TechnicianId=t.Id),0) AS Hours,
            ISNULL((SELECT SUM(CASE WHEN H > @h THEN H - @h ELSE 0 END) FROM d WHERE d.TechnicianId=t.Id),0) AS OvertimeHours
       FROM Technicians t LEFT JOIN Supervisors sp ON sp.Id=t.SupervisorId
      WHERE t.CompanyId=@c AND t.IsDeleted=0 ORDER BY sp.FullName, t.FullName`, p);
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const canCost = req.user.perms.includes('finance.view_cost');
    res.json({
        from: q.from, to: q.to, dayHours: q.dayHours,
        note: 'hours are the scheduled booking hours of finished bookings; overtime = hours above the standard day per technician per day',
        supervisors: supervisors.map((s) => ({ ...s, Hours: r2(s.Hours), Revenue: r2(s.Revenue) })),
        technicians: technicians.map((t) => ({ ...t, Hours: r2(t.Hours), OvertimeHours: r2(t.OvertimeHours), Cost: canCost ? r2(Number(t.Hours) * Number(t.HourlyCost)) : undefined })),
    });
}));
