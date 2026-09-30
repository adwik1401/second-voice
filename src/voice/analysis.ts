/**
 * Turns the customer's own words into risk signals (spec §7.7: pressure cues, hard triggers, purpose contradiction).
 * Pure pattern matching over what the customer SAID — applied to every customer transcript, not just the
 * agent's `record_answer` calls, so a signal is never lost because the agent forgot to record it.
 * Precision over recall, like the coaching rules: a missed cue costs a few points; a false cue misjudges a customer.
 */
import type { PressureCue } from './types';

export interface TextAnalysis {
  pressure: PressureCue[];
  /** "I was told to say…" — a hard trigger. */
  toldToLie: boolean;
  /** "move it to a safe account" — a hard trigger. */
  safeAccount: boolean;
  /** "the bank / the police rang me" — a hard trigger (we ARE the bank; we did not ring). */
  contactedByAuthority: boolean;
}

const lower = (text: string) => text.toLowerCase().replace(/[‘’‛]/g, "'");

const URGENCY = /\b(?:urgent(?:ly)?|hurry|asap|right away|immediately|deadline|running out of time|today only|before (?:it'?s too late|they (?:close|stop)))\b/;
const SECRECY = /\b(?:secret|don'?t tell|do not tell|not to tell|keep (?:it|this|that) (?:quiet|secret|private)|between us|confidential|told me not to)\b/;
const AUTHORITY = /\b(?:police|fraud (?:team|department)|hmrc|national crime agency|safe account)\b/;

const TOLD_TO_LIE = /\b(?:told me (?:what )?to (?:say|lie|tell)|told me what to say|i was told to say|coached me|said i should say)\b/;
const SAFE_ACCOUNT = /\bsafe account\b/;
/**
 * An authority as the subject of a contact verb ("the police phoned me"), "called by / from <authority>", or the
 * noun form ("a call from the fraud team"). Not "I called the bank" — there the customer contacted us.
 */
const AUTHORITY_NAME = String.raw`(?:police|fraud (?:team|department)|hmrc|(?:my |the )?bank)`;
const CONTACT_VERB = String.raw`(?:called|rang|phoned|contacted|messaged|texted|emailed)`;
const CONTACTED_BY_AUTHORITY = new RegExp(
  String.raw`\b${AUTHORITY_NAME}\b[^.!?]{0,40}\b${CONTACT_VERB}\b` + // the police phoned me
    String.raw`|\b${CONTACT_VERB}\b[^.!?]{0,30}\b(?:by|from)\b[^.!?]{0,20}\b${AUTHORITY_NAME}\b` + // called by the bank
    String.raw`|\b(?:call|text|message|email)\b[^.!?]{0,10}\bfrom\b[^.!?]{0,15}\b${AUTHORITY_NAME}\b`, // a call from the fraud team
);

export function analyzeCustomerText(text: string): TextAnalysis {
  const t = lower(text);
  const pressure: PressureCue[] = [];
  if (URGENCY.test(t)) pressure.push('urgency');
  if (SECRECY.test(t)) pressure.push('secrecy');
  if (AUTHORITY.test(t)) pressure.push('authority');
  return {
    pressure,
    toldToLie: TOLD_TO_LIE.test(t),
    safeAccount: SAFE_ACCOUNT.test(t),
    contactedByAuthority: CONTACTED_BY_AUTHORITY.test(t),
  };
}

/** Purposes that imply paying a business or trader. */
const BUSINESS_PURPOSE =
  /\b(?:car|cars|vehicle|dealer|dealership|garage|invoice|supplier|company|business|contractor|builder|plumber|electrician|goods|shop|store)\b/;

/**
 * "It's for a car dealer" but the money is going to a personal account is the classic mismatch (spec §7.7).
 * Needs the recipient's account type from Confirmation of Payee; without it, nothing is asserted.
 */
export function purposeContradictsPayee(purpose: string, accountType: 'personal' | 'business' | null): boolean {
  return accountType === 'personal' && BUSINESS_PURPOSE.test(lower(purpose));
}
