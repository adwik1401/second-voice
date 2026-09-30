import { describe, expect, it } from 'vitest';
import { precheck } from '../../src/core/precheck';
import { score, type RiskSignals } from '../../src/core/risk-scorer';
import { GET as getProfile } from '../bank/profile';
import { GET as getPayeeCheck } from '../bank/payee-check';
import { GET as getPayeeRiskRoute } from '../bank/payee-risk';
import { checkPayee, getCustomerProfile, getPayeeRisk } from './bank';

const url = (path: string, params: Record<string, string> = {}) =>
  new Request(`http://localhost/api/bank/${path}?${new URLSearchParams(params)}`);

describe('getCustomerProfile', () => {
  it('returns the demo customer', () => {
    expect(getCustomerProfile('cust-sarah')).toMatchObject({ name: 'Sarah Mitchell', max90dOutgoingGBP: 4_200 });
  });
  it('returns null for an unknown customer', () => {
    expect(getCustomerProfile('nope')).toBeNull();
  });
});

describe('checkPayee (Confirmation of Payee)', () => {
  it('MATCHes the exact name, ignoring case and legal suffixes', () => {
    expect(checkPayee({ sortCode: '20-45-11', accountNumber: '40112233', name: 'priya shah' })).toEqual({
      result: 'MATCH',
      accountType: 'personal',
    });
    expect(checkPayee({ sortCode: '20-12-66', accountNumber: '60245518', name: 'Harriet Lane Plumbing' }).result).toBe('MATCH');
  });

  it('gives CLOSE_MATCH for a near miss and reveals the holder name only then', () => {
    const r = checkPayee({ sortCode: '99-56-78', accountNumber: '50294817', name: 'Global Investment Partners' });
    expect(r).toEqual({ result: 'CLOSE_MATCH', accountType: 'business', suggestedName: 'Global Invest Partners Ltd' });
  });

  it('gives NO_MATCH when the typed name has nothing in common, and does NOT leak the real holder name', () => {
    const r = checkPayee({ sortCode: '99-12-34', accountNumber: '71829035', name: 'Northgate Autos Ltd' });
    expect(r).toEqual({ result: 'NO_MATCH', accountType: 'personal' });
    expect(JSON.stringify(r)).not.toContain('Okafor');
  });

  it('accepts sort codes and account numbers in any formatting', () => {
    for (const [sc, acct] of [['991234', '7182 9035'], ['99 12 34', '71829035'], ['99-12-34', '71-82-90-35']]) {
      expect(checkPayee({ sortCode: sc, accountNumber: acct, name: 'D M Okafor' }).result).toBe('MATCH');
    }
  });

  it('is UNAVAILABLE for an unknown account', () => {
    expect(checkPayee({ sortCode: '11-11-11', accountNumber: '00000000', name: 'Anyone' })).toEqual({
      result: 'UNAVAILABLE',
      accountType: null,
    });
  });
});

describe('getPayeeRisk', () => {
  it('returns age, mule risk and prior reports', () => {
    expect(getPayeeRisk('99-12-34', '71829035')).toEqual({ accountAgeDays: 9, muleRiskScore: 0.62, priorReports: 1 });
  });
  it('returns null for an unknown account', () => {
    expect(getPayeeRisk('11-11-11', '00000000')).toBeNull();
  });
});

describe('GET /api/bank/profile', () => {
  it('200 with the profile', async () => {
    const res = getProfile(url('profile', { customerId: 'cust-sarah' }));
    expect(res.status).toBe(200);
    expect((await res.json()).customerId).toBe('cust-sarah');
  });
  it('404 for an unknown customer, 400 without an id', () => {
    expect(getProfile(url('profile', { customerId: 'nope' })).status).toBe(404);
    expect(getProfile(url('profile')).status).toBe(400);
  });
});

describe('GET /api/bank/payee-check', () => {
  it('200 with the Confirmation of Payee result', async () => {
    const res = getPayeeCheck(url('payee-check', { sortCode: '99-12-34', accountNumber: '71829035', name: 'Northgate Autos Ltd' }));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe('NO_MATCH');
  });
  it('400 when any parameter is missing', () => {
    expect(getPayeeCheck(url('payee-check', { sortCode: '99-12-34', accountNumber: '71829035' })).status).toBe(400);
  });
});

