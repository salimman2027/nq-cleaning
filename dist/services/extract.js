"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractionEnabled = void 0;
exports.pdfText = pdfText;
exports.extractFromFile = extractFromFile;
const config_1 = require("../config");
const documents_1 = require("../lib/documents");
const PROMPTS = {
    cr: 'This is a Saudi commercial registration (السجل التجاري). Return JSON {"crNumber": "<10-digit registration number>"} only.',
    vat: 'This is a Saudi VAT registration certificate. Return JSON {"vatNumber": "<15-digit VAT number>"} only.',
    address: 'This is a Saudi National Address document. Return JSON {"nationalAddress": {"buildingNo":"4 digits","street":"","district":"","city":"","postalCode":"5 digits","additionalNo":"4 digits"}} only.',
};
const extractionEnabled = () => true; // PDFs with a text layer are read without any key; images and scans need ANTHROPIC_API_KEY
exports.extractionEnabled = extractionEnabled;
const enough = (kind, v) => kind === 'cr' ? Boolean(v.crNumber) : kind === 'vat' ? Boolean(v.vatNumber) : Boolean(v.nationalAddress?.buildingNo && v.nationalAddress.postalCode && v.nationalAddress.additionalNo);
/** Text of a PDF that has a text layer (empty for scans). Never throws. */
async function pdfText(data) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const parse = require('pdf-parse/lib/pdf-parse.js');
        return (await parse(data)).text ?? '';
    }
    catch {
        return '';
    }
}
/**
 * Reads values from the file with the Anthropic API when ANTHROPIC_API_KEY is set. Best effort: the result is a
 * suggestion that the owner confirms and the platform reviewer checks against the original file.
 */
async function extractFromFile(kind, mime, data, doFetch = fetch) {
    let found = {};
    if (mime === 'application/pdf') {
        found = (0, documents_1.parseDocumentText)(kind, await pdfText(data));
        if (enough(kind, found))
            return { status: 'ok', values: found };
    }
    if (!config_1.config.extract.apiKey)
        return { status: Object.keys(found).length ? 'ok' : 'skipped', values: found };
    try {
        const block = mime === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: mime, data: data.toString('base64') } }
            : { type: 'image', source: { type: 'base64', media_type: mime, data: data.toString('base64') } };
        const res = await doFetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': config_1.config.extract.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: config_1.config.extract.model, max_tokens: 400, messages: [{ role: 'user', content: [block, { type: 'text', text: `${PROMPTS[kind]} Use Western digits. If a value is not visible, omit it. No prose.` }] }] }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok)
            return { status: 'failed', values: found };
        const body = (await res.json());
        const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
        const json = text.match(/\{[\s\S]*\}/)?.[0];
        const ai = (0, documents_1.sanitizeExtracted)(kind, json ? JSON.parse(json) : {});
        const values = { ...found, ...ai, ...(kind === 'address' ? { nationalAddress: { ...found.nationalAddress, ...ai.nationalAddress } } : {}) };
        return { status: Object.keys(values).length ? 'ok' : 'empty', values };
    }
    catch {
        return { status: 'failed', values: found };
    }
}
