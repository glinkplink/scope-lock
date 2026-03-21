export const DEFAULT_TAX_RATE = 0.06;

export function normalizeTaxRate(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_TAX_RATE;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (!Number.isFinite(n)) return DEFAULT_TAX_RATE;
    return Math.max(0, n);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return DEFAULT_TAX_RATE;
    return Math.max(0, value);
  }
  return DEFAULT_TAX_RATE;
}

export function taxRateToPercentValue(rate: unknown): string {
  return (normalizeTaxRate(rate) * 100).toString();
}

export function percentValueToTaxRate(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed) / 100;
}
