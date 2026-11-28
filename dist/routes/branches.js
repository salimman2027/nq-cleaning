"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchesRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
exports.branchesRouter = (0, express_1.Router)();
/** Branches the signed-in user may work with (all of them, or only their own). */
exports.branchesRouter.get('/', (0, errors_1.h)(async (req, res) => {
    const rows = await (0, db_1.query)(`SELECT Id, Name, City FROM Branches WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR Id=@b) ORDER BY Name`, { c: req.user.companyId, b: (0, middleware_1.branchScope)(req.user) });
    res.json({ items: rows });
}));
