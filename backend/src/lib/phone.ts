/** Normalizes Saudi-style mobile numbers to local 05XXXXXXXX form; other numbers are returned digits-only. */
export function normalizeMobile(input: string): string {
  let d = input.replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966') && d.length === 12) d = '0' + d.slice(3);
  if (d.length === 9 && d.startsWith('5')) d = '0' + d;
  return d;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_\[]/g, (c) => '\\' + c);
}
