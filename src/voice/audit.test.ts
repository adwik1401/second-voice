import { describe, expect, it } from 'vitest';
import { buildAuditRecord, renderAuditHtml } from './audit';
import { CheckState } from './check-state';
import type { TransferIntent } from './types';

const transfer: TransferIntent = {
  customerId: 'cust-sarah',
  amountGBP: 8000,
  payee: { name: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035' },
  newPayee: true,
  reference: 'Car deposit',
};
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

function concludedScam() {
  const s = new CheckState(transfer);
  s.setProfile({ tenureYears: 6, typicalPaymentsGBP: { low: 40, median: 120, high: 400 }, max90dOutgoingGBP: 4200 });
  s.setCop({ result: 'NO_MATCH', accountType: 'personal' });
  s.setPayeeRisk({ accountAgeDays: 9, muleRiskScore: 0.62, priorReports: 1 });
  s.recordAnswer('purpose', 'a car from a dealer', NOW);
  s.noteCoaching({ at: NOW + 1000, source: 'rules', type: 'script_feeding', quote: 'Tell her', confidence: 0.8 });
  s.noteEcho({ at: NOW + 9000, source: 'echo', type: 'echo', quote: "It's for a car deposit.", confidence: 1 });
  s.decide();
  return s;
}
const transcript = [
  { role: 'agent' as const, text: "What's this payment for?", at: NOW },
  { role: 'customer' as const, text: "Tell her it's for a car deposit.", at: NOW + 1000 },
];
const record = (s = concludedScam(), failureReason: string | null = null) =>
  buildAuditRecord({ reference: 'LRK-1234', snapshot: s.snapshot(), transcript, failureReason, now: NOW });

describe('buildAuditRecord', () => {
  it('captures the decision, the hard trigger and what the customer was told', () => {
    const r = record();
    expect(r.schema).toBe('second-voice.audit.v1');
    expect(r.risk).toMatchObject({ decision: 'ESCALATE', score: 100 });
    expect(r.risk.hardTrigger).toMatch(/repeated/);
    expect(r.outcome).toMatchObject({ concluded: true, title: 'A specialist will call you' });
    expect(r.outcome.toldToCustomer).toMatch(/specialist/);
  });

  it('explains the score line by line — reason points add up to it', () => {
    const r = record();
    expect(r.risk.reasons.length).toBeGreaterThan(3);
    const sum = r.risk.reasons.reduce((t, x) => t + x.points, 0);
    expect(r.risk.score === 100 ? sum >= 100 : sum === r.risk.score).toBe(true);
  });

  it('records every piece of coaching evidence with ISO timestamps', () => {
    const r = record();
    expect(r.coachingEvidence.map((e) => e.source)).toEqual(['rules', 'echo']);
    expect(r.coachingEvidence[0].at).toBe('2026-09-30T12:00:01.000Z');
    expect(r.generatedAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('keeps the bank checks, the customer answers and the conversation', () => {
    const r = record();
    expect(r.bankChecks.confirmationOfPayee).toMatchObject({ result: 'NO_MATCH' });
    expect(r.bankChecks.payeeRisk).toMatchObject({ accountAgeDays: 9 });
    expect(r.customerAnswers).toMatchObject([{ topic: 'purpose', answer: 'a car from a dealer' }]);
    expect(r.customerSignals.purposeContradictsPayee).toBe(true);
    expect(r.conversation.map((l) => l.role)).toEqual(['agent', 'customer']);
  });

  it('masks the account number to its last four digits', () => {
    const json = JSON.stringify(record());
    expect(json).not.toContain('71829035');
    expect(json).toContain('••••9035');
  });

  it('never stores audio and says so', () => {
    const r = record();
    expect(r.privacy.audioStored).toBe(false);
    expect(r.privacy.disclosure).toMatch(/no audio is recorded or stored/);
    expect(JSON.stringify(r)).not.toMatch(/base64|pcm|wav/i);
  });

  it('marks a check that is still running as not concluded, with the live score', () => {
    const live = new CheckState(transfer);
    live.setCop({ result: 'NO_MATCH', accountType: 'personal' });
    const r = record(live);
    expect(r.outcome).toMatchObject({ concluded: false, title: null, toldToCustomer: null });
    expect(r.risk.score).toBeGreaterThan(0);
  });

  it('records why a check was interrupted and that a human was requested', () => {
    const s = new CheckState(transfer);
    s.setCop({ result: 'NO_MATCH', accountType: 'personal' });
    s.requestHuman('customer asked for a person');
    s.decideInterrupted();
    const r = record(s, 'connection lost');
    expect(r.outcome).toMatchObject({ humanRequested: 'customer asked for a person', interruptionReason: 'connection lost', concluded: true });
  });
});

describe('renderAuditHtml', () => {
  it('renders the reference, decision, reasons and conversation', () => {
    const html = renderAuditHtml(record());
    expect(html).toContain('LRK-1234');
    expect(html).toContain('ESCALATE');
    expect(html).toContain('A specialist');
    expect(html).toContain('Tell her it&#39;s for a car deposit.');
    expect(html).toContain('••••9035');
  });

  it('escapes spoken text — a transcript cannot inject markup or script into the audit page', () => {
    const evil = '<script>alert(1)</script> "quoted" & <img src=x onerror=alert(2)>';
    const r = record();
    r.conversation[1].text = evil;
    r.coachingEvidence[0].quote = evil;
    const html = renderAuditHtml(r);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
  });

  it('labels a live (unconcluded) record as such', () => {
    const live = new CheckState(transfer);
    expect(renderAuditHtml(record(live))).toContain('LIVE, not concluded');
  });
});
