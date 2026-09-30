/**
 * Helpers for the Phase 0 spike page (throwaway; removed in Phase 4). The loudness maths now lives in
 * `src/core/loudness.ts` — re-exported here so the spike and its tests keep working with one implementation.
 */
import { SILENCE_DBFS, median, toDbfs, wordDbfs } from '../core/loudness';

export { median, toDbfs, wordDbfs };

export interface SttWord {
  text: string;
  /** Milliseconds from the first audio frame sent on this stream. */
  start: number;
  end: number;
  speaker?: string;
}

export interface SpeakerLoudness {
  words: number;
  medianDbfs: number;
  /** dB below the loudest speaker's median (0 for the loudest). */
  gapDb: number;
}

/** Median word loudness per speaker label, with each speaker's gap to the loudest one. */
export function speakerLoudness(words: { speaker: string; dbfs: number | null }[]): Record<string, SpeakerLoudness> {
  const bySpeaker = new Map<string, number[]>();
  for (const w of words) {
    if (w.dbfs === null) continue;
    bySpeaker.set(w.speaker, [...(bySpeaker.get(w.speaker) ?? []), w.dbfs]);
  }
  const medians = new Map([...bySpeaker].map(([k, v]) => [k, median(v)]));
  const loudest = Math.max(...medians.values(), SILENCE_DBFS);
  return Object.fromEntries(
    [...bySpeaker].map(([k, v]) => [k, { words: v.length, medianDbfs: medians.get(k)!, gapDb: loudest - medians.get(k)! }]),
  );
}

/** Lower-case, strip punctuation — so "Car," from one stream matches "car" from the other. */
export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

/** Room-stream words that do not appear in any agent-stream transcript (candidate background speech). */
export function unmatchedWords(roomWords: string[], agentTexts: string[]): string[] {
  const heard = new Set(agentTexts.flatMap((t) => t.split(/\s+/)).map(normalizeWord).filter(Boolean));
  return roomWords.filter((w) => {
    const n = normalizeWord(w);
    return n.length > 0 && !heard.has(n);
  });
}
