"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEANING_STARTER = void 0;
exports.seedServices = seedServices;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
/** Starter cleaning catalogue. Prices are ESTIMATES in SAR to be edited by the company; they are not market data. */
exports.CLEANING_STARTER = [
    { name: 'تنظيف شقة صغيرة (غرفة إلى غرفتين)', method: 'fixed', price: 200, unit: 'visit', minutes: 150, techs: 1, category: 'التنظيف العميق للمنازل' },
    { name: 'تنظيف شقة (3 غرف)', method: 'fixed', price: 300, unit: 'visit', minutes: 210, techs: 2, category: 'التنظيف العميق للمنازل' },
    { name: 'تنظيف فيلا', method: 'fixed', price: 650, unit: 'visit', minutes: 360, techs: 3, category: 'التنظيف العميق للمنازل' },
    { name: 'تنظيف عميق للمنزل', method: 'fixed', price: 450, unit: 'visit', minutes: 300, techs: 2, category: 'التنظيف العميق للمنازل' },
    { name: 'تنظيف بعد البناء', method: 'per_sqm', price: 8, unit: 'sqm', minutes: 480, techs: 3, category: 'التنظيف العميق للمنازل' },
    { name: 'غسيل كنب', method: 'per_item', price: 90, unit: 'item', minutes: 90, techs: 1, category: 'المجالس والمفروشات' },
    { name: 'غسيل سجاد ومفروشات', method: 'per_sqm', price: 12, unit: 'sqm', minutes: 120, techs: 1, category: 'المجالس والمفروشات' },
    { name: 'تنظيف مكيفات', method: 'per_item', price: 70, unit: 'item', minutes: 45, techs: 1, category: 'غسيل وتنظيف المكيفات' },
    { name: 'تنظيف خزانات المياه', method: 'fixed', price: 350, unit: 'visit', minutes: 180, techs: 2, category: 'المطابخ وخزانات المياه' },
    { name: 'تنظيف مطبخ (دهون وأجهزة)', method: 'fixed', price: 220, unit: 'visit', minutes: 150, techs: 1, category: 'المطابخ وخزانات المياه' },
    { name: 'تنظيف مكتب أو محل', method: 'hourly', price: 45, unit: 'hour', minutes: 120, techs: 1, category: 'المكاتب والمحلات' },
    { name: 'تنظيف واجهات زجاجية', method: 'per_sqm', price: 6, unit: 'sqm', minutes: 240, techs: 2, category: 'المكاتب والمحلات' },
];
const CATEGORY_IMAGES = {
    'التنظيف العميق للمنازل': 'cat-01', 'المجالس والمفروشات': 'cat-02', 'غسيل وتنظيف المكيفات': 'cat-03', 'المطابخ وخزانات المياه': 'cat-04', 'المكاتب والمحلات': 'cat-05',
};
const SEED_DIR = node_path_1.default.resolve(__dirname, '..', '..', 'assets', 'seed');
/** Stores one bundled illustration and returns its public URL. Illustrations are original artwork made for this platform. */
async function storeImage(companyId, file, tx) {
    const data = (0, node_fs_1.readFileSync)(node_path_1.default.join(SEED_DIR, `${file}.webp`));
    const r = (await (0, db_1.query)(`INSERT INTO MediaFiles (CompanyId, MimeType, SizeBytes, Data) OUTPUT inserted.Id VALUES (@c,'image/webp',@s,@d)`, { c: companyId, s: data.length, d: data }, tx))[0];
    return `/api/media/${r.Id}`;
}
async function seedServices(companyNameLike) {
    const cos = await (0, db_1.query)(`SELECT Id, Name FROM Companies WHERE IsDeleted=0 AND IsPlatform=0 AND Name LIKE '%' + @n + '%'`, { n: companyNameLike.replace(/[\\%_\[]/g, '') });
    if (cos.length === 0)
        throw new Error(`No company matches "${companyNameLike}"`);
    if (cos.length > 1)
        throw new Error(`More than one company matches: ${cos.map((c) => c.Name).join(' | ')}`);
    const co = cos[0];
    let added = 0;
    let skipped = 0;
    await (0, db_1.withTx)(async (tx) => {
        for (const [i, s] of exports.CLEANING_STARTER.entries()) {
            const ex = await (0, db_1.query)(`SELECT Id, ImageUrl FROM Services WHERE CompanyId=@c AND Name=@n AND IsDeleted=0`, { c: co.Id, n: s.name }, tx);
            if (ex.length) {
                skipped++;
                if (!ex[0].ImageUrl)
                    await (0, db_1.query)(`UPDATE Services SET ImageUrl=@u WHERE Id=@i`, { u: await storeImage(co.Id, `svc-${String(i + 1).padStart(2, '0')}`, tx), i: ex[0].Id }, tx);
                continue;
            }
            const r = (await (0, db_1.query)(`INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes, DefaultTechnicians, Category, ImageUrl) OUTPUT INSERTED.Id VALUES (@c,@n,@m,@d,@t,@cat,@im)`, { c: co.Id, n: s.name, m: s.method, d: s.minutes, t: s.techs, cat: s.category, im: await storeImage(co.Id, `svc-${String(i + 1).padStart(2, '0')}`, tx) }, tx))[0];
            await (0, db_1.query)(`INSERT INTO ServicePrices (ServiceId, Price, Unit, ValidFrom) VALUES (@s,@p,@u,CAST(SYSUTCDATETIME() AS DATE))`, { s: r.Id, p: (0, db_1.money)(s.price), u: s.unit }, tx);
            added++;
        }
        for (const [name, file] of Object.entries(CATEGORY_IMAGES)) {
            const c = await (0, db_1.query)(`SELECT ImageUrl FROM ServiceCategories WHERE CompanyId=@c AND Name=@n`, { c: co.Id, n: name }, tx);
            if (c.length && c[0].ImageUrl)
                continue;
            const url = await storeImage(co.Id, file, tx);
            if (c.length)
                await (0, db_1.query)(`UPDATE ServiceCategories SET ImageUrl=@u WHERE CompanyId=@c AND Name=@n`, { u: url, c: co.Id, n: name }, tx);
            else
                await (0, db_1.query)(`INSERT INTO ServiceCategories (CompanyId, Name, ImageUrl) VALUES (@c,@n,@u)`, { c: co.Id, n: name, u: url }, tx);
        }
    });
    return { company: co.Name, added, skipped };
}
if (require.main === module) {
    const name = process.env.COMPANY_NAME;
    if (!name) {
        console.error('Set COMPANY_NAME.');
        process.exit(1);
    }
    seedServices(name)
        .then((r) => console.log(`Company "${r.company}": added ${r.added} services, skipped ${r.skipped} that already exist.`))
        .catch((e) => { console.error('Failed:', e instanceof Error ? e.message : e); process.exit(1); })
        .finally(() => (0, db_1.closePool)());
}
