import { describe, expect, it } from 'vitest';

import { computeCOTotal } from '../db/change-orders';

describe('computeCOTotal', () => {
  it('avoids common floating point carry in the final total', () => {
    expect(
      computeCOTotal([
        { id: 'a', description: 'Labor', quantity: 1, unit_rate: 0.1 },
        { id: 'b', description: 'Material', quantity: 1, unit_rate: 0.2 },
      ])
    ).toBe(0.3);
  });

  it('rounds each line item to cents before summing', () => {
    expect(
      computeCOTotal([
        { id: 'a', description: 'Cutting', quantity: 3, unit_rate: 19.995 },
        { id: 'b', description: 'Steel', quantity: 2, unit_rate: 4.335 },
      ])
    ).toBe(68.66);
  });
});
