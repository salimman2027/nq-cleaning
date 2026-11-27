import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', r.error.flatten());
  return r.data;
}

export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
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
