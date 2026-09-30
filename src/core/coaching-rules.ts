/**
 * Rules-based coaching detector (Plan Step 11). The always-on core of content-cue detection.
 *
 * Why rules first, LLM second (found in Phase 2): the LLM Gateway is rate-limited per model (Free tier: no
 * usable limit; Paid: 30 requests/minute) and only one small model was open to this account. A live call needs
 * an instant, offline, predictable verdict — and one that cannot be talked out of it: a scammer who says
 * "ignore your rules" gains nothing against a regex. The LLM (api/_lib/detect.ts) is an optional second
 * opinion for paraphrases these patterns miss.
 *
 * Pure and dependency-free, so it runs identically in the browser and in /api/detect.
 * Precision over recall: a customer's own first-person words ("it's urgent for me", "I'm sending it to my
 * friend") must never be flagged — coaching is words aimed at the customer by someone else.
 */

/** Mirrors `CoachingType` in api/_lib/detect.ts (kept separate so that file stays dependency-free; a test checks they agree). */
export type CoachingKind =
  | 'script_feeding'
  | 'secrecy_instruction'
  | 'urgency_pressure'
  | 'impersonation'
  | 'benign_chatter'
  | 'unclear';

type RuleKind = Exclude<CoachingKind, 'benign_chatter' | 'unclear'>;

export interface RuleVerdict {
  type: RuleKind;
  /** The matched phrase, verbatim from the input. */
  quote: string;
  confidence: number;
}

interface Rule {
  kind: RuleKind;
  pattern: RegExp;
  /** If the same sentence matches this, the rule is skipped (e.g. a surprise gift is not a scam secret). */
  unless?: RegExp;
}

/** Most serious first — also the order ties are resolved in (same as the LLM prompt). */
const PRIORITY: RuleKind[] = ['impersonation', 'secrecy_instruction', 'script_feeding', 'urgency_pressure'];

const RULES: Rule[] = [
  // impersonation: claiming to be the bank / police / an authority, or steering money to a "safe account"
  {
    kind: 'impersonation',
    pattern:
      /\b(?:this is|i'?m calling from|i'?m from|we'?re from|we are from|calling from)\b[^.!?]*?\b(?:bank|fraud (?:team|department)|security (?:team|department)|police|hmrc|national crime agency)\b/,
  },
  { kind: 'impersonation', pattern: /\bsafe account\b/ },
  { kind: 'impersonation', pattern: /\b(?:your|the) account (?:is|has been|was) (?:compromised|hacked|frozen|at risk|under attack)\b/ },

  // secrecy: hiding the payment or the coach from the bank / staff
  {
    kind: 'secrecy_instruction',
    pattern:
      /\b(?:don'?t|do not|never)\s+(?:you\s+)?(?:tell|mention|say|let|talk|speak)\b[^.!?]*?\b(?:bank|anyone|anybody|them|staff|cashier|advisor|adviser|teller|me|that i)\b/,
    unless: /\b(?:surprise|birthday|present|party)\b/,
  },
  { kind: 'secrecy_instruction', pattern: /\bkeep (?:this|it|that) (?:a )?(?:secret|quiet|between us|to yourself|private)\b/ },
  { kind: 'secrecy_instruction', pattern: /\b(?:nobody|no one|no-one) (?:needs|has) to know\b/ },

  // script feeding: supplying the answer or cover story to give the bank
  {
    kind: 'script_feeding',
    pattern: /\b(?:tell|inform)\s+(?:her|him|them|the bank|the (?:assistant|advisor|adviser|lady|man|cashier|teller|staff))\b/,
  },
  { kind: 'script_feeding', pattern: /\bjust (?:say|tell)\b/ },
  { kind: 'script_feeding', pattern: /\bsay (?:that )?(?:it'?s|it is|you'?ve|you have|you are|you'?re|this is)\b/ },
  { kind: 'script_feeding', pattern: /\bif (?:they|he|she|the (?:bank|assistant|advisor|adviser)) asks?\b/ },

  // urgency: imperative pressure only — "I need to hurry" / "it's urgent for me" are the customer's own words
  {
    kind: 'urgency_pressure',
    pattern: /\b(?:hurry(?: up)?|do it now|send it now|just send it|they'?re waiting|don'?t (?:think|wait|delay|hesitate))\b/,
    unless: /\bi(?:'?m| am| need| have| must| want)\b/,
  },
];

/** Lower-cases and straightens curly quotes without changing length, so match indexes line up with the original. */
const normalize = (text: string) => text.toLowerCase().replace(/[‘’‛]/g, "'");

/** Splits into sentences so `unless` guards and [^.!?] spans stay local. */
const sentences = (text: string): { start: number; text: string }[] => {
  const out: { start: number; text: string }[] = [];
  const re = /[^.!?]+[.!?]*/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push({ start: m.index, text: m[0] });
  return out;
};

interface Hit {
  kind: RuleKind;
  quote: string;
  /** One witness per (utterance, sentence, kind): two patterns firing on the same words are not two pieces of evidence. */
  witness: string;
}

function hitsIn(text: string, utterance: number): Hit[] {
  const norm = normalize(text);
  const hits: Hit[] = [];
  sentences(norm).forEach((s, sentence) => {
    for (const rule of RULES) {
      if (rule.unless?.test(s.text)) continue;
      const m = rule.pattern.exec(s.text);
      if (m) {
        hits.push({
          kind: rule.kind,
          quote: text.slice(s.start + m.index, s.start + m.index + m[0].length),
          witness: `${utterance}:${sentence}:${rule.kind}`,
        });
      }
    }
  });
  return hits;
}

/**
 * Classifies one or more utterances. Returns the most serious coaching pattern found, or null when nothing
 * matches ("nothing recognised" is NOT evidence of innocence — the caller may consult the LLM).
 * Confidence: 0.8 for one piece of evidence, 0.9 when independent evidence agrees — a different sentence or
 * category (real scripts stack them). Two patterns matching the same words count once.
 */
export function classifyByRules(texts: string[]): RuleVerdict | null {
  const hits = texts.flatMap((t, i) => hitsIn(t, i));
  if (hits.length === 0) return null;

  const top = PRIORITY.find((k) => hits.some((h) => h.kind === k))!;
  const quote = hits.find((h) => h.kind === top)!.quote.trim();
  const corroborated = new Set(hits.map((h) => h.witness)).size > 1;
  return { type: top, quote, confidence: corroborated ? 0.9 : 0.8 };
}
