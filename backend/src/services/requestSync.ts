import { query, withTx, money, dt } from '../db';
import { normalizeMobile } from '../lib/phone';

const START_HOUR: Record<string, number> = { morning: 9, afternoon: 13, evening: 17 }; // Riyadh local time

/**
 * Turns a confirmed storefront request into a customer and a booking in the company's own system, once.
 * The request stays linked through BookingRequests.BookingId so repeating the call never creates a second booking.
 */
export async function bookFromRequest(companyId: number, requestId: number, userId: number | null): Promise<number | null> {
  return withTx(async (tx) => {
    const r = (await query<Record<string, any>>(
      `SELECT r.Id, r.ServiceId, r.CustomerName, r.Phone, r.Address, r.PreferredDate, r.PreferredPeriod, r.PreferredTime, r.Notes, r.Total, r.BookingId, r.City, r.District, s.DefaultMinutes
         FROM BookingRequests r WITH (UPDLOCK) JOIN Services s ON s.Id=r.ServiceId WHERE r.Id=@i AND r.CompanyId=@c`, { i: requestId, c: companyId }, tx))[0];
    if (!r) return null;
    if (r.BookingId) return Number(r.BookingId);

    const mobile = normalizeMobile(r.Phone);
    let cust = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Customers WHERE CompanyId=@c AND Mobile=@m AND IsDeleted=0 ORDER BY Id`, { c: companyId, m: mobile }, tx))[0];
    if (!cust) {
      cust = (await query<{ Id: number }>(
        `INSERT INTO Customers (CompanyId, Code, Name, Type, Mobile, Source, CreatedBy)
         OUTPUT INSERTED.Id VALUES (@c, 'C-' + RIGHT('000000' + CAST(NEXT VALUE FOR CustomerCodeSeq AS VARCHAR(12)), 6), @n, 'individual', @m, N'المتجر العام', @u)`,
        { c: companyId, n: r.CustomerName, m: mobile, u: userId }, tx))[0];
    }
    const street = (r.Address as string | null) ?? '—';
    let addr = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM CustomerAddresses WHERE CustomerId=@c AND Street=@s AND ISNULL(City,'')=ISNULL(@ci,'') AND ISNULL(District,'')=ISNULL(@di,'') AND IsDeleted=0`, { c: cust.Id, s: street, ci: r.City ?? null, di: r.District ?? null }, tx))[0];
    if (!addr) addr = (await query<{ Id: number }>(`INSERT INTO CustomerAddresses (CustomerId, Label, City, District, Street) OUTPUT INSERTED.Id VALUES (@c, N'من المتجر', @ci, @di, @s)`, { c: cust.Id, s: street, ci: r.City ?? null, di: r.District ?? null }, tx))[0];

    let branch = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Branches WHERE CompanyId=@c AND IsDeleted=0 ORDER BY Id`, { c: companyId }, tx))[0];
    if (!branch) branch = (await query<{ Id: number }>(`INSERT INTO Branches (CompanyId, Name) OUTPUT INSERTED.Id VALUES (@c, N'Main')`, { c: companyId }, tx))[0];

    const day = new Date(r.PreferredDate).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${day}T00:00:00Z`) + ((r.PreferredTime ? Number(String(r.PreferredTime).slice(0, 2)) * 60 + Number(String(r.PreferredTime).slice(3, 5)) : START_HOUR[r.PreferredPeriod] * 60) - 180) * 60_000); // Riyadh = UTC+3
    const end = new Date(start.getTime() + Math.max(60, Number(r.DefaultMinutes) || 120) * 60_000);
    const total = r.Total != null ? Number(r.Total) : 0;
    const b = (await query<{ Id: number }>(
      `INSERT INTO Bookings (CompanyId, BranchId, BookingNo, CustomerId, AddressId, StartAt, EndAt, Status, Subtotal, Discount, Vat, Total, Source, Notes, CreatedBy)
       OUTPUT INSERTED.Id VALUES (@c, @br, 'BK-' + RIGHT('000000' + CAST(NEXT VALUE FOR BookingNoSeq AS VARCHAR(12)), 6), @cu, @ad, @s, @e, 'confirmed', @t, 0, 0, @t, 'storefront', @n, @u)`,
      { c: companyId, br: branch.Id, cu: cust.Id, ad: addr.Id, s: dt(start), e: dt(end), t: money(total), n: r.Notes ?? null, u: userId }, tx))[0];
    const items = await query<{ ServiceId: number; Qty: number; UnitPrice: number }>(`SELECT ServiceId, Qty, UnitPrice FROM BookingRequestItems WHERE RequestId=@i`, { i: requestId }, tx);
    for (const it of items) {
      await query(`INSERT INTO BookingDetails (BookingId, ServiceId, Quantity, UnitPrice, LineTotal) VALUES (@b,@s,@q,@p,@t)`, { b: b.Id, s: it.ServiceId, q: it.Qty, p: money(Number(it.UnitPrice)), t: money(Number(it.UnitPrice) * it.Qty) }, tx);
    }
    await query(`INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, Reason, ChangedBy) VALUES (@b, NULL, 'confirmed', N'تأكيد طلب من المتجر', @u)`, { b: b.Id, u: userId }, tx);
    await query(`UPDATE BookingRequests SET BookingId=@b WHERE Id=@i`, { b: b.Id, i: requestId }, tx);
    return Number(b.Id);
  });
}

/** Heals older confirmed requests that were confirmed before bookings were created automatically. */
export async function backfillConfirmed(companyId: number, userId: number | null): Promise<void> {
  const ids = await query<{ Id: number }>(`SELECT TOP 50 Id FROM BookingRequests WHERE CompanyId=@c AND Status='confirmed' AND BookingId IS NULL ORDER BY Id`, { c: companyId });
  for (const r of ids) await bookFromRequest(companyId, r.Id, userId);
}
