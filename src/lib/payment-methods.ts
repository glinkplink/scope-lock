export const PAYMENT_METHOD_COLUMN_LEFT = ['Card', 'Cash', 'Check'] as const;
export const PAYMENT_METHOD_COLUMN_RIGHT = ['Venmo', 'Cash App', 'Zelle'] as const;

export const PAYMENT_METHOD_OPTIONS = [
  ...PAYMENT_METHOD_COLUMN_LEFT,
  ...PAYMENT_METHOD_COLUMN_RIGHT,
] as const;

export type PaymentMethod = (typeof PAYMENT_METHOD_OPTIONS)[number];

const PAYMENT_METHOD_ALIASES: Record<string, PaymentMethod> = {
  CashApp: 'Cash App',
};

const PAYMENT_METHOD_SET = new Set<string>(PAYMENT_METHOD_OPTIONS);

export function normalizePaymentMethod(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return PAYMENT_METHOD_ALIASES[trimmed] ?? trimmed;
}

export function normalizePaymentMethods(values: readonly string[] | null | undefined): string[] {
  if (!values) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const method = normalizePaymentMethod(value);
    if (!method || seen.has(method)) continue;
    seen.add(method);
    normalized.push(method);
  }

  return normalized;
}

export function isKnownPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHOD_SET.has(value);
}
