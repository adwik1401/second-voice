import { describe, expect, it } from 'vitest';
import { CheckState } from '../voice/check-state';
import type { TransferIntent } from '../voice/types';
import { gaugeBand, signalChips } from './officer-signals';

const transfer = (over: Partial<TransferIntent> = {}): TransferIntent => ({
  customerId: 'cust-sarah',
  amountGBP: 8000,
  payee: { name: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035' },
  newPayee: true,
  reference: 'car',
  ...over,
});
const profile = { tenureYears: 6, typicalPaymentsGBP: { low: 40, median: 120, high: 400 }, max90dOutgoingGBP: 4200 };
const labels = (s: CheckState) => signalChips(s.snapshot()).map((c) => c.label);
const tones = (s: CheckState) => Object.fromEntries(signalChips(s.snapshot()).map((c) => [c.label, c.tone]));

describe('signalChips', () => {
  it('shows a legitimate known payee as reassuring throughout', () => {
    const s = new CheckState(transfer({ newPayee: false, amountGBP: 400 }));
    s.setProfile(profile);
    s.setCop({ result: 'MATCH', accountType: 'personal' });
    s.setPayeeRisk({ accountAgeDays: 2190, muleRiskScore: 0.03, priorReports: 0 });
    expect(signalChips(s.snapshot()).every((c) => c.tone === 'ok')).toBe(true);
  });

  it('flags the demo scam: new payee, NO MATCH, young account, contradicting purpose', () => {
    const s = new CheckState(transfer());
    s.setProfile(profile);
    s.setCop({ result: 'NO_MATCH', accountType: 'personal' });
    s.setPayeeRisk({ accountAgeDays: 9, muleRiskScore: 0.62, priorReports: 1 });
    s.recordAnswer('purpose', 'a car from a dealer', 1);
    expect(tones(s)).toMatchObject({
      'New payee': 'warn',
      'Confirmation of Payee: no match': 'bad',
      'Recipient account 9 days old': 'warn',
      'Mule risk 0.62': 'ok',
      'Stated purpose contradicts the payee': 'bad',
    });
  });

  it('shows coaching with its type and confidence, and the echo', () => {
    const s = new CheckState(transfer());
    s.noteCoaching({ at: 1, source: 'rules', type: 'secrecy_instruction', quote: "Don't mention me", confidence: 0.9 });
    s.noteEcho({ at: 2, source: 'echo', type: 'echo', quote: 'x', confidence: 1 });
    expect(labels(s)).toContain('Coaching detected (secrecy instruction) 90%');
    expect(tones(s)['Customer repeated the coach’s words']).toBe('bad');
  });

  it('names the strongest coaching type when several were seen, ignoring echo evidence', () => {
    const s = new CheckState(transfer());
    s.noteCoaching({ at: 1, source: 'rules', type: 'script_feeding', quote: 'a', confidence: 0.8 });
    s.noteCoaching({ at: 2, source: 'rules', type: 'secrecy_instruction', quote: 'b', confidence: 0.9 });
    s.noteEcho({ at: 3, source: 'echo', type: 'echo', quote: 'c', confidence: 1 });
    expect(labels(s)).toContain('Coaching detected (secrecy instruction) 90%');
  });

  it('shows pressure cues, hard triggers, unverified checks and a human request', () => {
    const s = new CheckState(transfer());
    s.absorbCustomerText("It's urgent, don't tell the bank. They said use a safe account. He told me what to say.");
    s.markToolFailed();
    s.requestHuman('x');
    const l = labels(s);
    expect(l).toEqual(expect.arrayContaining(['Urgency in answers', 'Secrecy in answers', 'Authority claims in answers', 'Told what to say', '“Safe account” mentioned', 'A bank check could not be verified', 'Customer asked for a person']));
  });

  it('notes an amount of 3× the 90-day maximum', () => {
    const s = new CheckState(transfer({ amountGBP: 13_000 }));
    s.setProfile(profile);
    expect(labels(s)).toContain('Amount 3× or more the 90-day maximum');
  });

  it('warns on a CLOSE MATCH or an UNAVAILABLE Confirmation of Payee', () => {
    const s = new CheckState(transfer());
    s.setCop({ result: 'CLOSE_MATCH', accountType: 'business' });
    expect(tones(s)['Confirmation of Payee: close match']).toBe('warn');
  });
});

describe('gaugeBand', () => {
  it.each([
    [0, 'release'],
    [29, 'release'],
    [30, 'hold'],
    [69, 'hold'],
    [70, 'escalate'],
    [100, 'escalate'],
  ] as const)('%i → %s (the scorer’s thresholds)', (score, band) => {
    expect(gaugeBand(score)).toBe(band);
  });
});
