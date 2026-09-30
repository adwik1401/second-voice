/**
 * Voice Check trigger (Plan Step 9, spec §7.1): does this transfer need the in-app voice check?
 * Deliberately narrow — a legitimate payment to a known payee must never meet friction.
 */
import type { CopResult } from './types';

export const VOICE_CHECK_MIN_GBP = 1_000;
/** A transfer this many times the customer's largest outgoing payment in 90 days is unusual on its own. */
export const UNUSUAL_AMOUNT_MULTIPLE = 3;

export interface PrecheckInput {
  amountGBP: number;
  newPayee: boolean;
  copResult: CopResult;
  /** Largest outgoing payment in the last 90 days; null/0 when the customer has no history. */
  max90dOutgoingGBP: number | null;
}

export interface PrecheckResult {
  requiresVoiceCheck: boolean;
  reasons: string[];
}

/** amount ≥ £1,000 AND (new payee OR CoP ≠ MATCH), OR amount ≥ 3× the customer's 90-day maximum. */
export function precheck(input: PrecheckInput): PrecheckResult {
  const reasons: string[] = [];

  if (input.amountGBP >= VOICE_CHECK_MIN_GBP) {
    if (input.newPayee) reasons.push('new payee');
    // UNAVAILABLE counts as "not a match": an unverified payee is not a verified one.
    if (input.copResult !== 'MATCH') reasons.push(`Confirmation of Payee: ${input.copResult}`);
  }

  // With no outgoing history the 3× rule would trigger on every amount, so it only applies with a baseline.
  const max = input.max90dOutgoingGBP;
  if (max !== null && max > 0 && input.amountGBP >= UNUSUAL_AMOUNT_MULTIPLE * max) {
    reasons.push(`amount is ${UNUSUAL_AMOUNT_MULTIPLE}× or more your 90-day maximum`);
  }

  return { requiresVoiceCheck: reasons.length > 0, reasons };
}