describe('GET /api/bank/payee-risk', () => {
  it('200 with the risk record', async () => {
    const res = getPayeeRiskRoute(url('payee-risk', { sortCode: '99-56-78', accountNumber: '50294817' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ muleRiskScore: 0.78 });
  });
  it('404 for an unknown account (the client treats this as a failed tool), 400 when missing', () => {
    expect(getPayeeRiskRoute(url('payee-risk', { sortCode: '11-11-11', accountNumber: '00000000' })).status).toBe(404);
    expect(getPayeeRiskRoute(url('payee-risk', { sortCode: '11-11-11' })).status).toBe(400);
  });
});

/**
 * The data exists to drive the four demo scenarios (spec §11). This wires the mock bank through the real
 * precheck and risk scorer so that changing the data can't silently break the demo story.
 */
describe('demo scenarios end to end (data → precheck → scorer)', () => {
  const sarah = getCustomerProfile('cust-sarah')!;
  const known = (sortCode: string, accountNumber: string) =>
    sarah.knownPayees.some((p) => p.sortCode === sortCode && p.accountNumber === accountNumber);

  /** Runs the bank side of a transfer: precheck, then the risk signals the bank checks alone would produce. */
  function bankSide(amountGBP: number, typedName: string, sortCode: string, accountNumber: string) {
    const newPayee = !known(sortCode, accountNumber);
    const cop = checkPayee({ sortCode, accountNumber, name: typedName });
    const risk = getPayeeRisk(sortCode, accountNumber);
    const gate = precheck({ amountGBP, newPayee, copResult: cop.result, max90dOutgoingGBP: sarah.max90dOutgoingGBP });
    const signals: RiskSignals = {
      newPayee,
      copResult: cop.result,
      payeeAccountAgeDays: risk?.accountAgeDays ?? null,
      payeeMuleRisk: risk?.muleRiskScore ?? null,
      amountVsMax90d: amountGBP / sarah.max90dOutgoingGBP,
      purposeContradictsPayee: false,
      pressureCues: 0,
      backgroundSpeech: false,
      coachingConfidence: null,
      echo: false,
      toolFailed: false,
      toldToLie: false,
      safeAccount: false,
      contactedByAuthority: false,
    };
    return { gate, signals };
  }

  it('S1 — £400 to a known payee meets no friction at all', () => {
    expect(bankSide(400, 'Priya Shah', '20-45-11', '40112233').gate.requiresVoiceCheck).toBe(false);
  });

  it('S2 — £1,200 to a legitimate new payee gets a check, scores 20 with benign chatter, and is RELEASED', () => {
    const { gate, signals } = bankSide(1_200, 'Harriet Lane Plumbing Ltd', '20-12-66', '60245518');
    expect(gate.requiresVoiceCheck).toBe(true);
    expect(score({ ...signals, backgroundSpeech: true })).toMatchObject({ score: 20, decision: 'RELEASE' });
  });

  it('S3 — an uncoached scam is held or escalated on bank signals alone', () => {
    const { gate, signals } = bankSide(2_500, 'Global Investment Partners', '99-56-78', '50294817');
    expect(gate.requiresVoiceCheck).toBe(true);
    expect(score(signals).decision).not.toBe('RELEASE');
  });

  it('S4 — the £8,000 "car dealer" payment: bank signals alone HOLD; the coach is what tips it to ESCALATE', () => {
    const { gate, signals } = bankSide(8_000, 'Northgate Autos Ltd', '99-12-34', '71829035');
    expect(gate.requiresVoiceCheck).toBe(true);

    const bankOnly = score({ ...signals, purposeContradictsPayee: true }); // "car dealer" vs a personal account
    expect(bankOnly.decision).toBe('COOLING_OFF');
    expect(bankOnly.score).toBeLessThan(70);

    const coached = score({ ...signals, purposeContradictsPayee: true, coachingConfidence: 0.86, echo: true });
    expect(coached).toMatchObject({ decision: 'ESCALATE' });
    expect(coached.hardTrigger).not.toBeNull();
  });
});
