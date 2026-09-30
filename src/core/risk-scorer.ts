/**
 * Risk Scorer (Plan Step 8, spec §7.7): transparent, deterministic, auditable.
 * The LLM only supplies *signals*; this table makes the decision, so every outcome can be explained
 * line by line in the audit record. Customer-protective invariant: there is no "deny" — every
 * non-release outcome is a hold or a human, and always offers a human.
 */
import type { CopResult } from './types';

export type Decision = 'RELEASE' | 'COOLING_OFF' | 'ESCALATE';

export const COOLING_OFF_MIN = 30;
export const ESCALATE_MIN = 70;
/** Coaching / content cues below this confidence add nothing. */
export const COACHING_MIN_CONFIDENCE = 0.7;

export interface RiskSignals {
  newPayee: boolean;
  copResult: CopResult;
  payeeAccountAgeDays: number | null;
  /** 0..1 from the payee risk service. */
  payeeMuleRisk: number | null;
  /** amount ÷ the customer's 90-day maximum outgoing payment; null when there is no baseline. */
  amountVsMax90d: number | null;
  /** The customer's stated purpose contradicts payee data (e.g. "car dealer" but a personal account). */
  purposeContradictsPayee: boolean;
  /** Distinct pressure cues heard in the customer's answers: urgency, secrecy, authority impersonation. */
  pressureCues: number;
  backgroundSpeech: boolean;
  /** Confidence of the best coaching content cue; null when none was found. */
  coachingConfidence: number | null;
  echo: boolean;
  /** Any bank tool call failed, so something stayed unverified. */
  toolFailed: boolean;
  /** Hard triggers reported by the customer. */
  toldToLie: boolean;
  safeAccount: boolean;
  contactedByAuthority: boolean;
}

export interface RiskReason {
  label: string;
  points: number;
}

export interface RiskResult {
  /** 0..100 */
  score: number;
  decision: Decision;
  reasons: RiskReason[];
  /** Set when a hard trigger forced ESCALATE regardless of score. */
  hardTrigger: string | null;
  /** Always true unless the decision is RELEASE. */
  offerHuman: boolean;
}

/** Score table from spec §7.7. */
function scoreReasons(s: RiskSignals): RiskReason[] {
  const r: RiskReason[] = [];
  const add = (label: string, points: number) => r.push({ label, points });

  if (s.newPayee) add('New payee', 10);
  if (s.copResult === 'CLOSE_MATCH') add('Confirmation of Payee: close match only', 10);
  if (s.copResult === 'NO_MATCH') add('Confirmation of Payee: name does not match', 20);
  if (s.payeeAccountAgeDays !== null && s.payeeAccountAgeDays < 30) add('Payee account under 30 days old', 15);
  if (s.payeeMuleRisk !== null && s.payeeMuleRisk >= 0.7) add('Payee has a high mule-risk score', 20);
  if (s.amountVsMax90d !== null && s.amountVsMax90d >= 3) add('Amount is 3× or more the 90-day maximum', 10);
  if (s.purposeContradictsPayee) add('Stated purpose contradicts payee data', 15);
  if (s.pressureCues > 0) add('Pressure cues in the customer’s answers (urgency / secrecy / authority)', Math.min(s.pressureCues * 10, 20));
  if (s.backgroundSpeech) add('Background speech detected', 10);
  if (s.coachingConfidence !== null && s.coachingConfidence >= COACHING_MIN_CONFIDENCE) add('Coaching detected', 25);
  if (s.echo) add('Customer repeated what a second voice said', 30);
  if (s.toolFailed) add('A bank check could not be completed (unverified)', 10);
  return r;
}

const isCoaching = (s: RiskSignals) => s.coachingConfidence !== null && s.coachingConfidence >= COACHING_MIN_CONFIDENCE;

/** The first hard trigger that applies, or null. Order matters only for the audit message. */
function hardTrigger(s: RiskSignals): string | null {
  if (s.echo && isCoaching(s)) return 'Coaching detected and the customer repeated the coach’s words';
  if (s.toldToLie) return 'Customer was told to give a false reason';
  if (s.safeAccount) return 'Customer was asked to move money to a “safe account”';
  if (s.contactedByAuthority) return 'Customer was contacted by someone claiming to be the police or the bank';
  return null;
}

export function score(signals: RiskSignals): RiskResult {
  const reasons = scoreReasons(signals);
  let total = Math.min(
    100,
    reasons.reduce((sum, r) => sum + r.points, 0),
  );

  /** Lifts the score to `floor` and records the lift as its own audit line, so the reasons still sum to the score. */
  const liftTo = (floor: number, label: string) => {
    if (total < floor) {
      reasons.push({ label, points: floor - total });
      total = floor;
    }
  };

  const trigger = hardTrigger(signals);
  let decision: Decision;
  if (trigger !== null) {
    decision = 'ESCALATE';
    liftTo(ESCALATE_MIN, `Escalation rule: ${trigger}`);
  } else if (total >= ESCALATE_MIN) {
    decision = 'ESCALATE';
  } else if (total >= COOLING_OFF_MIN || isCoaching(signals)) {
    // Coaching floor: a confidently detected coach always earns at least a hold, even if other checks passed
    // (or a bank tool failed to report back) and the points alone fall short of the threshold.
    decision = 'COOLING_OFF';
    if (isCoaching(signals)) liftTo(COOLING_OFF_MIN, 'Minimum hold applied because coaching was detected');
  } else {
    decision = 'RELEASE';
  }

  return { score: total, decision, reasons, hardTrigger: trigger, offerHuman: decision !== 'RELEASE' };
}
