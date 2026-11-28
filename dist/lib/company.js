"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageRef = exports.newSlug = exports.nationalAddressSchema = exports.SLUG_RE = exports.VAT_RE = exports.CR_RE = void 0;
exports.missingForReview = missingForReview;
const zod_1 = require("zod");
exports.CR_RE = /^\d{10}$/;
exports.VAT_RE = /^3\d{13}3$/; // Saudi VAT registration: 15 digits, starts and ends with 3
exports.SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
exports.nationalAddressSchema = zod_1.z.object({
    buildingNo: zod_1.z.string().regex(/^\d{4}$/),
    street: zod_1.z.string().min(2).max(120),
    district: zod_1.z.string().min(2).max(120),
    city: zod_1.z.string().min(2).max(80),
    postalCode: zod_1.z.string().regex(/^\d{5}$/),
    additionalNo: zod_1.z.string().regex(/^\d{4}$/),
});
/** Names of the fields still missing before a company may be sent for review. */
function missingForReview(p) {
    const m = [];
    if (!p.name || p.name.trim().length < 2)
        m.push('name');
    if (!p.crNumber || !exports.CR_RE.test(p.crNumber))
        m.push('crNumber');
    if (!p.vatNumber || !exports.VAT_RE.test(p.vatNumber))
        m.push('vatNumber');
    if (!exports.nationalAddressSchema.safeParse(p.nationalAddress).success)
        m.push('nationalAddress');
    if (p.sectorCount < 1)
        m.push('sectors');
    return m;
}
const newSlug = (rand) => `co-${rand}`;
exports.newSlug = newSlug;
/** An image reference: a file uploaded to this platform (/api/media/N) or an https URL. */
exports.imageRef = zod_1.z.string().max(500).refine((u) => /^\/api\/media\/\d+$/.test(u) || (u.startsWith('https://') && zod_1.z.string().url().safeParse(u).success), 'Image must be an upload or an https URL').nullable().optional();
