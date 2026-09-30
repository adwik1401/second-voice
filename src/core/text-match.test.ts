import { describe, expect, it } from 'vitest';
import { contentOverlap, contentTokens, editDistance, matchesAny, normalizeToken, tokenize, wordsMatch } from './text-match';

describe('normalizeToken / tokenize', () => {
  it('lower-cases and drops punctuation including apostrophes', () => {
    expect(normalizeToken("Larkmoor's")).toBe('larkmoors');
    expect(normalizeToken('Car,')).toBe('car');
    expect(tokenize("Don't tell the bank!")).toEqual(['dont', 'tell', 'the', 'bank']);
  });
});

describe('editDistance', () => {
  it('counts single-character edits', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('wordsMatch — cases seen in the spike runs', () => {
  it('matches near-spellings of long words (Larkmoor’s / Larkmore’s)', () => {
    expect(wordsMatch("Larkmoor's", "Larkmore's")).toBe(true);
  });

  it('matches long digit strings the two streams split differently', () => {
    expect(wordsMatch('100202022', '10020202222')).toBe(true);
  });

  it('does not match short numbers that differ', () => {
    expect(wordsMatch('12345', '12346')).toBe(false);
  });

  it('keeps short words exact-only ("for" vs "far" / "from")', () => {
    expect(wordsMatch('for', 'far')).toBe(false);
    expect(wordsMatch('for', 'from')).toBe(false);
    expect(wordsMatch('for', 'FOR')).toBe(true);
  });

  it('does not match a number with a word, or unrelated words', () => {
    expect(wordsMatch('100202022', 'payment')).toBe(false);
    expect(wordsMatch('deposit', 'dispatch')).toBe(false);
  });

  it('allows two edits only for words of eight letters or more', () => {
    expect(wordsMatch('assistant', 'assistent')).toBe(true);
    expect(wordsMatch('payment', 'paymants')).toBe(false); // 7 letters, 2 edits
  });

  it('never matches empty tokens', () => {
    expect(wordsMatch('', 'a')).toBe(false);
    expect(wordsMatch('...', '...')).toBe(false);
  });
});

describe('matchesAny', () => {
  it('finds a fuzzy match in a token list', () => {
    expect(matchesAny('Larkmore', tokenize("Hi I'm Larkmoor's payment assistant"))).toBe(true);
    expect(matchesAny('kettle', tokenize('I want to make a payment'))).toBe(false);
  });
});

describe('contentOverlap', () => {
  it('ignores stopwords', () => {
    expect(contentTokens("Tell her it's for a car deposit.")).toEqual(['tell', 'car', 'deposit']);
  });

  it('scores a partial repeat against the SHORTER side (customer repeats only part of the coach)', () => {
    const o = contentOverlap("Tell her it's for a car deposit. Don't mention me.", "It's for a car deposit.");
    expect(o.matched).toBe(2);
    expect(o.total).toBe(2);
    expect(o.ratio).toBe(1);
  });

  it('is zero for unrelated text and for stopword-only text', () => {
    expect(contentOverlap('Tell her it is for a car deposit', 'my name is Nitin').ratio).toBe(0);
    expect(contentOverlap('it is for me', 'is it for you').ratio).toBe(0);
  });

  it('is fuzzy across mis-hearings', () => {
    expect(contentOverlap('the client is ABC Company', 'my client is ABC Companys').ratio).toBeGreaterThan(0.5);
  });
});
