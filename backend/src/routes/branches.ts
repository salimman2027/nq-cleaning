import { Router } from 'express';
import { query } from '../db';
import { h } from '../errors';
import { branchScope } from '../auth/middleware';

export const branchesRouter = Router();

/** Branches the signed-in user may work with (all of them, or only their own). */
branchesRouter.get(
  '/',
  h(async (req, res) => {
    const rows = await query(
      `SELECT Id, Name, City FROM Branches WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR Id=@b) ORDER BY Name`,
      { c: req.user!.companyId, b: branchScope(req.user!) },
    );
    res.json({ items: rows });
  }),
);
