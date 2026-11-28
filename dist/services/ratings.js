"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.afterStatus = afterStatus;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const messaging_1 = require("./messaging");
/** Messages the customer when a booking starts or finishes. Finishing also creates the private rating link. Never throws. */
async function afterStatus(companyId, bookingId, status, baseUrl) {
    try {
        if (status !== 'in_progress' && status !== 'done')
            return;
        const b = (await (0, db_1.query)(`SELECT c.Name, c.Mobile, co.Name AS Company FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId JOIN Companies co ON co.Id=b.CompanyId WHERE b.Id=@b AND b.CompanyId=@c`, { b: bookingId, c: companyId }))[0];
        if (!b)
            return;
        if (status === 'in_progress') {
            await (0, messaging_1.notifyEvent)('service_started', b.Mobile, { name: b.Name, company: b.Company }, companyId);
            return;
        }
        let r = (await (0, db_1.query)(`SELECT Token, SubmittedAt FROM Ratings WHERE BookingId=@b`, { b: bookingId }))[0];
        if (!r) {
            const token = node_crypto_1.default.randomBytes(16).toString('hex');
            await (0, db_1.query)(`INSERT INTO Ratings (BookingId, CompanyId, Token) VALUES (@b,@c,@t)`, { b: bookingId, c: companyId, t: token });
            r = { Token: token, SubmittedAt: null };
        }
        if (!r.SubmittedAt)
            await (0, messaging_1.notifyEvent)('service_finished', b.Mobile, { name: b.Name, company: b.Company, link: `${baseUrl}/rate/${r.Token}` }, companyId);
    }
    catch { /* a failed notice must never fail the status change */ }
}
