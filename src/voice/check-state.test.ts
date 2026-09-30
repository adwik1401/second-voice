import { describe, expect, it, vi } from 'vitest';
import { CheckState } from './check-state';
import type { TransferIntent } from './types';

const transfer = (over: Partial<TransferIntent> = {}): TransferIntent => ({
  customerId: 'cust-sarah',
  amountGBP: 8000,
  payee: { name: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035' },
  newPayee: true,
  reference: 'car',
  ...over,
});
const profile = { tenureYears: 6, typicalPaymentsGBP: { low: 40, median: 120, high: 400 }, max90dOutgoingGBP: 4200 };

/** The bank-side facts of the demo scam (S4), as the tools would deliver them. */
function scamState() {
  const s = new CheckState(transfer());
  s.setProfile(profile);
  s.setCop({ result: 'NO_MATCH', accountType: 'personal' });
  s.setPayeeRisk({ accountAgeDays: 9, muleRiskScore: 0.62, priorReports: 1 });
  return s;
}

describe('toRiskSignals', () => {
  it('maps the collected facts onto the scorer’s inputs', () => {
    const sig = scamState().toRiskSignals();
    expect(sig).toMatchObject({
      newPayee: true,
      copResult: 'NO_MATCH',
      payeeAccountAgeDays: 9,
      payeeMuleRisk: 0.62,
      pressureCues: 0,
      coachingConfidence: null,
    });
    expect(sig.amountVsMax90d).toBeCloseTo(8000 / 4200);
  });

  it('treats a missing Confirmation of Payee as unverified, never a match', () => {
    expect(new CheckState(transfer()).toRiskSignals().copResult).toBe('UNAVAILABLE');
  });

  it('has no amount ratio without a baseline', () => {
    expect(new CheckState(transfer()).toRiskSignals().amountVsMax90d).toBeNull();
  });
});

describe('customer words', () => {
  it('accumulates distinct pressure cues, each counted once', () => {
    const s = scamState();
    s.absorbCustomerText("It's urgent");
    s.absorbCustomerText('very urgent, hurry');
    s.absorbCustomerText("don't tell the bank");
    expect(s.toRiskSignals().pressureCues).toBe(2);
  });

  it('keeps hard triggers once seen', () => {
    const s = scamState();
    s.absorbCustomerText('He told me what to say');
    s.absorbCustomerText('nothing special here');
    expect(s.toRiskSignals().toldToLie).toBe(true);
  });

  it('record_answer stores the answer AND mines it', () => {
    const s = scamState();
    s.recordAnswer('contact_method', 'the police rang me and said use a safe account', 1000);
    expect(s.answers).toHaveLength(1);
    expect(s.toRiskSignals()).toMatchObject({ safeAccount: true, contactedByAuthority: true });
  });

  it('flags a purpose that contradicts the payee only once both purpose and account type are known', () => {
    const s = new CheckState(transfer());
    s.recordAnswer('purpose', 'a deposit on a car from a dealer', 1);
    expect(s.toRiskSignals().purposeContradictsPayee).toBe(false); // no account type yet
    s.setCop({ result: 'NO_MATCH', accountType: 'personal' });
    expect(s.toRiskSignals().purposeContradictsPayee).toBe(true);
  });

  it('uses the most recent purpose answer', () => {
    const s = scamState();
    s.recordAnswer('purpose', 'a car from a dealer', 1);
    s.recordAnswer('purpose', 'actually it is a loan to my cousin', 2);
    expect(s.toRiskSignals().purposeContradictsPayee).toBe(false);
  });
});

describe('coaching evidence', () => {
  it('keeps the highest confidence seen and records every piece of evidence', () => {
    const s = scamState();
    s.noteCoaching({ at: 1, source: 'rules', type: 'script_feeding', quote: 'tell her it is for a car', confidence: 0.8 });
    s.noteCoaching({ at: 2, source: 'rules', type: 'secrecy_instruction', quote: "don't mention me", confidence: 0.9 });
    s.noteCoaching({ at: 3, source: 'rules', type: 'urgency_pressure', quote: 'hurry', confidence: 0.8 });
    expect(s.coachingConfidence).toBe(0.9);
    expect(s.snapshot().coachEvidence).toHaveLength(3);
  });

  it('records an echo', () => {
    const s = scamState();
    s.noteEcho({ at: 1, source: 'echo', type: 'echo', quote: 'car deposit', confidence: 1 });
    expect(s.toRiskSignals().echo).toBe(true);
  });
});

describe('the demo scenarios through the real scorer (spec §11)', () => {
  it('S4: bank facts alone + the contradicting purpose HOLD; the coach tips it to ESCALATE', () => {
    const s = scamState();
    s.recordAnswer('purpose', 'a deposit on a car from a dealer', 1);
    expect(s.snapshot().risk).toMatchObject({ score: 60, decision: 'COOLING_OFF' });

    s.noteCoaching({ at: 2, source: 'rules', type: 'secrecy_instruction', quote: "don't mention me", confidence: 0.9 });
    const coached = s.snapshot().risk;
    expect(coached).toMatchObject({ score: 85, decision: 'ESCALATE', hardTrigger: null }); // 60 + 25: escalates on points alone
  });

  it('S4: coaching + echo is a hard trigger → ESCALATE', () => {
    const s = scamState();
    s.recordAnswer('purpose', 'a car from a dealer', 1);
    s.noteCoaching({ at: 2, source: 'rules', type: 'script_feeding', quote: 'x', confidence: 0.9 });
    s.noteEcho({ at: 3, source: 'echo', type: 'echo', quote: 'x', confidence: 1 });
    const d = s.decide();
    expect(d.decision).toBe('ESCALATE');
    expect(d.hardTrigger).not.toBeNull();
    expect(s.snapshot().decision).toBe(d);
  });
});

describe('interrupted check (spec §9: fail safe = hold, never release)', () => {
  it('turns a RELEASE into a hold with an audit line', () => {
    const s = new CheckState(transfer({ amountGBP: 1200, newPayee: true }));
    s.setCop({ result: 'MATCH', accountType: 'business' });
    const d = s.decideInterrupted();
    expect(d.decision).toBe('COOLING_OFF');
    expect(d.offerHuman).toBe(true);
    expect(d.reasons.at(-1)!.label).toMatch(/interrupted/);
    expect(d.reasons.reduce((t, r) => t + r.points, 0)).toBe(d.score);
  });

  it('keeps a worse outcome as it was', () => {
    const s = scamState();
    s.noteCoaching({ at: 1, source: 'rules', type: 'script_feeding', quote: 'x', confidence: 0.9 });
    s.noteEcho({ at: 2, source: 'echo', type: 'echo', quote: 'x', confidence: 1 });
    expect(s.decideInterrupted().decision).toBe('ESCALATE');
  });
});

describe('subscribe', () => {
  it('notifies on change and stops after unsubscribe', () => {
    const s = scamState();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.noteBackgroundSpeech();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.noteBackgroundSpeech();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('snapshot', () => {
  it('returns detached copies (mutating the snapshot does not change the state)', () => {
    const s = scamState();
    const snap = s.snapshot();
    snap.answers.push({ topic: 'purpose', answer: 'x', at: 1 });
    expect(s.answers).toHaveLength(0);
  });
});
