"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const documents_1 = require("../lib/documents");
exports.mediaRouter = (0, express_1.Router)();
const MAX = 2 * 1024 * 1024;
/** Public: images are shown on public storefronts. Served inert (no sniffing, no script, sandboxed). */
exports.mediaRouter.get('/:id', (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const m = (await (0, db_1.query)(`SELECT MimeType, Data FROM MediaFiles WHERE Id=@i`, { i: id }))[0];
    if (!m)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Image not found');
    res.setHeader('Content-Type', m.MimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(m.Data);
}));
exports.mediaRouter.post('/', middleware_1.authenticate, (0, errors_1.h)(async (req, res) => {
    const u = req.user;
    if (!u.perms.includes('company.profile.manage') && !u.perms.includes('services.manage'))
        throw new errors_1.HttpError(403, 'FORBIDDEN', 'Insufficient permissions');
    const { dataBase64 } = (0, errors_1.parse)(zod_1.z.object({ dataBase64: zod_1.z.string().min(4) }), req.body);
    const data = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length > MAX)
        throw new errors_1.HttpError(413, 'FILE_TOO_LARGE', 'Image must be 2 MB or smaller');
    const mime = (0, documents_1.sniffMime)(data);
    if (!mime || mime === 'application/pdf')
        throw new errors_1.HttpError(415, 'UNSUPPORTED_FILE', 'Only PNG, JPG or WEBP images are accepted');
    const r = await (0, db_1.query)(`INSERT INTO MediaFiles (CompanyId, MimeType, SizeBytes, Data) OUTPUT inserted.Id VALUES (@c,@m,@s,@d)`, { c: u.companyId, m: mime, s: data.length, d: data });
    res.status(201).json({ url: `/api/media/${r[0].Id}` });
}));
