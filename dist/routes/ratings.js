"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
/** The company's own view of what customers said. */
exports.ratingsRouter = (0, express_1.Router)();
exports.ratingsRouter.get('/', (0, middleware_1.requirePerm)('bookings.view'), (0, errors_1.h)(async (req, res) => {
    const c = req.user.companyId;
    const sum = (await (0, db_1.query)(`SELECT AVG(CAST(Stars AS FLOAT)) AS Avg, COUNT(*) AS N FROM Ratings WHERE CompanyId=@c AND Stars IS NOT NULL`, { c }))[0];
    const items = await (0, db_1.query)(`SELECT TOP 200 r.Id, r.Stars, r.Comment, r.SubmittedAt, b.BookingNo, cu.Name AS CustomerName,
            STUFF((SELECT ', ' + s.Name FROM BookingDetails d JOIN Services s ON s.Id=d.ServiceId WHERE d.BookingId=b.Id FOR XML PATH('')), 1, 2, '') AS Services
       FROM Ratings r JOIN Bookings b ON b.Id=r.BookingId JOIN Customers cu ON cu.Id=b.CustomerId
      WHERE r.CompanyId=@c AND r.Stars IS NOT NULL ORDER BY r.SubmittedAt DESC`, { c });
    const dist = await (0, db_1.query)(`SELECT Stars, COUNT(*) AS N FROM Ratings WHERE CompanyId=@c AND Stars IS NOT NULL GROUP BY Stars`, { c });
    res.json({ average: sum.Avg == null ? null : Math.round(sum.Avg * 10) / 10, count: Number(sum.N), distribution: dist.map((d) => ({ stars: d.Stars, count: Number(d.N) })), items });
}));
