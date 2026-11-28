"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const time_1 = require("../lib/time");
exports.dashboardRouter = (0, express_1.Router)();
/**
 * Every number comes from the database. Indicators that depend on modules not built yet
 * (ratings, utilisation, profit) are returned as null instead of invented values.
 */
exports.dashboardRouter.get('/', (0, middleware_1.requirePerm)('dashboard.view'), (0, errors_1.h)(async (req, res) => {
    const u = req.user;
    const now = new Date();
    const day = (0, time_1.riyadhDayRange)(now);
    const month = (0, time_1.riyadhMonthRange)(now);
    const p = {
        c: u.companyId, b: (0, middleware_1.branchScope)(u), ds: (0, db_1.dt)(day.start), de: (0, db_1.dt)(day.end), tde: (0, db_1.dt)(new Date(day.end.getTime() + 86400000)),
        ms: (0, db_1.dt)(month.start), me: (0, db_1.dt)(month.end), now: (0, db_1.dt)(now),
    };
    const base = `b.CompanyId=@c AND b.IsDeleted=0 AND (@b IS NULL OR b.BranchId=@b)`;
    const today = `b.StartAt >= @ds AND b.StartAt < @de`;
    const [counts] = await (0, db_1.query)(`SELECT
         COUNT(CASE WHEN ${today} THEN 1 END) AS todayTotal,
         COUNT(CASE WHEN ${today} AND b.Status = 'new' THEN 1 END) AS todayNew,
         COUNT(CASE WHEN ${today} AND b.Status = 'confirmed' THEN 1 END) AS todayConfirmed,
         COUNT(CASE WHEN ${today} AND b.Status IN ('on_the_way','arrived','in_progress','paused') THEN 1 END) AS todayInProgress,
         COUNT(CASE WHEN ${today} AND b.Status IN ('done','closed') THEN 1 END) AS todayDone,
         COUNT(CASE WHEN ${today} AND b.Status = 'cancelled' THEN 1 END) AS todayCancelled,
         COUNT(CASE WHEN b.StartAt >= @de AND b.StartAt < @tde AND b.Status NOT IN ('cancelled','postponed') THEN 1 END) AS tomorrow,
         COUNT(CASE WHEN b.StartAt < @now AND b.Status IN ('new','awaiting_confirmation','confirmed','awaiting_assignment','assigned') THEN 1 END) AS late,
         COUNT(CASE WHEN b.Status IN ('new','awaiting_confirmation','confirmed','awaiting_assignment')
                     AND b.StartAt >= @ds AND b.ActiveTechs = 0 THEN 1 END) AS unassigned
       FROM (SELECT b.*, (SELECT COUNT(*) FROM BookingAssignments a WHERE a.BookingId = b.Id AND a.IsActive = 1) AS ActiveTechs
               FROM Bookings b WHERE ${base}) b`, p);
    const [money] = await (0, db_1.query)(`SELECT
         ISNULL(SUM(CASE WHEN b.StartAt >= @ds AND b.StartAt < @de AND b.Status IN ('done','closed') THEN b.Subtotal - b.Discount END), 0) AS revenueToday,
         ISNULL(SUM(CASE WHEN b.StartAt >= @ms AND b.StartAt < @me AND b.Status IN ('done','closed') THEN b.Subtotal - b.Discount END), 0) AS revenueMonth,
         ISNULL(SUM(CASE WHEN b.StartAt >= @ms AND b.StartAt < @me AND b.Status <> 'cancelled' THEN b.Paid END), 0) AS collectedMonth,
         ISNULL(SUM(CASE WHEN b.StartAt >= @ms AND b.StartAt < @me AND b.Status <> 'cancelled' THEN b.Total - b.Paid END), 0) AS outstandingMonth
       FROM Bookings b WHERE ${base}`, p);
    const techs = await (0, db_1.query)(`SELECT t.Status, COUNT(*) AS n FROM Technicians t WHERE t.CompanyId=@c AND t.IsDeleted=0 AND (@b IS NULL OR t.BranchId=@b) GROUP BY t.Status`, p);
    const t = Object.fromEntries(techs.map((r) => [r.Status, Number(r.n)]));
    const topServices = await (0, db_1.query)(`SELECT TOP 5 s.Name, COUNT(*) AS bookings FROM BookingDetails d
         JOIN Bookings b ON b.Id=d.BookingId JOIN Services s ON s.Id=d.ServiceId
        WHERE ${base} AND b.StartAt >= @ms AND b.StartAt < @me AND b.Status <> 'cancelled'
        GROUP BY s.Name ORDER BY COUNT(*) DESC`, p);
    const daily = await (0, db_1.query)(`SELECT CAST(DATEADD(HOUR, 3, b.StartAt) AS DATE) AS day, COUNT(*) AS bookings
         FROM Bookings b WHERE ${base} AND b.StartAt >= @ms AND b.StartAt < @me AND b.Status <> 'cancelled'
        GROUP BY CAST(DATEADD(HOUR, 3, b.StartAt) AS DATE) ORDER BY day`, p);
    res.json({
        generatedAt: now.toISOString(),
        bookings: counts,
        money,
        technicians: {
            available: t.available ?? 0,
            busy: (t.booked ?? 0) + (t.on_the_way ?? 0) + (t.working ?? 0) + (t.break ?? 0),
            absent: (t.absent ?? 0) + (t.leave ?? 0),
            offDuty: t.off_duty ?? 0,
        },
        topServices,
        dailyBookings: daily,
        notYetAvailable: ['avgRating', 'technicianUtilization', 'operatingProfit', 'supervisorsAvailable'],
    });
}));
