/**
 * What the Fraud Officer Panel shows as signal chips, derived purely from a check's snapshot.
 * Tone: ok = reassuring, warn = worth noting, bad = drives the decision, info = neutral.
 */
import type { CheckSnapshot } from '../voice/check-state';

export type Tone = 'ok' | 'warn' | 'bad' | 'info';
export interface Chip {
  label: string;
  tone: Tone;
}

const PRESSURE_LABEL = { urgency: 'Urgency', secrecy: 'Secrecy', authority: 'Authority claims' } as const;

export function signalChips(s: CheckSnapshot): Chip[] {
  const chips: Chip[] = [];

  chips.push(s.transfer.newPayee ? { label: 'New payee', tone: 'warn' } : { label: 'Known payee', tone: 'ok' });

  if (s.cop) {
    const tone: Tone = s.cop.result === 'MATCH' ? 'ok' : s.cop.result === 'NO_MATCH' ? 'bad' : 'warn';
    chips.push({ label: `Confirmation of Payee: ${s.cop.result.replace('_', ' ').toLowerCase()}`, tone });
  }
  if (s.payeeRisk) {
    chips.push({ label: `Recipient account ${s.payeeRisk.accountAgeDays} days old`, tone: s.payeeRisk.accountAgeDays < 30 ? 'warn' : 'ok' });
    chips.push({ label: `Mule risk ${s.payeeRisk.muleRiskScore.toFixed(2)}`, tone: s.payeeRisk.muleRiskScore >= 0.7 ? 'bad' : 'ok' });
  }
  if (s.profile && s.profile.max90dOutgoingGBP > 0 && s.transfer.amountGBP >= 3 * s.profile.max90dOutgoingGBP) {
    chips.push({ label: 'Amount 3× or more the 90-day maximum', tone: 'warn' });
  }
  if (s.purposeContradictsPayee) chips.push({ label: 'Stated purpose contradicts the payee', tone: 'bad' });

  for (const cue of s.pressure) chips.push({ label: `${PRESSURE_LABEL[cue]} in answers`, tone: 'warn' });
  if (s.toldToLie) chips.push({ label: 'Told what to say', tone: 'bad' });
  if (s.safeAccount) chips.push({ label: '“Safe account” mentioned', tone: 'bad' });
  if (s.contactedByAuthority) chips.push({ label: 'Contacted by “police / the bank”', tone: 'bad' });

  if (s.coachingConfidence !== null) {
    const top = [...s.coachEvidence].filter((e) => e.source !== 'echo').sort((a, b) => b.confidence - a.confidence)[0];
    chips.push({ label: `Coaching detected${top ? ` (${top.type.replace(/_/g, ' ')})` : ''} ${Math.round(s.coachingConfidence * 100)}%`, tone: 'bad' });
  }
  if (s.echo) chips.push({ label: 'Customer repeated the coach’s words', tone: 'bad' });
  if (s.backgroundSpeech) chips.push({ label: 'Second voice in the room', tone: 'warn' });
  if (s.toolFailed) chips.push({ label: 'A bank check could not be verified', tone: 'warn' });
  if (s.humanRequested) chips.push({ label: 'Customer asked for a person', tone: 'info' });

  return chips;
}

/** Colour band for the gauge, matching the scorer's thresholds (30 / 70). */
export function gaugeBand(score: number): 'release' | 'hold' | 'escalate' {
  return score >= 70 ? 'escalate' : score >= 30 ? 'hold' : 'release';
}
