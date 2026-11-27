import crypto from 'node:crypto';
import { query } from '../db';
import { notifyEvent } from './messaging';

/** Messages the customer when a booking starts or finishes. Finishing also creates the private rating link. Never throws. */
export async function afterStatus(companyId: number, bookingId: number, status: string, baseUrl: string): Promise<void> {
  try {
    if (status !== 'in_progress' && status !== 'done') return;
    const b = (await query<{ Name: string; Mobile: string; Company: string }>(
      `SELECT c.Name, c.Mobile, co.Name AS Company FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId JOIN Companies co ON co.Id=b.CompanyId WHERE b.Id=@b AND b.CompanyId=@c`, { b: bookingId, c: companyId }))[0];
    if (!b) return;
    if (status === 'in_progress') { await notifyEvent('service_started', b.Mobile, { name: b.Name, company: b.Company }, companyId); return; }
    let r = (await query<{ Token: string; SubmittedAt: Date | null }>(`SELECT Token, SubmittedAt FROM Ratings WHERE BookingId=@b`, { b: bookingId }))[0];
    if (!r) {
      const token = crypto.randomBytes(16).toString('hex');
      await query(`INSERT INTO Ratings (BookingId, CompanyId, Token) VALUES (@b,@c,@t)`, { b: bookingId, c: companyId, t: token });
      r = { Token: token, SubmittedAt: null };
    }
    if (!r.SubmittedAt) await notifyEvent('service_finished', b.Mobile, { name: b.Name, company: b.Company, link: `${baseUrl}/rate/${r.Token}` }, companyId);
  } catch { /* a failed notice must never fail the status change */ }
}
