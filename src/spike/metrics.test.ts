import { describe, expect, it } from 'vitest';
import { median, normalizeWord, speakerLoudness, toDbfs, unmatchedWords, wordDbfs } from './metrics';

describe('wordDbfs', () => {
  // 10 frames of 50 ms: first five quiet (0.01), last five loud (0.1)
  const frames = [...Array(5).fill(0.01), ...Array(5).fill(0.1)];

  it('reads the frames a word overlaps', () => {
    expect(wordDbfs({ start: 0, end: 250 }, frames, 50)).toBeCloseTo(toDbfs(0.01), 5);
    expect(wordDbfs({ start: 250, end: 500 }, frames, 50)).toBeCloseTo(toDbfs(0.1), 5);
  });

  it('averages power across a span that mixes quiet and loud frames', () => {
    const mixed = wordDbfs({ start: 200, end: 300 }, frames, 50)!; // one quiet + one loud frame
    expect(mixed).toBeGreaterThan(toDbfs(0.01));
    expect(mixed).toBeLessThan(toDbfs(0.1));
  });

  it('returns null when no frame covers the word', () => {
    expect(wordDbfs({ start: 5000, end: 5200 }, frames, 50)).toBeNull();
  });

  it('treats silence as a floor, not -Infinity', () => {
    expect(toDbfs(0)).toBe(-120);
  });
});

describe('speakerLoudness', () => {
  it('computes each speaker median and the gap to the loudest', () => {
    const out = speakerLoudness([
      { speaker: 'A', dbfs: -20 },
      { speaker: 'A', dbfs: -22 },
      { speaker: 'B', dbfs: -34 },
      { speaker: 'B', dbfs: -30 },
      { speaker: 'B', dbfs: null }, // ignored
    ]);
    expect(out.A.gapDb).toBe(0);
    expect(out.B.medianDbfs).toBe(-32);
    expect(out.B.gapDb).toBe(11); // -21 vs -32
    expect(out.B.words).toBe(2);
  });

  it('median handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('unmatchedWords', () => {
  it('ignores case and punctuation when matching across streams', () => {
    expect(normalizeWord('Car,')).toBe('car');
    expect(unmatchedWords(['It', "was", 'a', 'Car,'], ['it was a car'])).toEqual([]);
  });

  it('returns room words the agent stream never heard', () => {
    expect(unmatchedWords(['say', "it's", 'for', 'a', 'car'], ['it is for a car'])).toEqual(['say', "it's"]);
  });
});
