"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestOtp = requestOtp;
exports.verifyOtp = verifyOtp;
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
const otp_1 = require("../lib/otp");
const notify_1 = require("./notify");
const secret = () => config_1.config.jwt.accessSecret;
/** Creates and sends a code. Returns the code only in non-production dev mode. */
async function requestOtp(phone, purpose, ip) {
    if (!config_1.config.otp.devMode && !(0, notify_1.deliveryConfigured)()) {
        throw new errors_1.HttpError(503, 'NOTIFY_NOT_CONFIGURED', 'Message delivery is not configured');
    }
    const code = (0, otp_1.generateCode)();
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.applock)(tx, `otp:${purpose}:${phone}`);
        const recent = await (0, db_1.query)(`SELECT TOP 1 DATEDIFF(SECOND, CreatedAt, SYSUTCDATETIME()) AS Secs FROM OtpCodes WHERE Phone=@p AND Purpose=@pu ORDER BY CreatedAt DESC`, { p: phone, pu: purpose }, tx);
        if (recent[0] && recent[0].Secs < config_1.config.otp.cooldownSeconds) {
            throw new errors_1.HttpError(429, 'OTP_COOLDOWN', 'Please wait before requesting another code', { retryAfter: config_1.config.otp.cooldownSeconds - recent[0].Secs });
        }
        const hourly = await (0, db_1.query)(`SELECT COUNT(*) AS N FROM OtpCodes WHERE Phone=@p AND CreatedAt > DATEADD(HOUR,-1,SYSUTCDATETIME())`, { p: phone }, tx);
        if (hourly[0].N >= config_1.config.otp.maxPerHour)
            throw new errors_1.HttpError(429, 'OTP_LIMIT', 'Too many codes requested; try again later');
        await (0, db_1.query)(`INSERT INTO OtpCodes (Phone, Purpose, CodeHash, ExpiresAt, Ip) VALUES (@p,@pu,@h,DATEADD(SECOND,@ttl,SYSUTCDATETIME()),@ip)`, { p: phone, pu: purpose, h: (0, otp_1.hashCode)(secret(), phone, purpose, code), ttl: config_1.config.otp.ttlSeconds, ip: ip?.slice(0, 64) ?? null }, tx);
    });
    await (0, notify_1.send)(phone, 'otp', [code]);
    return config_1.config.otp.devMode ? { devCode: code } : {};
}
/** Verifies and consumes a code. Wrong guesses are persisted (own transaction) so attempts cannot be reset by a rollback. */
async function verifyOtp(phone, purpose, code) {
    const result = await (0, db_1.withTx)(async (tx) => {
        const rows = await (0, db_1.query)(`SELECT TOP 1 Id, CodeHash, Attempts FROM OtpCodes WITH (UPDLOCK, ROWLOCK)
        WHERE Phone=@p AND Purpose=@pu AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME() ORDER BY CreatedAt DESC`, { p: phone, pu: purpose }, tx);
        const row = rows[0];
        if (!row || row.Attempts >= config_1.config.otp.maxAttempts)
            return 'invalid';
        if (!(0, otp_1.safeEqualHex)(row.CodeHash, (0, otp_1.hashCode)(secret(), phone, purpose, code))) {
            await (0, db_1.query)(`UPDATE OtpCodes SET Attempts = Attempts + 1 WHERE Id=@i`, { i: row.Id }, tx);
            return 'invalid';
        }
        await (0, db_1.query)(`UPDATE OtpCodes SET ConsumedAt = SYSUTCDATETIME() WHERE Id=@i`, { i: row.Id }, tx);
        return 'ok';
    });
    if (result !== 'ok')
        throw new errors_1.HttpError(400, 'OTP_INVALID', 'Invalid or expired code');
}
