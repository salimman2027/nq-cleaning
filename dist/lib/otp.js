"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toInternational = exports.isSaudiMobile = void 0;
exports.generateCode = generateCode;
exports.hashCode = hashCode;
exports.safeEqualHex = safeEqualHex;
const node_crypto_1 = require("node:crypto");
/** 6-digit numeric code from a CSPRNG. */
function generateCode() {
    return String((0, node_crypto_1.randomInt)(0, 1_000_000)).padStart(6, '0');
}
/** Keyed hash bound to phone + purpose, so a stolen table cannot be brute-forced offline without the secret. */
function hashCode(secret, phone, purpose, code) {
    return (0, node_crypto_1.createHmac)('sha256', secret).update(`${purpose}|${phone}|${code}`).digest('hex');
}
function safeEqualHex(a, b) {
    const x = Buffer.from(a, 'hex');
    const y = Buffer.from(b, 'hex');
    return x.length === y.length && x.length > 0 && (0, node_crypto_1.timingSafeEqual)(x, y);
}
/** Saudi mobile in local form 05XXXXXXXX (after normalizeMobile). */
const isSaudiMobile = (p) => /^05\d{8}$/.test(p);
exports.isSaudiMobile = isSaudiMobile;
/** E.164 digits without '+', for WhatsApp Cloud API. */
const toInternational = (local) => (local.startsWith('0') ? '966' + local.slice(1) : local);
exports.toInternational = toInternational;
