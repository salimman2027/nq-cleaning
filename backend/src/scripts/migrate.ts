import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { config } from '../config';

/** Applies database/migrations/*.sql in order; batches are split on lines containing only GO. */
export async function migrate(dir = path.resolve(__dirname, '../../../database/migrations')): Promise<string[]> {
  if (!/^[\w.-]+$/.test(config.db.database)) throw new Error('DB_NAME may only contain letters, digits, underscore, dot and hyphen');
  const opts = { encrypt: config.db.encrypt, trustServerCertificate: config.db.trustServerCertificate };
  const base = { server: config.db.server, port: config.db.port, user: config.db.user, password: config.db.password, options: opts };

  // Shared hosts pre-create the database and deny access to master; only try to create it when possible.
  try {
    const master = await new sql.ConnectionPool({ ...base, database: 'master' }).connect();
    await master.request().query(`IF DB_ID('${config.db.database}') IS NULL CREATE DATABASE [${config.db.database}]`);
    await master.close();
  } catch {
    console.warn('Could not create the database automatically (no access to master); assuming it already exists.');
  }

  const pool = await new sql.ConnectionPool({ ...base, database: config.db.database }).connect();
  const applied: string[] = [];
  try {
    await pool.request().query(`IF OBJECT_ID('SchemaMigrations') IS NULL CREATE TABLE SchemaMigrations(Name VARCHAR(200) PRIMARY KEY, AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);
    const done = new Set((await pool.request().query('SELECT Name FROM SchemaMigrations')).recordset.map((r: { Name: string }) => r.Name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      const batches = readFileSync(path.join(dir, file), 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
      for (const b of batches) await pool.request().batch(b);
      await pool.request().input('n', file).query('INSERT INTO SchemaMigrations(Name) VALUES (@n)');
      applied.push(file);
    }
  } finally {
    await pool.close();
  }
  return applied;
}

if (require.main === module) {
  migrate()
    .then((a) => console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database is up to date'))
    .catch((e) => {
      console.error('Migration failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
