/**
 * Audit record (Plan Step 21, spec §7.11): the auditable trail of one Voice Check — what was asked, what the bank
 * checks found, every signal with its evidence and points, and the decision. Supports the claim that every
 * intervention is explainable line by line.
 *
 * Privacy by design: NO audio is ever stored (only text), the account number is masked to its last four digits,
 * and the export is user-initiated. All data in this project is fictional.
 */
import type { RiskReason } from '../core/risk-scorer';
import type { CheckSnapshot, CoachEvidence } from './check-state';
import { OUTCOME_EXPLANATION, OUTCOME_TITLE } from './outcome';
import type { CopInfo, PayeeRiskInfo, ProfileInfo, TranscriptLine } from './types';

export interface AuditRecord {
  schema: 'second-voice.audit.v1';
  generatedAt: string;
  reference: string;
  transfer: {
    customerId: string;
    amountGBP: number;
    payeeName: string;
    sortCode: string;
    /** Masked to the last four digits. */
    accountNumber: string;
    newPayee: boolean;
    paymentReference: string;
  };
  bankChecks: {
    confirmationOfPayee: CopInfo | null;
    payeeRisk: PayeeRiskInfo | null;
    customerProfile: ProfileInfo | null;
    anyCheckUnverified: boolean;
  };
  conversation: { at: string; role: 'customer' | 'agent'; text: string }[];
  customerAnswers: { at: string; topic: string; answer: string }[];
  customerSignals: {
    pressureCues: string[];
    toldToGiveFalseReason: boolean;
    safeAccountMentioned: boolean;
    contactedByAuthority: boolean;
    purposeContradictsPayee: boolean;
  };
  coachingEvidence: { at: string; source: CoachEvidence['source']; type: string; quote: string; confidence: number }[];
  risk: { score: number; decision: string; hardTrigger: string | null; reasons: RiskReason[] };
  outcome: {
    /** false while the check is still running — `risk` is then the live score, not a decision. */
    concluded: boolean;
    title: string | null;
    toldToCustomer: string | null;
    humanRequested: string | null;
    /** Set when the check could not run normally (mic denied, connection lost…) and the payment was held. */
    interruptionReason: string | null;
  };
  privacy: { audioStored: false; disclosure: string };
}

