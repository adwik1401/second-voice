/**
 * Pure helpers for the Phase 0 spike: turn per-frame RMS levels into per-word loudness,
 * summarise loudness per speaker label, and find room-stream words the agent never heard.
 * (Phase 1 replaces these with the production Loudness Tagger / Signal Engine.)
 */

export interface SttWord {
  text: string;
  /** Milliseconds from the first audio frame sent on this stream. */
  start: number;
  end: number;
  speaker?: string;
}

const SILENCE_DBFS = -120;

export function toDbfs(rms: number): number {
  return rms <= 1e-6 ? SILENCE_DBFS : 20 * Math.log10(rms);
}

/**
 * Loudness of one word in dBFS. `frameRms[i]` is the RMS of audio time [i·frameMs, (i+1)·frameMs),
 * which lines up exactly with STT word timestamps because frames are sent contiguously from t=0.
 * Averages power (not amplitude) across the frames the word overlaps; null if no frame covers it.
 */
export function wordDbfs(word: Pick<SttWord, 'start' | 'end'>, frameRms: number[], frameMs: number): number | null {
  const first = Math.floor(word.start / frameMs);
  const last = Math.max(first, Math.ceil(word.end / frameMs) - 1);
  let power = 0;
  let n = 0;
  for (let i = first; i <= last; i++) {
    if (frameRms[i] === undefined) continue;
    power += frameRms[i] ** 2;
    n++;
  }
  return n === 0 ? null : toDbfs(Math.sqrt(power / n));
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
