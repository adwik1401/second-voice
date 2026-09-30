import { describe, expect, it } from 'vitest';
import { FAR_GAP_DB, median, tagProximity, tagWords, toDbfs, wordDbfs } from './loudness';

describe('wordDbfs', () => {
  // 10 frames of 50 ms: first five quiet (0.01), last five loud (0.1)
  const frames = [...Array(5).fill(0.01), ...Array(5).fill(0.1)];

  it('reads the frames a word overlaps', () => {
    expect(wordDbfs({ start: 0, end: 250 }, frames)).toBeCloseTo(toDbfs(0.01), 5);
    expect(wordDbfs({ start: 250, end: 500 }, frames)).toBeCloseTo(toDbfs(0.1), 5);
  });

  it('averages power across a span that mixes quiet and loud frames', () => {
    const mixed = wordDbfs({ start: 200, end: 300 }, frames)!;
    expect(mixed).toBeGreaterThan(toDbfs(0.01));
    expect(mixed).toBeLessThan(toDbfs(0.1));
  });

  it('returns null when no frame covers the word', () => {
    expect(wordDbfs({ start: 5000, end: 5200 }, frames)).toBeNull();
  });

  it('treats silence as a floor, not -Infinity', () => {
    expect(toDbfs(0)).toBe(-120);
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it('is robust to a loud first-word transient (why medians are used, not means)', () => {
    expect(median([-19, -30, -31, -29, -30])).toBe(-30);
  });
});

describe('tagProximity', () => {
  it('is far exactly at the threshold and near just inside it', () => {
    expect(tagProximity(-27 - FAR_GAP_DB, -27)).toBe('far');
    expect(tagProximity(-27 - FAR_GAP_DB + 0.1, -27)).toBe('near');
  });

  it('is unknown when either level is missing', () => {
    expect(tagProximity(null, -27)).toBe('unknown');
    expect(tagProximity(-30, null)).toBe('unknown');
    expect(tagProximity(-30, NaN)).toBe('unknown');
  });

  it('honours a custom threshold', () => {
    expect(tagProximity(-33, -27, 10)).toBe('near');
    expect(tagProximity(-37, -27, 10)).toBe('far');
  });
});

describe('tagWords', () => {
  it('attaches dbfs and proximity to each word, keeping the original fields', () => {
    const frames = [...Array(4).fill(0.05), ...Array(4).fill(0.002)];
    const [loud, quiet] = tagWords(
      [
        { text: 'hello', start: 0, end: 200 },
        { text: 'there', start: 200, end: 400 },
      ],
      frames,
      toDbfs(0.05),
    );
    expect(loud.text).toBe('hello');
    expect(loud.proximity).toBe('near');
    expect(quiet.proximity).toBe('far');
  });
});
