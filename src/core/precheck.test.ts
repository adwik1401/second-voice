import { describe, expect, it } from 'vitest';
import { precheck, type PrecheckInput } from './precheck';

const base: PrecheckInput = { amountGBP: 400, newPayee: false, copResult: 'MATCH', max90dOutgoingGBP: 2_000 };
const check = (over: Partial<PrecheckInput>) => precheck({ ...base, ...over });

describe('precheck', () => {
  it('lets a small payment to a known payee through untouched', () => {
    expect(check({})).toEqual({ requiresVoiceCheck: false, reasons: [] });
  });

  it('lets a large payment to a verified, known payee through (legitimate payments meet no friction)', () => {
    expect(check({ amountGBP: 5_000, max90dOutgoingGBP: 4_000 }).requiresVoiceCheck).toBe(false);
  });

  it('triggers on a new payee at exactly £1,000 but not at £999.99', () => {
    expect(check({ amountGBP: 1_000, newPayee: true }).requiresVoiceCheck).toBe(true);
    expect(check({ amountGBP: 999.99, newPayee: true }).requiresVoiceCheck).toBe(false);
  });

  it('triggers on any Confirmation of Payee result other than MATCH (including UNAVAILABLE)', () => {
    for (const cop of ['CLOSE_MATCH', 'NO_MATCH', 'UNAVAILABLE'] as const) {
      const r = check({ amountGBP: 1_500, copResult: cop });
      expect(r.requiresVoiceCheck).toBe(true);
      expect(r.reasons).toEqual([`Confirmation of Payee: ${cop}`]);
    }
  });

  it('lists both reasons when the payee is new and the name does not match', () => {
    expect(check({ amountGBP: 2_000, newPayee: true, copResult: 'NO_MATCH' }).reasons).toHaveLength(2);
  });

  it('ignores payee risk below £1,000', () => {
    expect(check({ amountGBP: 900, newPayee: true, copResult: 'NO_MATCH' }).requiresVoiceCheck).toBe(false);
  });

  it('triggers on an amount of 3× the 90-day maximum even to a known, verified payee', () => {
    expect(check({ amountGBP: 600, max90dOutgoingGBP: 200 }).requiresVoiceCheck).toBe(true);
    expect(check({ amountGBP: 599, max90dOutgoingGBP: 200 }).requiresVoiceCheck).toBe(false);
  });

  it('skips the 3× rule when there is no outgoing history (it would trigger on everything)', () => {
    expect(check({ amountGBP: 50, max90dOutgoingGBP: 0 }).requiresVoiceCheck).toBe(false);
    expect(check({ amountGBP: 50, max90dOutgoingGBP: null }).requiresVoiceCheck).toBe(false);
  });
});
