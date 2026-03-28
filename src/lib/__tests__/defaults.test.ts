import { describe, it, expect } from 'vitest';
import type { WelderJob } from '../../types';
import sampleJob from '../../data/sample-job.json';
import {
  DEFAULT_CUSTOMER_OBLIGATIONS,
  DEFAULT_EXCLUSIONS,
  buildInitialProfileDefaults,
  getDefaultCustomerObligations,
  getDefaultExclusions,
} from '../defaults';

const baseJob: WelderJob = {
  ...(sampleJob as WelderJob),
  exclusions: ['No paint'],
  customer_obligations: ['Provide gate code'],
  workmanship_warranty_days: 45,
  negotiation_period: 12,
  payment_terms_days: 21,
  late_fee_rate: 2.5,
};

describe('defaults', () => {
  it('falls back to system exclusions for null and undefined only', () => {
    expect(getDefaultExclusions()).toEqual(DEFAULT_EXCLUSIONS);
    expect(getDefaultExclusions(null)).toEqual(DEFAULT_EXCLUSIONS);
    expect(getDefaultExclusions([])).toEqual([]);
    expect(getDefaultExclusions(['Custom'])).toEqual(['Custom']);
  });

  it('falls back to system customer obligations for null and undefined only', () => {
    expect(getDefaultCustomerObligations()).toEqual(DEFAULT_CUSTOMER_OBLIGATIONS);
    expect(getDefaultCustomerObligations(null)).toEqual(DEFAULT_CUSTOMER_OBLIGATIONS);
    expect(getDefaultCustomerObligations([])).toEqual([]);
    expect(getDefaultCustomerObligations(['Custom obligation'])).toEqual(['Custom obligation']);
  });

  it('builds initial profile defaults from the work order when opted in', () => {
    expect(buildInitialProfileDefaults(baseJob, true)).toEqual({
      default_exclusions: ['No paint'],
      default_assumptions: ['Provide gate code'],
      default_warranty_period: 45,
      default_negotiation_period: 12,
      default_payment_terms_days: 21,
      default_late_fee_rate: 2.5,
    });
  });

  it('uses system array defaults only when defaults capture is unchecked', () => {
    expect(buildInitialProfileDefaults(baseJob, false)).toEqual({
      default_exclusions: DEFAULT_EXCLUSIONS,
      default_assumptions: DEFAULT_CUSTOMER_OBLIGATIONS,
    });
  });
});
