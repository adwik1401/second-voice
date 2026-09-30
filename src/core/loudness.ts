/**
 * Loudness helpers (Plan Step 6). TIE-BREAKER ONLY — spike runs 3–6 showed loudness cannot decide
 * alone: a phone at ~1.5 m, the agent's leaked voice and the customer sat within 2 dB in one run and
 * 7–10 dB apart in another. It is used to *support* other evidence, never to create it.
 */

/** Frames are sent to the room STT contiguously in 50 ms chunks, so frame i covers [i·50, (i+1)·50) ms. */
export const DEFAULT_FRAME_MS = 50;
/** A word this many dB below the customer's median counts as "far" (provisional; tune in Phase 6). */
export const FAR_GAP_DB = 6;
/** Floor used for silence so dB maths never hits -Infinity. */
export const SILENCE_DBFS = -120;

export type Proximity = 'near' | 'far' | 'unknown';

export interface TimedWord {
  start: number;
  end: number;
}

export function toDbfs(rms: number): number {
  return rms <= 1e-6 ? SILENCE_DBFS : 20 * Math.log10(rms);
}

/**
 * Loudness of one word in dBFS. Word timestamps line up with `frameRms` because audio is sent from t = 0.
 * Averages power (not amplitude) over the frames the word overlaps; null if no frame covers it.
 */
export function wordDbfs(word: TimedWord, frameRms: number[], frameMs = DEFAULT_FRAME_MS): number | null {
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

/** Median (NaN for an empty list). Medians, not means: the first word of a session is a loud transient. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `far` when at least `farGapDb` below the customer's median; `unknown` if either level is missing. */
export function tagProximity(
  dbfs: number | null,
  customerMedianDbfs: number | null,
  farGapDb = FAR_GAP_DB,
): Proximity {
  if (dbfs === null || customerMedianDbfs === null || Number.isNaN(customerMedianDbfs)) return 'unknown';
  return customerMedianDbfs - dbfs >= farGapDb ? 'far' : 'near';
}

/** Attaches `dbfs` and `proximity` to each word. */
export function tagWords<T extends TimedWord>(
  words: T[],
  frameRms: number[],
  customerMedianDbfs: number | null,
  opts: { frameMs?: number; farGapDb?: number } = {},
): Array<T & { dbfs: number | null; proximity: Proximity }> {
  return words.map((w) => {
    const dbfs = wordDbfs(w, frameRms, opts.frameMs);
    return { ...w, dbfs, proximity: tagProximity(dbfs, customerMedianDbfs, opts.farGapDb) };
  });
}
