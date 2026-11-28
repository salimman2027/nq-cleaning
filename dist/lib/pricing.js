"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineTotal = lineTotal;
exports.calcTotals = calcTotals;
/** All arithmetic is done in integer halalas to avoid float drift. */
function lineTotal(l) {
    return Math.round(l.quantity * l.unitPrice * 100) / 100;
}
function calcTotals(lines, discount, vatRatePct) {
    const subtotalC = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100), 0);
    const discountC = Math.round(discount * 100);
    if (discountC < 0 || discountC > subtotalC)
        throw new RangeError('Invalid discount');
    const taxableC = subtotalC - discountC;
    const vatC = Math.round((taxableC * vatRatePct) / 100);
    return {
        subtotal: subtotalC / 100,
        discount: discountC / 100,
        vat: vatC / 100,
        total: (taxableC + vatC) / 100,
    };
}
