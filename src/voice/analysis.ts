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

const lower = (text: string) => text.toLowerCase().replace(/[\u2018\u2019\u201B]/g, "'");

// Direct instructions to hide things. These are NEVER negation-guarded: "he told me not to tell anyone" is the cue itself.
const SECRECY_DIRECT = /\b(?:don'?t tell|do not tell|not to tell|told me not to)\b/;
// Everything else is guarded against negation: "nobody asked me to keep it secret" is the opposite of a cue.
const URGENCY = /\b(?:urgent(?:ly)?|hurry|asap|right away|immediately|deadline|running out of time|today only|before (?:it'?s too late|they (?:close|stop)))\b/;
const SECRECY = /\b(?:secret|keep (?:it|this|that) (?:quiet|secret|private)|between us|confidential)\b/;
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

const NEGATOR = /\b(?:no|nobody|no one|not|never|nothing|without|isn'?t|aren'?t|wasn'?t|weren'?t|haven'?t|hasn'?t|doesn'?t|didn'?t)\b/;
/** How far back a negator still negates a cue ("nobody has asked me to keep it secret" is 28 characters). */
const NEGATION_REACH = 40;

/** Is there a negator shortly before `index`? */
const negatedAt = (text: string, index: number) => NEGATOR.test(text.slice(Math.max(0, index - NEGATION_REACH), index));

/** "the police HAVEN'T been in touch": a negation right AFTER a noun cue. Kept short and to a few negators. */
const NEGATOR_AFTER = /\b(?:haven'?t|hasn'?t|hadn'?t|didn'?t|isn'?t|wasn'?t|weren'?t|never)\b/;
const negatedAfter = (text: string, end: number) => NEGATOR_AFTER.test(text.slice(end, end + 12));

/**
 * Does `re` match somewhere it is NOT negated? Every match is checked, not just the first.
 *  'none'  — never guarded (a direct instruction: "told me not to tell" IS the cue)
 *  'before'— a negator just before the match cancels it ("nobody asked me to keep it secret")
 *  'both'  — also a negator just after, for noun cues ("the police haven't called")
 */
function matches(re: RegExp, text: string, guard: 'none' | 'before' | 'both' = 'before'): boolean {
  const all = new RegExp(re.source, 'g');
  for (let m = all.exec(text); m !== null; m = all.exec(text)) {
    const end = m.index + m[0].length;
    const negated = guard !== 'none' && (negatedAt(text, m.index) || (guard === 'both' && negatedAfter(text, end)));
    if (!negated) return true;
    if (m[0].length === 0) all.lastIndex++;
  }
  return false;
}

export function analyzeCustomerText(text: string): TextAnalysis {
  const t = lower(text);
  const pressure: PressureCue[] = [];
  if (matches(URGENCY, t)) pressure.push('urgency');
  if (matches(SECRECY_DIRECT, t, 'none') || matches(SECRECY, t)) pressure.push('secrecy');
  if (matches(AUTHORITY, t, 'both')) pressure.push('authority');
  return {
    pressure,
    toldToLie: matches(TOLD_TO_LIE, t),
    safeAccount: matches(SAFE_ACCOUNT, t, 'both'),
    contactedByAuthority: matches(CONTACTED_BY_AUTHORITY, t),
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
