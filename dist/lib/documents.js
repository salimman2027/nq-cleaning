"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCompleteAddress = exports.safeFileName = exports.MAX_DOC_BYTES = exports.DOC_KINDS = void 0;
exports.sniffMime = sniffMime;
exports.westernDigits = westernDigits;
exports.sanitizeExtracted = sanitizeExtracted;
exports.mismatches = mismatches;
exports.parseDocumentText = parseDocumentText;
const company_1 = require("./company");
exports.DOC_KINDS = ['cr', 'vat', 'address'];
exports.MAX_DOC_BYTES = 5 * 1024 * 1024;
/** Detect the real file type from its first bytes; the client-declared type is never trusted. */
function sniffMime(b) {
    if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-')
        return 'application/pdf';
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'image/png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
        return 'image/jpeg';
    if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP')
        return 'image/webp';
    return null;
}
const safeFileName = (n) => n.replace(/[\\/\x00-\x1f"]/g, '_').trim().slice(0, 150) || 'document';
exports.safeFileName = safeFileName;
/** Arabic-Indic and Persian digits to ASCII, so "٣١٠..." compares equal to "310...". */
function westernDigits(s) {
    return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}
/** Validate whatever was read (by a model or by text rules) with the same rules as manual entry; anything that fails is dropped. */
function sanitizeExtracted(kind, raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const clean = (v) => (typeof v === 'string' ? westernDigits(v).replace(/[\s-]/g, '') : '');
    const out = {};
    if (kind === 'cr') {
        const v = clean(o.crNumber);
        if (company_1.CR_RE.test(v))
            out.crNumber = v;
    }
    if (kind === 'vat') {
        const v = clean(o.vatNumber);
        if (company_1.VAT_RE.test(v))
            out.vatNumber = v;
    }
    if (kind === 'address') {
        const a = (o.nationalAddress && typeof o.nationalAddress === 'object' ? o.nationalAddress : o);
        const part = {};
        for (const k of ['buildingNo', 'additionalNo']) {
            const v = clean(a[k]);
            if (/^\d{4}$/.test(v))
                part[k] = v;
        }
        const pc = clean(a.postalCode);
        if (/^\d{5}$/.test(pc))
            part.postalCode = pc;
        for (const k of ['street', 'district', 'city']) {
            const v = typeof a[k] === 'string' ? a[k].trim() : '';
            if (v.length >= 2 && v.length <= 120 && !/\d{4,}/.test(v))
                part[k] = v;
        }
        if (Object.keys(part).length)
            out.nationalAddress = part;
    }
    return out;
}
const isCompleteAddress = (a) => company_1.nationalAddressSchema.safeParse(a).success;
exports.isCompleteAddress = isCompleteAddress;
/** Fields where the extracted value disagrees with what the owner typed (only fields present on both sides are compared). */
function mismatches(extracted, entered) {
    const m = [];
    if (!extracted)
        return m;
    if (extracted.crNumber && entered.crNumber && extracted.crNumber !== entered.crNumber)
        m.push('crNumber');
    if (extracted.vatNumber && entered.vatNumber && extracted.vatNumber !== entered.vatNumber)
        m.push('vatNumber');
    const ea = extracted.nationalAddress;
    const na = entered.nationalAddress;
    if (ea && na && Object.keys(ea).some((k) => na[k] !== undefined && ea[k] !== na[k]))
        m.push('nationalAddress');
    return m;
}
const norm = (t) => westernDigits(t).replace(/[​-‏‪-‮⁦-⁩﻿]/g, '');
const near = (text, label, value, span = 25) => {
    const after = text.match(new RegExp(`(?:${label.source})[^\\d\\n]{0,${span}}(${value})`, 'i'));
    if (after)
        return after[1];
    const before = text.match(new RegExp(`(${value})[^\\d\\n]{0,${span}}(?:${label.source})`, 'i'));
    return before?.[1];
};
/**
 * Rule-based reading of text taken from a PDF (no AI). Layouts differ, so this is best effort: it returns only what it
 * finds, every value is re-validated by sanitizeExtracted, and the owner and the reviewer still check the original.
 */
function parseDocumentText(kind, raw) {
    const t = norm(raw);
    if (kind === 'vat')
        return sanitizeExtracted('vat', { vatNumber: t.match(/(?<!\d)3\d{13}3(?!\d)/)?.[0] });
    if (kind === 'cr') {
        const cands = [...t.matchAll(/(?<!\d)[1-7]\d{9}(?!\d)/g)].map((m) => m[0]);
        const kw = near(t, /السجل التجاري|رقم السجل|commercial registration|CR\s*(?:No|Number)?/, '[1-7]\\d{9}(?!\\d)', 40);
        return sanitizeExtracted('cr', { crNumber: kw ?? (new Set(cands).size === 1 ? cands[0] : undefined) });
    }
    return sanitizeExtracted('address', {
        buildingNo: near(t, /رقم المبنى|building\s*(?:no|number)?/, '\\d{4}(?!\\d)'),
        additionalNo: near(t, /الرقم الإضافي|الرقم الاضافي|additional\s*(?:no|number)?/, '\\d{4}(?!\\d)'),
        postalCode: near(t, /الرمز البريدي|الرمز البريدى|postal\s*code|zip/, '\\d{5}(?!\\d)'),
        // Street, district and city are NOT read from PDF text: Arabic words often come out of PDFs letter-reversed, so
        // they are only taken from the AI path (which looks at the page as an image) or typed by the owner.
    });
}
