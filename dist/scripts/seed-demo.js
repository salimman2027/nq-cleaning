"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeDemo = purgeDemo;
exports.seedDemo = seedDemo;
const node_crypto_1 = require("node:crypto");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mssql_1 = __importDefault(require("mssql"));
const db_1 = require("../db");
const pricing_1 = require("../lib/pricing");
const tenancy_1 = require("../services/tenancy");
/**
 * DEMO DATA ONLY. Every demo company has a slug starting with "demo-" and every demo user an e-mail ending
 * in @demo.nq.test, so `--purge` removes exactly what this script created. Passwords are generated randomly
 * on each run and printed once to the console; nothing secret is stored in the repository.
 *
 *   npm run seed:demo -w backend            create demo data
 *   npm run seed:demo -w backend -- --purge remove demo data
 */
const COMPANIES = [
    { n: 'لمسة نظافة', en: 'Clean Touch', sector: 'cleaning', status: 'approved', svc: [['تنظيف شقة', 'fixed', 180, 180], ['تنظيف فيلا', 'fixed', 420, 300], ['تنظيف مكيفات', 'per_item', 60, 60]] },
    { n: 'بريق الرياض', en: 'Riyadh Shine', sector: 'cleaning', status: 'approved', svc: [['تنظيف عميق', 'fixed', 350, 240], ['غسيل كنب', 'per_item', 90, 90]] },
    { n: 'سباك الحي', en: 'Neighborhood Plumber', sector: 'plumbing', status: 'approved', svc: [['كشف تسرب', 'fixed', 120, 60], ['تركيب سخان', 'fixed', 200, 90], ['تسليك مجاري', 'fixed', 150, 60]] },
    { n: 'نور للكهرباء', en: 'Noor Electric', sector: 'electrical', status: 'approved', svc: [['فحص كهرباء', 'fixed', 100, 60], ['تركيب إنارة', 'per_item', 45, 30]] },
    { n: 'برودة للتكييف', en: 'Coolness AC', sector: 'ac', status: 'approved', svc: [['صيانة مكيف', 'per_item', 80, 60], ['تركيب مكيف سبليت', 'per_item', 350, 120]] },
    { n: 'شركة قيد المراجعة ١', en: 'Pending One', sector: 'cleaning', status: 'pending_review', svc: [] },
    { n: 'شركة قيد المراجعة ٢', en: 'Pending Two', sector: 'plumbing', status: 'pending_review', svc: [] },
    { n: 'شركة مرفوضة', en: 'Rejected Co', sector: 'electrical', status: 'rejected', svc: [] },
];
const FIRST = ['محمد', 'أحمد', 'خالد', 'سعد', 'فهد', 'نورة', 'سارة', 'ريم', 'عبدالله', 'ماجد', 'هند', 'لينا'];
const LAST = ['العتيبي', 'القحطاني', 'الدوسري', 'الشمري', 'الغامدي', 'الحربي', 'الزهراني', 'المطيري'];
const DISTRICTS = ['العليا', 'الملقا', 'النرجس', 'الياسمين', 'حطين', 'الربوة'];
/** Small deterministic PRNG so demo data looks the same on every run. */
function prng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}
async function purgeDemo() {
    await (0, db_1.withTx)(async (tx) => {
        const ids = (await (0, db_1.query)(`SELECT Id FROM Companies WHERE Slug LIKE 'demo-%'`, {}, tx)).map((r) => Number(r.Id));
        for (const id of ids) {
            const p = { c: id };
            const steps = [
                `DELETE FROM BookingStatusHistory WHERE BookingId IN (SELECT Id FROM Bookings WHERE CompanyId=@c)`,
                `DELETE FROM BookingAssignments WHERE BookingId IN (SELECT Id FROM Bookings WHERE CompanyId=@c)`,
                `DELETE FROM BookingDetails WHERE BookingId IN (SELECT Id FROM Bookings WHERE CompanyId=@c)`,
                `DELETE FROM Bookings WHERE CompanyId=@c`,
                `DELETE FROM CustomerAddresses WHERE CustomerId IN (SELECT Id FROM Customers WHERE CompanyId=@c)`,
                `DELETE FROM Customers WHERE CompanyId=@c`,
                `DELETE FROM TeamMembers WHERE TeamId IN (SELECT Id FROM Teams WHERE CompanyId=@c)`,
                `DELETE FROM Teams WHERE CompanyId=@c`,
                `DELETE FROM Vehicles WHERE CompanyId=@c`,
                `DELETE FROM TechnicianLeaves WHERE TechnicianId IN (SELECT Id FROM Technicians WHERE CompanyId=@c)`,
                `DELETE FROM Technicians WHERE CompanyId=@c`,
                `DELETE FROM Supervisors WHERE CompanyId=@c`,
                `DELETE FROM ServicePrices WHERE ServiceId IN (SELECT Id FROM Services WHERE CompanyId=@c)`,
                `DELETE FROM Services WHERE CompanyId=@c`,
                `DELETE FROM RefreshTokens WHERE UserId IN (SELECT Id FROM Users WHERE CompanyId=@c)`,
                `DELETE FROM UserRoles WHERE UserId IN (SELECT Id FROM Users WHERE CompanyId=@c)`,
                `DELETE FROM Users WHERE CompanyId=@c`,
                `DELETE FROM RolePermissions WHERE RoleId IN (SELECT Id FROM Roles WHERE CompanyId=@c)`,
                `DELETE FROM Roles WHERE CompanyId=@c`,
                `DELETE FROM CompanySectors WHERE CompanyId=@c`,
                `DELETE FROM SystemSettings WHERE CompanyId=@c`,
                `DELETE FROM NotificationLogs WHERE CompanyId=@c`,
                `DELETE FROM AuditLogs WHERE CompanyId=@c`,
                `DELETE FROM Branches WHERE CompanyId=@c`,
                `DELETE FROM Companies WHERE Id=@c`,
            ];
            for (const s of steps)
                await (0, db_1.query)(s, p, tx);
        }
    });
}
async function seedDemo() {
    const existing = await (0, db_1.query)(`SELECT TOP 1 Id FROM Companies WHERE Slug LIKE 'demo-%'`);
    if (existing.length)
        throw new Error('Demo data already exists. Run with --purge first.');
    const rnd = prng(20260101);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const owners = [];
    let phoneN = 0;
    const nextPhone = () => `0500${String(++phoneN).padStart(6, '0')}`; // 0500xxxxxx: reserved demo range
    const approved = [];
    await (0, db_1.withTx)(async (tx) => {
        const sectorId = async (code) => Number((await (0, db_1.query)(`SELECT Id FROM Sectors WHERE Code=@c`, { c: code }, tx))[0].Id);
        let idx = 0;
        for (const c of COMPANIES) {
            idx++;
            const password = (0, node_crypto_1.randomBytes)(12).toString('base64url');
            const co = (await (0, db_1.query)(`INSERT INTO Companies (Name, Slug, Phone, Status, Description, CrNumber, VatNumber, NationalAddress, SubmittedAt, ReviewedAt, ReviewNote)
         OUTPUT INSERTED.Id VALUES (@n,@s,@p,@st,@d,@cr,@vat,@addr,
           CASE WHEN @st IN ('pending_review','approved','rejected') THEN SYSUTCDATETIME() END,
           CASE WHEN @st IN ('approved','rejected') THEN SYSUTCDATETIME() END,
           CASE WHEN @st='rejected' THEN N'السجل التجاري غير واضح (بيانات تجريبية)' END)`, {
                n: c.n, s: `demo-${c.en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, p: nextPhone(), st: c.status,
                d: `شركة تجريبية في قطاع ${c.sector} — بيانات للعرض فقط`,
                cr: String(1010000000 + idx), vat: `3${String(10000000000 + idx).padStart(13, '0')}3`,
                addr: JSON.stringify({ buildingNo: '1234', street: 'طريق الملك فهد', district: pick(DISTRICTS), city: 'الرياض', postalCode: '12211', additionalNo: '5678' }),
            }, tx))[0];
            const companyId = Number(co.Id);
            await (0, db_1.query)(`INSERT INTO CompanySectors (CompanyId, SectorId) VALUES (@c,@s)`, { c: companyId, s: await sectorId(c.sector) }, tx);
            const br = (await (0, db_1.query)(`INSERT INTO Branches (CompanyId, Name, City) OUTPUT INSERTED.Id VALUES (@c, N'الفرع الرئيسي', N'الرياض')`, { c: companyId }, tx))[0];
            await (0, tenancy_1.ensureRoles)(tx, companyId);
            const email = `owner${idx}@demo.nq.test`;
            const u = (await (0, db_1.query)(`INSERT INTO Users (CompanyId, FullName, Email, PasswordHash, Phone) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@h,@p)`, { c: companyId, n: `${pick(FIRST)} ${pick(LAST)}`, e: email, h: await bcryptjs_1.default.hash(password, 10), p: nextPhone() }, tx))[0];
            await (0, db_1.query)(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='Company Owner'`, { u: u.Id, c: companyId }, tx);
            owners.push({ email, password, company: c.n, status: c.status });
            if (c.status !== 'approved')
                continue;
            const services = [];
            for (const [name, method, price, minutes] of c.svc) {
                const s = (await (0, db_1.query)(`INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes) OUTPUT INSERTED.Id VALUES (@c,@n,@m,@d)`, { c: companyId, n: name, m: method, d: minutes }, tx))[0];
                await (0, db_1.query)(`INSERT INTO ServicePrices (ServiceId, Price, Unit, ValidFrom) VALUES (@s,@p,'unit','2026-01-01')`, { s: s.Id, p: (0, db_1.money)(price) }, tx);
                services.push({ id: Number(s.Id), price, minutes });
            }
            const techs = [];
            for (let t = 0; t < 4; t++) {
                const r = (await (0, db_1.query)(`INSERT INTO Technicians (CompanyId, BranchId, Code, FullName, Mobile, HourlyCost)
           OUTPUT INSERTED.Id VALUES (@c,@b,'T-' + RIGHT('000000' + CAST(NEXT VALUE FOR TechnicianCodeSeq AS VARCHAR(12)), 6),@n,@m,25)`, { c: companyId, b: br.Id, n: `${pick(FIRST)} ${pick(LAST)}`, m: nextPhone() }, tx))[0];
                techs.push(Number(r.Id));
            }
            const customers = [];
            for (let k = 0; k < 12; k++) {
                const cu = (await (0, db_1.query)(`INSERT INTO Customers (CompanyId, Code, Name, Type, Mobile, Source)
           OUTPUT INSERTED.Id VALUES (@c,'C-' + RIGHT('000000' + CAST(NEXT VALUE FOR CustomerCodeSeq AS VARCHAR(12)), 6),@n,'individual',@m,'demo')`, { c: companyId, n: `${pick(FIRST)} ${pick(LAST)}`, m: nextPhone() }, tx))[0];
                const ad = (await (0, db_1.query)(`INSERT INTO CustomerAddresses (CustomerId, Label, City, District) OUTPUT INSERTED.Id VALUES (@u, N'المنزل', N'الرياض', @d)`, { u: cu.Id, d: pick(DISTRICTS) }, tx))[0];
                customers.push({ id: Number(cu.Id), addr: Number(ad.Id) });
            }
            approved.push({ id: companyId, branchId: Number(br.Id), techs, customers, services });
        }
        // 150 bookings across approved companies. Each technician gets distinct, non-overlapping 3-hour slots
        // (07/13/19 h; longest service is 5 h) on consecutive days, so the overlap trigger can never fire.
        const statuses = ['new', 'confirmed', 'assigned', 'completed', 'completed', 'cancelled'];
        const perCompany = Math.floor(150 / approved.length);
        const base = Date.UTC(2026, 0, 5);
        for (const [ci, co] of approved.entries()) {
            const count = ci === approved.length - 1 ? 150 - perCompany * (approved.length - 1) : perCompany;
            for (let b = 0; b < count; b++) {
                const cu = pick(co.customers);
                const svc = pick(co.services);
                const tech = co.techs[b % co.techs.length];
                const slotIdx = Math.floor(b / co.techs.length); // per-technician sequence
                const start = new Date(base + (Math.floor(slotIdx / 3) * 86400 + [7, 13, 19][slotIdx % 3] * 3600) * 1000);
                const end = new Date(start.getTime() + svc.minutes * 60000);
                const status = pick(statuses);
                const totals = (0, pricing_1.calcTotals)([{ quantity: 1, unitPrice: svc.price }], 0, 15);
                const bk = (await (0, db_1.query)(`INSERT INTO Bookings (CompanyId, BranchId, BookingNo, CustomerId, AddressId, StartAt, EndAt, Status, Subtotal, Discount, Vat, Total, Source)
           OUTPUT INSERTED.Id VALUES (@c,@br,'BK-' + RIGHT('000000' + CAST(NEXT VALUE FOR BookingNoSeq AS VARCHAR(12)), 6),@cu,@ad,@s,@e,@st,@sub,0,@vat,@tot,'demo')`, { c: co.id, br: co.branchId, cu: cu.id, ad: cu.addr, s: (0, db_1.dt)(start), e: (0, db_1.dt)(end), st: status, sub: (0, db_1.money)(totals.subtotal), vat: (0, db_1.money)(totals.vat), tot: (0, db_1.money)(totals.total) }, tx))[0];
                await (0, db_1.query)(`INSERT INTO BookingDetails (BookingId, ServiceId, Quantity, UnitPrice, LineTotal) VALUES (@b,@s,@q,@p,@t)`, { b: bk.Id, s: svc.id, q: [mssql_1.default.Decimal(10, 2), 1], p: (0, db_1.money)(svc.price), t: (0, db_1.money)(svc.price) }, tx);
                if (status !== 'new' && status !== 'cancelled' && status !== 'confirmed') {
                    await (0, db_1.query)(`INSERT INTO BookingAssignments (BookingId, TechnicianId, StartAt, EndAt) VALUES (@b,@t,@s,@e)`, { b: bk.Id, t: tech, s: (0, db_1.dt)(start), e: (0, db_1.dt)(end) }, tx);
                }
                await (0, db_1.query)(`INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, ChangedBy, Reason) VALUES (@b,NULL,@s,1,N'بيانات تجريبية')`, { b: bk.Id, s: status }, tx);
            }
        }
    });
    return { owners };
}
if (require.main === module) {
    (async () => {
        if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_IN_PRODUCTION !== '1')
            throw new Error('Refusing to seed demo data when NODE_ENV=production');
        if (process.argv.includes('--purge')) {
            await purgeDemo();
            console.log('Demo data removed.');
            return;
        }
        const r = await seedDemo();
        console.log('Demo data created: 8 companies (5 approved, 2 pending, 1 rejected), 60 customers, 150 bookings.');
        console.log('Random owner passwords (shown once, not stored anywhere):');
        for (const o of r.owners)
            console.log(`  ${o.status.padEnd(15)} ${o.email}  ${o.password}  (${o.company})`);
    })()
        .catch((e) => {
        console.error('Seed failed:', e instanceof Error ? e.message : e);
        process.exit(1);
    })
        .finally(() => (0, db_1.closePool)());
}
