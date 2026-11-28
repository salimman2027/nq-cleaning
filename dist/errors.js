"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.h = exports.HttpError = void 0;
exports.parse = parse;
const zod_1 = require("zod");
class HttpError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.HttpError = HttpError;
function parse(schema, data) {
    const r = schema.safeParse(data);
    if (!r.success)
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', r.error.flatten());
    return r.data;
}
const h = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
};
exports.h = h;
const errorHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
        return;
    }
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten() } });
        return;
    }
    const msg = String(err?.message ?? '');
    const num = err?.number ?? err?.originalError?.info?.number;
    if (msg.includes('TECHNICIAN_OVERLAP')) {
        res.status(409).json({ error: { code: 'TECHNICIAN_CONFLICT', message: 'Technician already booked in this time range' } });
        return;
    }
    if (num === 2627 || num === 2601) {
        res.status(409).json({ error: { code: 'DUPLICATE', message: 'Duplicate record' } });
        return;
    }
    if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
        return;
    }
    if (err?.type === 'entity.too.large') {
        res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Request body is too large' } });
        return;
    }
    // Log without request bodies or credentials.
    console.error('[unhandled]', err?.name, msg);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
exports.errorHandler = errorHandler;
