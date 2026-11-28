"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookFromRequest = bookFromRequest;
exports.backfillConfirmed = backfillConfirmed;
const db_1 = require("../db");
const phone_1 = require("../lib/phone");
const START_HOUR = { morning: 9, afternoon: 13, evening: 17 }; // Riyadh local time
/**
 * Turns a confirmed storefront request into a customer and a booking in the company's own system, once.
 * The request stays linked through BookingRequests.BookingId so repeating the call never creates a second booking.
 */
async function bookFromRequest(companyId, requestId, userId) {
    return (0, db_1.withTx)(async (tx) => {
        const r = (await (0, db_1.query)(`SELECT r.Id, r.ServiceId, r.CustomerName, r.Phone, r.Address, r.PreferredDate, r.PreferredPeriod, r.PreferredTime, r.Notes, r.Total, r.BookingId, r.City, r.District, s.DefaultMinutes
         FROM BookingRequests r WITH (UPDLOCK) JOIN Services s ON s.Id=r.ServiceId WHERE r.Id=@i AND r.CompanyId=@c`, { i: requestId, c: companyId }, tx))[0];
        if (!r)
            return null;
        if (r.BookingId)
            return Number(r.BookingId);
        const mobile = (0, phone_1.normalizeMobile)(r.Phone);
        let cust = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Customers WHERE CompanyId=@c AND Mobile=@m AND IsDeleted=0 ORDER BY Id`, { c: companyId, m: mobile }, tx))[0];
        if (!cust) {
            cust = (await (0, db_1.query)(`INSERT INTO Customers (CompanyId, Code, Name, Type, Mobile, Source, CreatedBy)
         OUTPUT INSERTED.Id VALUES (@c, 'C-' + RIGHT('000000' + CAST(NEXT VALUE FOR CustomerCodeSeq AS VARCHAR(12)), 6), @n, 'individual', @m, N'المتجر العام', @u)`, { c: companyId, n: r.CustomerName, m: mobile, u: userId }, tx))[0];
        }
        const street = r.Address ?? '—';
        let addr = (await (0, db_1.query)(`SELECT TOP 1 Id FROM CustomerAddresses WHERE CustomerId=@c AND Street=@s AND ISNULL(City,'')=ISNULL(@ci,'') AND ISNULL(District,'')=ISNULL(@di,'') AND IsDeleted=0`, { c: cust.Id, s: street, ci: r.City ?? null, di: r.District ?? null }, tx))[0];
        if (!addr)
            addr = (await (0, db_1.query)(`INSERT INTO CustomerAddresses (CustomerId, Label, City, District, Street) OUTPUT INSERTED.Id VALUES (@c, N'من المتجر', @ci, @di, @s)`, { c: cust.Id, s: street, ci: r.City ?? null, di: r.District ?? null }, tx))[0];
        let branch = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Branches WHERE CompanyId=@c AND IsDeleted=0 ORDER BY Id`, { c: companyId }, tx))[0];
        if (!branch)
            branch = (await (0, db_1.query)(`INSERT INTO Branches (CompanyId, Name) OUTPUT INSERTED.Id VALUES (@c, N'Main')`, { c: companyId }, tx))[0];
        const day = new Date(r.PreferredDate).toISOString().slice(0, 10);
        const start = new Date(Date.parse(`${day}T00:00:00Z`) + ((r.PreferredTime ? Number(String(r.PreferredTime).slice(0, 2)) * 60 + Number(String(r.PreferredTime).slice(3, 5)) : START_HOUR[r.PreferredPeriod] * 60) - 180) * 60_000); // Riyadh = UTC+3
        const end = new Date(start.getTime() + Math.max(60, Number(r.DefaultMinutes) || 120) * 60_000);
        const total = r.Total != null ? Number(r.Total) : 0;
        const b = (await (0, db_1.query)(`INSERT INTO Bookings (CompanyId, BranchId, BookingNo, CustomerId, AddressId, StartAt, EndAt, Status, Subtotal, Discount, Vat, Total, Source, Notes, CreatedBy)
       OUTPUT INSERTED.Id VALUES (@c, @br, 'BK-' + RIGHT('000000' + CAST(NEXT VALUE FOR BookingNoSeq AS VARCHAR(12)), 6), @cu, @ad, @s, @e, 'confirmed', @t, 0, 0, @t, 'storefront', @n, @u)`, { c: companyId, br: branch.Id, cu: cust.Id, ad: addr.Id, s: (0, db_1.dt)(start), e: (0, db_1.dt)(end), t: (0, db_1.money)(total), n: r.Notes ?? null, u: userId }, tx))[0];
        const items = await (0, db_1.query)(`SELECT ServiceId, Qty, UnitPrice FROM BookingRequestItems WHERE RequestId=@i`, { i: requestId }, tx);
        for (const it of items) {
            await (0, db_1.query)(`INSERT INTO BookingDetails (BookingId, ServiceId, Quantity, UnitPrice, LineTotal) VALUES (@b,@s,@q,@p,@t)`, { b: b.Id, s: it.ServiceId, q: it.Qty, p: (0, db_1.money)(Number(it.UnitPrice)), t: (0, db_1.money)(Number(it.UnitPrice) * it.Qty) }, tx);
        }
        await (0, db_1.query)(`INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, Reason, ChangedBy) VALUES (@b, NULL, 'confirmed', N'تأكيد طلب من المتجر', @u)`, { b: b.Id, u: userId }, tx);
        await (0, db_1.query)(`UPDATE BookingRequests SET BookingId=@b WHERE Id=@i`, { b: b.Id, i: requestId }, tx);
        return Number(b.Id);
    });
}
/** Heals older confirmed requests that were confirmed before bookings were created automatically. */
async function backfillConfirmed(companyId, userId) {
    const ids = await (0, db_1.query)(`SELECT TOP 50 Id FROM BookingRequests WHERE CompanyId=@c AND Status='confirmed' AND BookingId IS NULL ORDER BY Id`, { c: companyId });
    for (const r of ids)
        await bookFromRequest(companyId, r.Id, userId);
}
