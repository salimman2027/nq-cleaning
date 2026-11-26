import sql from 'mssql';
import { config } from './config';

let pool: sql.ConnectionPool | undefined;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    const p = new sql.ConnectionPool({
      server: config.db.server,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      options: { encrypt: config.db.encrypt, trustServerCertificate: config.db.trustServerCertificate },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    });
    pool = await p.connect();
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = undefined;
  }
}

/** A param is either a plain value (type inferred) or [sqlType, value] for explicit typing. */
export type Param = unknown;
export type Params = Record<string, Param>;

export const money = (v: number): Param => [sql.Decimal(18, 2), v];
export const dt = (d: Date | null): Param => [sql.DateTime2, d];

function bind(r: sql.Request, params: Params): void {
  for (const [k, v] of Object.entries(params)) {
    // sql.Decimal(18,2) is an object, sql.DateTime2 is a factory function: accept both as an explicit type.
    if (Array.isArray(v) && v.length === 2 && v[0] && (typeof v[0] === 'function' || typeof v[0] === 'object')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.input(k, v[0] as any, v[1]);
    } else {
      r.input(k, v as never);
    }
  }
}

export async function query<T = Record<string, any>>(
  text: string,
  params: Params = {},
  tx?: sql.Transaction,
): Promise<T[]> {
  const r = tx ? new sql.Request(tx) : (await getPool()).request();
  bind(r, params);
  const res = await r.query(text);
  return res.recordset as unknown as T[];
}

export async function withTx<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(await getPool());
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (e) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back (e.g. by a trigger) */
    }
    throw e;
  }
}

/** Transaction-scoped exclusive application lock; released automatically on commit/rollback. */
export async function applock(tx: sql.Transaction, resource: string): Promise<void> {
  const rows = await query<{ r: number }>(
    `DECLARE @r INT; EXEC @r = sp_getapplock @Resource=@res, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; SELECT @r AS r;`,
    { res: resource },
    tx,
  );
  if (!rows[0] || rows[0].r < 0) {
    const { HttpError } = await import('./errors');
    throw new HttpError(503, 'LOCK_TIMEOUT', 'System is busy, please retry');
  }
}