export interface AuditInput {
  reference: string;
  snapshot: CheckSnapshot;
  transcript: TranscriptLine[];
  failureReason: string | null;
  now?: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const maskAccount = (n: string) => `••••${n.replace(/\D/g, '').slice(-4)}`;

export function buildAuditRecord({ reference, snapshot: s, transcript, failureReason, now = Date.now() }: AuditInput): AuditRecord {
  const final = s.decision ?? s.risk;
  return {
    schema: 'second-voice.audit.v1',
    generatedAt: iso(now),
    reference,
    transfer: {
      customerId: s.transfer.customerId,
      amountGBP: s.transfer.amountGBP,
      payeeName: s.transfer.payee.name,
      sortCode: s.transfer.payee.sortCode,
      accountNumber: maskAccount(s.transfer.payee.accountNumber),
      newPayee: s.transfer.newPayee,
      paymentReference: s.transfer.reference,
    },
    bankChecks: { confirmationOfPayee: s.cop, payeeRisk: s.payeeRisk, customerProfile: s.profile, anyCheckUnverified: s.toolFailed },
    conversation: transcript.map((l) => ({ at: iso(l.at), role: l.role, text: l.text })),
    customerAnswers: s.answers.map((a) => ({ at: iso(a.at), topic: a.topic, answer: a.answer })),
    customerSignals: {
      pressureCues: s.pressure,
      toldToGiveFalseReason: s.toldToLie,
      safeAccountMentioned: s.safeAccount,
      contactedByAuthority: s.contactedByAuthority,
      purposeContradictsPayee: s.purposeContradictsPayee,
    },
    coachingEvidence: s.coachEvidence.map((e) => ({ at: iso(e.at), source: e.source, type: e.type, quote: e.quote, confidence: e.confidence })),
    risk: { score: final.score, decision: final.decision, hardTrigger: final.hardTrigger, reasons: final.reasons },
    outcome: {
      concluded: s.decision !== null,
      title: s.decision ? OUTCOME_TITLE[s.decision.decision] : null,
      toldToCustomer: s.decision ? OUTCOME_EXPLANATION[s.decision.decision] : null,
      humanRequested: s.humanRequested,
      interruptionReason: failureReason,
    },
    privacy: { audioStored: false, disclosure: 'Customer was told audio from their device is analysed during the check; no audio is recorded or stored.' },
  };
}

const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A self-contained, printable HTML rendering. Every value is escaped: transcripts contain arbitrary spoken text. */
export function renderAuditHtml(r: AuditRecord): string {
  const row = (a: string, b: unknown) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Audit record ${esc(r.reference)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1b2b34}h1{font-size:20px}h2{font-size:15px;margin-top:22px;border-bottom:1px solid #ddd}
table{border-collapse:collapse;width:100%}th{text-align:left;width:230px;vertical-align:top;color:#5d6f78;font-weight:600}td,th{padding:3px 8px;border-bottom:1px solid #eee}.pts{text-align:right}</style></head><body>
<h1>Voice Check audit record — ${esc(r.reference)}</h1>
<p>Generated ${esc(r.generatedAt)}. Fictional data. ${esc(r.privacy.disclosure)}</p>
<h2>Outcome</h2><table>${row('Decision', `${r.risk.decision} (score ${r.risk.score}/100)${r.outcome.concluded ? '' : ' — LIVE, not concluded'}`)}${row('Shown to customer', r.outcome.title ?? '—')}${row('Told to customer', r.outcome.toldToCustomer ?? '—')}${row('Hard trigger', r.risk.hardTrigger ?? 'none')}${row('Human requested', r.outcome.humanRequested ?? 'no')}${row('Interruption', r.outcome.interruptionReason ?? 'none')}</table>
<h2>Why — score breakdown</h2><table>${r.risk.reasons.map((x) => `<tr><td>${esc(x.label)}</td><td class="pts">+${esc(x.points)}</td></tr>`).join('') || '<tr><td>No risk signals</td><td></td></tr>'}</table>
<h2>Transfer</h2><table>${row('Amount', `£${r.transfer.amountGBP.toFixed(2)}`)}${row('Payee', r.transfer.payeeName)}${row('Sort code / account', `${r.transfer.sortCode} / ${r.transfer.accountNumber}`)}${row('New payee', r.transfer.newPayee ? 'yes' : 'no')}${row('Payment reference', r.transfer.paymentReference)}</table>
<h2>Bank checks</h2><table>${row('Confirmation of Payee', r.bankChecks.confirmationOfPayee ? `${r.bankChecks.confirmationOfPayee.result} (${r.bankChecks.confirmationOfPayee.accountType ?? 'unknown type'})` : 'not run')}${row('Recipient account', r.bankChecks.payeeRisk ? `${r.bankChecks.payeeRisk.accountAgeDays} days old, mule-risk ${r.bankChecks.payeeRisk.muleRiskScore}, ${r.bankChecks.payeeRisk.priorReports} prior reports` : 'not checked')}${row('Any check unverified', r.bankChecks.anyCheckUnverified ? 'yes' : 'no')}</table>
<h2>Coaching evidence</h2><table>${r.coachingEvidence.map((e) => `<tr><td>${esc(e.at)} · ${esc(e.source)} · ${esc(e.type)}</td><td>“${esc(e.quote)}” (${Math.round(e.confidence * 100)}%)</td></tr>`).join('') || '<tr><td>None detected</td><td></td></tr>'}</table>
<h2>Conversation</h2><table>${r.conversation.map((l) => `<tr><th>${esc(l.role)} · ${esc(l.at)}</th><td>${esc(l.text)}</td></tr>`).join('')}</table>
</body></html>`;
}
