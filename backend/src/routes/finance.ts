import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';

/**
 * Expenses, staff performance and a simple monthly profit-and-loss. Everything is computed from stored data; there is no
 * ERP or inventory link yet. Time zone is Asia/Riyadh (UTC+3). Only bookings in status done/closed count as work performed.
 */
export const financeRouter = Router();

const LOCAL = (col: string) => `CAST(DATEADD(hour,3,${col}) AS DATE)`;
const DONE = `('done','closed')`;
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const monthRange = (m: string) => {
  const from = `${m}-01`;
  const d = new Date(Date.parse(`${from}T00:00:00Z`));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return { from, to };
};

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  amount: z.number().positive().max(10_000_000),
});

financeRouter.get('/expenses', requirePerm('finance.view_cost'), h(async (req, res) => {
  const { month } = parse(z.object({ month: monthSchema.default(riyadhToday().slice(0, 7)) }), req.query);
  const { from, to } = monthRange(month);
  const items = await query(`SELECT Id, ExpenseDate, Category, Description, Amount FROM Expenses WHERE CompanyId=@c AND IsDeleted=0 AND ExpenseDate>=@f AND ExpenseDate<@t ORDER BY ExpenseDate DESC, Id DESC`, { c: req.user!.companyId, f: from, t: to });
  res.json({ month, items });
}));

financeRouter.post('/expenses', requirePerm('finance.view_cost'), h(async (req, res) => {
  const b = parse(expenseSchema, req.body);
  if (Number.isNaN(Date.parse(b.date))) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid date');
  const r = await query<{ Id: number }>(`INSERT INTO Expenses (CompanyId, ExpenseDate, Category, Description, Amount, CreatedBy) OUTPUT INSERTED.Id VALUES (@c,@d,@k,@n,@a,@u)`,
    { c: req.user!.companyId, d: b.date, k: b.category, n: b.description ?? null, a: b.amount, u: req.user!.id });
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','Expense',@e)`, { c: req.user!.companyId, u: req.user!.id, e: String(r[0].Id) });
  res.status(201).json({ id: Number(r[0].Id) });
}));

financeRouter.delete('/expenses/:id', requirePerm('finance.view_cost'), h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const r = await query(`UPDATE Expenses SET IsDeleted=1 OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user!.companyId });
  if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Expense not found');
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'delete','Expense',@e)`, { c: req.user!.companyId, u: req.user!.id, e: String(id) });
  res.status(204).end();
}));

