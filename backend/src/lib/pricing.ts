export interface PriceLine {
  quantity: number;
  unitPrice: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
}

/** All arithmetic is done in integer halalas to avoid float drift. */
export function lineTotal(l: PriceLine): number {
  return Math.round(l.quantity * l.unitPrice * 100) / 100;
}

export function calcTotals(lines: PriceLine[], discount: number, vatRatePct: number): Totals {
  const subtotalC = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100), 0);
  const discountC = Math.round(discount * 100);
  if (discountC < 0 || discountC > subtotalC) throw new RangeError('Invalid discount');
  const taxableC = subtotalC - discountC;
  const vatC = Math.round((taxableC * vatRatePct) / 100);
  return {
    subtotal: subtotalC / 100,
    discount: discountC / 100,
    vat: vatC / 100,
    total: (taxableC + vatC) / 100,
  };
}
