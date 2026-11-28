"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMobile = normalizeMobile;
exports.escapeLike = escapeLike;
/** Normalizes Saudi-style mobile numbers to local 05XXXXXXXX form; other numbers are returned digits-only. */
function normalizeMobile(input) {
    let d = input.replace(/[^\d]/g, '');
    if (d.startsWith('00'))
        d = d.slice(2);
    if (d.startsWith('966') && d.length === 12)
        d = '0' + d.slice(3);
    if (d.length === 9 && d.startsWith('5'))
        d = '0' + d;
    return d;
}
function escapeLike(s) {
    return s.replace(/[\\%_\[]/g, (c) => '\\' + c);
}
