import { describe, expect, it } from 'vitest';
import { parseCurrency, parseCurrencyInput, roundCurrency } from '../currency';

describe('currency rounding', () => {
  it('absorbs sub-cent drift that would otherwise subtract a penny', () => {
    expect(roundCurrency(2499.994999)).toBe(2500);
    expect(parseCurrency('2499.994999')).toBe(2500);
  });

  it('preserves valid two-decimal amounts', () => {
    expect(roundCurrency(2499.99)).toBe(2499.99);
    expect(parseCurrency('2500.25')).toBe(2500.25);
  });

  it('parses common currency input formatting', () => {
    expect(parseCurrencyInput('$2,000.00')).toBe(2000);
    expect(parseCurrencyInput(' 2,000 ')).toBe(2000);
    expect(parseCurrencyInput('2k')).toBe(2000);
    expect(parseCurrencyInput('')).toBe(0);
  });
});
