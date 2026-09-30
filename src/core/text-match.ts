/**
 * Fuzzy, digit-aware word matching (Plan Step 7). Exact matching is not enough — spike runs showed the
 * two STT streams disagree on near-spellings ("Larkmoor's" / "Larkmore's") and on spoken digit strings
 * ("100202022" / "10020202222"). Exact matching would score every such disagreement as a second voice.
 */

/** Very common words carry no evidence of repetition; ignored when measuring overlap. */
const STOPWORDS = new Set(
  (
    'i im ive ill me my mine you your youre youve he she it its we they them her his a an the to of in on at by ' +
    'and or but so if is am are was be been do dont does did for from with that thats this these those just ' +
    'yes yeah no ok okay um uh hi hello please'
  ).split(' '),
);

/** Lower-case and drop everything except letters and digits (apostrophes vanish: "it's" → "its"). */
export function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map(normalizeToken).filter(Boolean);
}

/** Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const isDigits = (s: string) => /^\d+$/.test(s);

/**
 * Do two words from different STT streams plausibly say the same thing?
 *  - identical after normalisation → yes
 *  - digit strings (≥ 6 digits) → yes within 2 edits (the streams split/merge long numbers differently)
 *  - words of ≥ 4 letters → yes within 1 edit (2 edits when ≥ 8 letters)
 *  - anything shorter → exact only (1 edit would equate unrelated short words like "for"/"far")
 */
export function wordsMatch(a: string, b: string): boolean {
  const x = normalizeToken(a);
  const y = normalizeToken(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (isDigits(x) && isDigits(y)) return Math.min(x.length, y.length) >= 6 && editDistance(x, y) <= 2;
  if (isDigits(x) || isDigits(y)) return false;
  const shortest = Math.min(x.length, y.length);
  if (shortest < 4) return false;
  return editDistance(x, y) <= (shortest >= 8 ? 2 : 1);
}

/** Does `word` fuzzy-match any of the (already tokenised) `tokens`? */
export function matchesAny(word: string, tokens: string[]): boolean {
  return tokens.some((t) => wordsMatch(word, t));
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

export interface Overlap {
  /** Content tokens of the shorter side that also appear (fuzzily) in the other. */
  matched: number;
  /** Content-token count of the shorter side. */
  total: number;
  /** matched / total — the overlap coefficient (0 when either side has no content tokens). */
  ratio: number;
}

/**
 * Overlap coefficient of the content tokens of two texts, measured against the SHORTER text. A customer
 * repeating only part of a coach's longer instruction ("it's for a car deposit") must still count as a
 * full overlap; dividing by the coach's whole sentence would wrongly dilute it.
 */
export function contentOverlap(a: string, b: string): Overlap {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.length === 0 || tb.length === 0) return { matched: 0, total: 0, ratio: 0 };
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const matched = small.filter((w) => matchesAny(w, big)).length;
  return { matched, total: small.length, ratio: matched / small.length };
}
