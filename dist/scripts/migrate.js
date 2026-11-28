"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrate = migrate;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const mssql_1 = __importDefault(require("mssql"));
const config_1 = require("../config");
/** Applies database/migrations/*.sql in order; batches are split on lines containing only GO. */
async function migrate(dir = node_path_1.default.resolve(__dirname, '../../../database/migrations')) {
    if (!/^[\w.-]+$/.test(config_1.config.db.database))
        throw new Error('DB_NAME may only contain letters, digits, underscore, dot and hyphen');
    const opts = { encrypt: config_1.config.db.encrypt, trustServerCertificate: config_1.config.db.trustServerCertificate };
    const base = { server: config_1.config.db.server, port: config_1.config.db.port, user: config_1.config.db.user, password: config_1.config.db.password, options: opts };
    // Shared hosts pre-create the database and deny access to master; only try to create it when possible.
    try {
        const master = await new mssql_1.default.ConnectionPool({ ...base, database: 'master' }).connect();
        await master.request().query(`IF DB_ID('${config_1.config.db.database}') IS NULL CREATE DATABASE [${config_1.config.db.database}]`);
        await master.close();
    }
    catch {
        console.warn('Could not create the database automatically (no access to master); assuming it already exists.');
    }
    const pool = await new mssql_1.default.ConnectionPool({ ...base, database: config_1.config.db.database }).connect();
    const applied = [];
    try {
        await pool.request().query(`IF OBJECT_ID('SchemaMigrations') IS NULL CREATE TABLE SchemaMigrations(Name VARCHAR(200) PRIMARY KEY, AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);
        const done = new Set((await pool.request().query('SELECT Name FROM SchemaMigrations')).recordset.map((r) => r.Name));
        for (const file of (0, node_fs_1.readdirSync)(dir).filter((f) => f.endsWith('.sql')).sort()) {
            if (done.has(file))
                continue;
            const batches = (0, node_fs_1.readFileSync)(node_path_1.default.join(dir, file), 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
            for (const b of batches)
                await pool.request().batch(b);
            await pool.request().input('n', file).query('INSERT INTO SchemaMigrations(Name) VALUES (@n)');
            applied.push(file);
        }
    }
    finally {
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