/** Monthly profit and loss: revenue of finished bookings minus technician cost minus expenses. */
financeRouter.get('/reports/profit', requirePerm('finance.view_cost'), h(async (req, res) => {
  const { month } = parse(z.object({ month: monthSchema.default(riyadhToday().slice(0, 7)) }), req.query);
  const { from, to } = monthRange(month);
  const c = req.user!.companyId;
  const p = { c, f: from, t: to };
  const rev = (await query<Record<string, any>>(
    `SELECT COUNT(*) AS Orders, ISNULL(SUM(Total - Vat),0) AS Net, ISNULL(SUM(Vat),0) AS Vat, ISNULL(SUM(Total),0) AS Gross, ISNULL(SUM(Paid),0) AS Collected
       FROM Bookings WHERE CompanyId=@c AND IsDeleted=0 AND Status IN ${DONE} AND ${LOCAL('StartAt')} >= @f AND ${LOCAL('StartAt')} < @t`, p))[0];
  const pending = (await query<Record<string, any>>(
    `SELECT COUNT(*) AS Orders, ISNULL(SUM(Total),0) AS Gross FROM Bookings WHERE CompanyId=@c AND IsDeleted=0 AND Status NOT IN ${DONE} AND Status NOT IN ('cancelled','postponed') AND ${LOCAL('StartAt')} >= @f AND ${LOCAL('StartAt')} < @t`, p))[0];
  const labor = (await query<{ Cost: number; Hours: number }>(
    `SELECT ISNULL(SUM(DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0 * t.HourlyCost),0) AS Cost, ISNULL(SUM(DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0),0) AS Hours
       FROM BookingAssignments a JOIN Bookings b ON b.Id=a.BookingId JOIN Technicians t ON t.Id=a.TechnicianId
      WHERE b.CompanyId=@c AND b.IsDeleted=0 AND a.IsActive=1 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} < @t`, p))[0];
  const byCat = await query<{ Category: string; Total: number }>(`SELECT Category, SUM(Amount) AS Total FROM Expenses WHERE CompanyId=@c AND IsDeleted=0 AND ExpenseDate>=@f AND ExpenseDate<@t GROUP BY Category ORDER BY SUM(Amount) DESC`, p);
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

/** Orders and hours per supervisor and per technician, with overtime above a standard working day. */
financeRouter.get('/reports/staff', requirePerm('finance.view_cost'), h(async (req, res) => {
  const q = parse(z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(`${riyadhToday().slice(0, 7)}-01`),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(riyadhToday()),
    dayHours: z.coerce.number().min(1).max(24).default(8),
  }), req.query);
  const p = { c: req.user!.companyId, f: q.from, t: q.to, h: q.dayHours };
  const win = `b.CompanyId=@c AND b.IsDeleted=0 AND b.Status IN ${DONE} AND ${LOCAL('b.StartAt')} >= @f AND ${LOCAL('b.StartAt')} <= @t`;
  const supervisors = await query<Record<string, any>>(
    `SELECT s.Id, s.FullName, COUNT(b.Id) AS Orders, ISNULL(SUM(b.Total - b.Vat),0) AS Revenue,
            ISNULL(SUM(DATEDIFF(MINUTE, b.StartAt, b.EndAt)) / 60.0, 0) AS Hours
       FROM Supervisors s LEFT JOIN Bookings b ON b.SupervisorId=s.Id AND ${win}
      WHERE s.CompanyId=@c AND s.IsDeleted=0 GROUP BY s.Id, s.FullName ORDER BY COUNT(b.Id) DESC, s.FullName`, p);
  const technicians = await query<Record<string, any>>(
    `WITH w AS (
       SELECT a.TechnicianId, ${LOCAL('b.StartAt')} AS D, b.Id AS BookingId, DATEDIFF(MINUTE, a.StartAt, a.EndAt) / 60.0 AS H
         FROM BookingAssignments a JOIN Bookings b ON b.Id=a.BookingId WHERE a.IsActive=1 AND ${win}),
     d AS (SELECT TechnicianId, D, SUM(H) AS H FROM w GROUP BY TechnicianId, D)
     SELECT t.Id, t.FullName, t.HourlyCost, t.SupervisorId, sp.FullName AS SupervisorName,
            (SELECT COUNT(DISTINCT BookingId) FROM w WHERE w.TechnicianId=t.Id) AS Orders,
            ISNULL((SELECT SUM(H) FROM d WHERE d.TechnicianId=t.Id),0) AS Hours,
            ISNULL((SELECT SUM(CASE WHEN H > @h THEN H - @h ELSE 0 END) FROM d WHERE d.TechnicianId=t.Id),0) AS OvertimeHours
       FROM Technicians t LEFT JOIN Supervisors sp ON sp.Id=t.SupervisorId
      WHERE t.CompanyId=@c AND t.IsDeleted=0 ORDER BY sp.FullName, t.FullName`, p);
  const r2 = (n: unknown) => Math.round(Number(n) * 100) / 100;
  const canCost = req.user!.perms.includes('finance.view_cost');
  res.json({
    from: q.from, to: q.to, dayHours: q.dayHours,
    note: 'hours are the scheduled booking hours of finished bookings; overtime = hours above the standard day per technician per day',
    supervisors: supervisors.map((s) => ({ ...s, Hours: r2(s.Hours), Revenue: r2(s.Revenue) })),
    technicians: technicians.map((t) => ({ ...t, Hours: r2(t.Hours), OvertimeHours: r2(t.OvertimeHours), Cost: canCost ? r2(Number(t.Hours) * Number(t.HourlyCost)) : undefined })),
  });
}));
