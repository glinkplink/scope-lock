/** US NANP display like (571) 473-1291 — strips non-digits, keeps up to 10 digits (strips leading 1 if 11). */
export function formatUsPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d[0] === '1') {
    d = d.slice(1);
  }
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
