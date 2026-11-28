"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dt = exports.money = void 0;
exports.getPool = getPool;
exports.closePool = closePool;
exports.query = query;
exports.withTx = withTx;
exports.applock = applock;
const mssql_1 = __importDefault(require("mssql"));
const config_1 = require("./config");
let pool;
async function getPool() {
    if (!pool) {
        const p = new mssql_1.default.ConnectionPool({
            server: config_1.config.db.server,
            port: config_1.config.db.port,
            database: config_1.config.db.database,
            user: config_1.config.db.user,
            password: config_1.config.db.password,
            options: { encrypt: config_1.config.db.encrypt, trustServerCertificate: config_1.config.db.trustServerCertificate },
            pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
        });
        pool = await p.connect();
    }
    return pool;
}
async function closePool() {
    if (pool) {
        await pool.close();
        pool = undefined;
    }
}
const money = (v) => [mssql_1.default.Decimal(18, 2), v];
exports.money = money;
const dt = (d) => [mssql_1.default.DateTime2, d];
exports.dt = dt;
function bind(r, params) {
    for (const [k, v] of Object.entries(params)) {
        // sql.Decimal(18,2) is an object, sql.DateTime2 is a factory function: accept both as an explicit type.
        if (Array.isArray(v) && v.length === 2 && v[0] && (typeof v[0] === 'function' || typeof v[0] === 'object')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            r.input(k, v[0], v[1]);
        }
        else {
            r.input(k, v);
        }
    }
}
async function query(text, params = {}, tx) {
    const r = tx ? new mssql_1.default.Request(tx) : (await getPool()).request();
    bind(r, params);
    const res = await r.query(text);
    return res.recordset;
}
async function withTx(fn) {
    const tx = new mssql_1.default.Transaction(await getPool());
    await tx.begin(mssql_1.default.ISOLATION_LEVEL.READ_COMMITTED);
    try {
        const out = await fn(tx);
        await tx.commit();
        return out;
    }
    catch (e) {
        try {
            await tx.rollback();
        }
        catch {
            /* already rolled back (e.g. by a trigger) */
        }
        throw e;
    }
}
/** Transaction-scoped exclusive application lock; released automatically on commit/rollback. */
async function applock(tx, resource) {
    const rows = await query(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource=@res, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; SELECT @r AS r;`, { res: resource }, tx);
    if (!rows[0] || rows[0].r < 0) {
        const { HttpError } = await Promise.resolve().then(() => __importStar(require('./errors')));
        throw new HttpError(503, 'LOCK_TIMEOUT', 'System is busy, please retry');
    }
}
