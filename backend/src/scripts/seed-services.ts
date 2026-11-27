import { closePool, money, query, withTx } from '../db';

/** Starter cleaning catalogue. Prices are ESTIMATES in SAR to be edited by the company; they are not market data. */
export const CLEANING_STARTER: { name: string; method: string; price: number; unit: string; minutes: number; techs: number }[] = [
  { name: 'تنظيف شقة صغيرة (غرفة إلى غرفتين)', method: 'fixed', price: 200, unit: 'visit', minutes: 150, techs: 1 },
  { name: 'تنظيف شقة (3 غرف)', method: 'fixed', price: 300, unit: 'visit', minutes: 210, techs: 2 },
  { name: 'تنظيف فيلا', method: 'fixed', price: 650, unit: 'visit', minutes: 360, techs: 3 },
  { name: 'تنظيف عميق للمنزل', method: 'fixed', price: 450, unit: 'visit', minutes: 300, techs: 2 },
  { name: 'تنظيف بعد البناء', method: 'per_sqm', price: 8, unit: 'sqm', minutes: 480, techs: 3 },
  { name: 'غسيل كنب', method: 'per_item', price: 90, unit: 'item', minutes: 90, techs: 1 },
  { name: 'غسيل سجاد ومفروشات', method: 'per_sqm', price: 12, unit: 'sqm', minutes: 120, techs: 1 },
  { name: 'تنظيف مكيفات', method: 'per_item', price: 70, unit: 'item', minutes: 45, techs: 1 },
  { name: 'تنظيف خزانات المياه', method: 'fixed', price: 350, unit: 'visit', minutes: 180, techs: 2 },
  { name: 'تنظيف مطبخ (دهون وأجهزة)', method: 'fixed', price: 220, unit: 'visit', minutes: 150, techs: 1 },
  { name: 'تنظيف مكتب أو محل', method: 'hourly', price: 45, unit: 'hour', minutes: 120, techs: 1 },
  { name: 'تنظيف واجهات زجاجية', method: 'per_sqm', price: 6, unit: 'sqm', minutes: 240, techs: 2 },
];

export async function seedServices(companyNameLike: string): Promise<{ company: string; added: number; skipped: number }> {
  const cos = await query<{ Id: number; Name: string }>(
    `SELECT Id, Name FROM Companies WHERE IsDeleted=0 AND IsPlatform=0 AND Name LIKE '%' + @n + '%'`,
    { n: companyNameLike.replace(/[\\%_\[]/g, '') },
  );
  if (cos.length === 0) throw new Error(`No company matches "${companyNameLike}"`);
  if (cos.length > 1) throw new Error(`More than one company matches: ${cos.map((c) => c.Name).join(' | ')}`);
  const co = cos[0];
  let added = 0;
  let skipped = 0;
  await withTx(async (tx) => {
    for (const s of CLEANING_STARTER) {
      const ex = await query(`SELECT 1 AS x FROM Services WHERE CompanyId=@c AND Name=@n AND IsDeleted=0`, { c: co.Id, n: s.name }, tx);
      if (ex.length) { skipped++; continue; }
      const r = (await query<{ Id: number }>(
        `INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes, DefaultTechnicians) OUTPUT INSERTED.Id VALUES (@c,@n,@m,@d,@t)`,
        { c: co.Id, n: s.name, m: s.method, d: s.minutes, t: s.techs }, tx,
      ))[0];
      await query(`INSERT INTO ServicePrices (ServiceId, Price, Unit, ValidFrom) VALUES (@s,@p,@u,CAST(SYSUTCDATETIME() AS DATE))`, { s: r.Id, p: money(s.price), u: s.unit }, tx);
      added++;
    }
  });
  return { company: co.Name, added, skipped };
}

if (require.main === module) {
  const name = process.env.COMPANY_NAME;
  if (!name) { console.error('Set COMPANY_NAME.'); process.exit(1); }
  seedServices(name)
    .then((r) => console.log(`Company "${r.company}": added ${r.added} services, skipped ${r.skipped} that already exist.`))
    .catch((e) => { console.error('Failed:', e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => closePool());
}
