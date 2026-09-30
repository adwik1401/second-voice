/**
 * Signal Engine (Plan Step 7, spec §7.5): finds coaching EVIDENCE around the customer.
 *
 * Design basis (spike runs 1–6): coaching content is visible in whichever stream hears it; loudness and
 * diarization cannot separate speakers reliably; STT streams disagree on spellings and digits. So:
 *   1. content cues   — classified by the LLM (`/api/detect`); the caller passes the results in
 *   2. echo           — the customer repeats what the coach said (`detectEcho`)
 *   3. room-only speech — room words nobody on the call accounts for (`findRoomOnlySpeech`), supported by
 *      two TIE-BREAKERS (different diarization label, far loudness). Never decisive alone.
 * Everything here is pure: no clocks, no network. Callers pass wall-clock times in.
 */
import { FAR_GAP_DB, median, tagProximity } from './loudness';
import { contentOverlap, matchesAny, tokenize } from './text-match';
import type { ConversationTurn, RoomTurn, RoomWord, TimeWindow } from './types';

// ---- Classifying room words ------------------------------------------------------------------------

/**
 * Who accounts for a room-stream word?
 *  customer_window — inside a moment the agent stream heard the customer speaking (transcripts may disagree)
 *  customer_match  — fuzzy-matches a nearby customer transcript
 *  agent_echo      — fuzzy-matches the agent's own reply (its voice leaking into the room stream)
 *  unexplained     — nobody on the call accounts for it
 */
export type WordClass = 'customer_window' | 'customer_match' | 'agent_echo' | 'unexplained';

export interface EngineOptions {
  /** Consecutive unexplained words needed to form a room-only utterance (scattered mishearings are noise). */
  minRunWords: number;
  /** Slack added around each customer-speech window. */
  windowPadMs: number;
  /** How far a customer transcript may sit from a room word to explain it. */
  customerMatchMs: number;
  /** Agent replies run long and their text arrives after they finish — wider window. */
  agentMatchMs: number;
  farGapDb: number;
  /** If this share of a turn is agent echo, the rest of the turn is assumed to be the agent's mis-heard speech. */
  agentTurnShare: number;
  /** Customer-words needed before a customer loudness baseline is trusted. */
  minBaselineWords: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  minRunWords: 4,
  windowPadMs: 500,
  customerMatchMs: 10_000,
  agentMatchMs: 15_000,
  farGapDb: FAR_GAP_DB,
  agentTurnShare: 0.5,
  minBaselineWords: 3,
};

export interface EngineInput {
  roomTurns: RoomTurn[];
  /** Voice Agent transcripts (customer + agent). */
  conversation: ConversationTurn[];
  /** Wall-clock windows from `input.speech.started` → `input.speech.stopped`. */
  customerSpeechWindows: TimeWindow[];
  /** Wall-clock ms at which room-stream audio time 0 began (converts word offsets to wall-clock). */
  roomStartMs: number;
  options?: Partial<EngineOptions>;
}

export interface ClassifiedWord {
  word: RoomWord;
  cls: WordClass;
}
export interface ClassifiedTurn {
  turnIndex: number;
  speaker: string;
  words: ClassifiedWord[];
}

/** Diarization labels that mean "not assigned yet" (seen in spike run 4). */
const UNKNOWN_SPEAKERS = new Set(['', '?', 'PENDING']);
const isKnownSpeaker = (s: string | undefined): s is string => s !== undefined && !UNKNOWN_SPEAKERS.has(s);

export function classifyRoomWords(input: EngineInput): ClassifiedTurn[] {
  const o = { ...DEFAULT_ENGINE_OPTIONS, ...input.options };
  const conv = input.conversation.map((c) => ({ ...c, tokens: tokenize(c.text) }));
  const tokensNear = (role: ConversationTurn['role'], at: number, ms: number) =>
    conv.filter((c) => c.role === role && Math.abs(c.at - at) <= ms).flatMap((c) => c.tokens);

  return input.roomTurns.map((turn, turnIndex) => {
    const words = turn.words.map((word): ClassifiedWord => {
      // Words without timings (fallback turns) are placed at the turn's arrival time.
      const t = word.start === undefined ? turn.at : input.roomStartMs + word.start;
      let cls: WordClass = 'unexplained';
      if (input.customerSpeechWindows.some((w) => t >= w.start - o.windowPadMs && t <= w.end + o.windowPadMs)) {
        cls = 'customer_window';
      } else if (matchesAny(word.text, tokensNear('customer', t, o.customerMatchMs))) {
        cls = 'customer_match';
      } else if (matchesAny(word.text, tokensNear('agent', t, o.agentMatchMs))) {
        cls = 'agent_echo';
      }
      return { word, cls };
    });

    // Backstop: the room STT mis-hears the agent's leaked voice ("Larkmoor's" → "Lark, the Morning King's"),
    // so when most of a turn is recognisably the agent, the leftover words are its mis-heard speech too.
    const agentShare = words.filter((w) => w.cls === 'agent_echo').length / (words.length || 1);
    if (words.length > 0 && agentShare >= o.agentTurnShare) {
      for (const w of words) if (w.cls === 'unexplained') w.cls = 'agent_echo';
    }
    return { turnIndex, speaker: turn.speaker, words };
  });
}

// ---- Room-only speech ------------------------------------------------------------------------------

export interface RoomUtterance {
  turnIndex: number;
  words: RoomWord[];
  text: string;
  /** Tie-breaker 1: majority diarization label is known and differs from the customer's. */
  differentSpeaker: boolean;
  /** Tie-breaker 2: median loudness is ≥ farGapDb below the customer's median. */
  farLoudness: boolean;
  /** Evidence only if at least one tie-breaker agrees (the run length is already ≥ minRunWords). */
  qualifies: boolean;
}

interface Baseline {
  speaker: string | null;
  medianDbfs: number | null;
}

/** The customer's diarization label (most common among customer-attributed words) and median loudness. */
function customerBaseline(turns: ClassifiedTurn[], o: EngineOptions): Baseline {
  const customerWords = turns.flatMap((t) =>
    t.words
      .filter((w) => w.cls === 'customer_window' || w.cls === 'customer_match')
      .map((w) => ({ speaker: w.word.speaker ?? t.speaker, dbfs: w.word.dbfs })),
  );
  const counts = new Map<string, number>();
  for (const c of customerWords) if (isKnownSpeaker(c.speaker)) counts.set(c.speaker, (counts.get(c.speaker) ?? 0) + 1);
  const speaker = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const levels = customerWords.map((c) => c.dbfs).filter((d): d is number => typeof d === 'number');
  return { speaker, medianDbfs: levels.length >= o.minBaselineWords ? median(levels) : null };
}

function toUtterance(turn: ClassifiedTurn, run: ClassifiedWord[], base: Baseline, o: EngineOptions): RoomUtterance {
  const labels = run.map((r) => r.word.speaker ?? turn.speaker).filter(isKnownSpeaker);
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const levels = run.map((r) => r.word.dbfs).filter((d): d is number => typeof d === 'number');
  const runMedian = levels.length > 0 ? median(levels) : null;

  const differentSpeaker = base.speaker !== null && majority !== null && majority !== base.speaker;
  const farLoudness = tagProximity(runMedian, base.medianDbfs, o.farGapDb) === 'far';
  const words = run.map((r) => r.word);
  return {
    turnIndex: turn.turnIndex,
    words,
    text: words.map((w) => w.text).join(' '),
    differentSpeaker,
    farLoudness,
    qualifies: differentSpeaker || farLoudness,
  };
}

/** Runs of ≥ minRunWords unexplained words, each annotated with the two tie-breakers. */
export function findRoomOnlySpeech(input: EngineInput): RoomUtterance[] {
  const o = { ...DEFAULT_ENGINE_OPTIONS, ...input.options };
  const turns = classifyRoomWords(input);
  const base = customerBaseline(turns, o);
  const out: RoomUtterance[] = [];

  for (const turn of turns) {
    let run: ClassifiedWord[] = [];
    const flush = () => {
      if (run.length >= o.minRunWords) out.push(toUtterance(turn, run, base, o));
      run = [];
    };
    for (const cw of turn.words) {
      if (cw.cls === 'unexplained') run.push(cw);
      else flush();
    }
    flush();
  }
  return out;
}

// ---- Echo ------------------------------------------------------------------------------------------

export interface EchoOptions {
  /** The customer must repeat within this long after the coach utterance. */
  windowMs: number;
  /**
   * …and no sooner than this. The same coach audio is often heard by BOTH streams (spike run 4); the second
   * transcript lands within a second or two and is not the customer repeating anything.
   */
  minGapMs: number;
  minMatched: number;
  minRatio: number;
}

export const DEFAULT_ECHO_OPTIONS: EchoOptions = { windowMs: 10_000, minGapMs: 2_000, minMatched: 2, minRatio: 0.5 };

export interface EchoResult {
  isEcho: boolean;
  ratio: number;
  matched: number;
  customerText?: string;
}

/** Did a later customer turn repeat what the coach just said? Strongest single coaching signal. */
export function detectEcho(
  source: { text: string; at: number },
  conversation: ConversationTurn[],
  options: Partial<EchoOptions> = {},
): EchoResult {
  const o = { ...DEFAULT_ECHO_OPTIONS, ...options };
  let best: EchoResult = { isEcho: false, ratio: 0, matched: 0 };
  for (const turn of conversation) {
    if (turn.role !== 'customer') continue;
    const dt = turn.at - source.at;
    if (dt < o.minGapMs || dt > o.windowMs) continue;
    const { matched, ratio } = contentOverlap(source.text, turn.text);
    if (matched >= o.minMatched && ratio >= o.minRatio && ratio >= best.ratio) {
      best = { isEcho: true, ratio, matched, customerText: turn.text };
    }
  }
  return best;
}

// ---- Evidence rule ---------------------------------------------------------------------------------

export type EvidenceReason = 'content_cue' | 'echo' | 'room_only';

export interface EvidenceInput {
  /** Results of `/api/detect` content classification (either stream). */
  contentCues: { confidence: number }[];
  echo: boolean;
  roomOnly: RoomUtterance[];
  minCueConfidence?: number;
}

/** Coaching evidence = a confident content cue, OR an echo, OR qualifying room-only speech. */
export function coachingEvidence(input: EvidenceInput): { coaching: boolean; reasons: EvidenceReason[] } {
  const minConfidence = input.minCueConfidence ?? 0.7;
  const reasons: EvidenceReason[] = [];
  if (input.contentCues.some((c) => c.confidence >= minConfidence)) reasons.push('content_cue');
  if (input.echo) reasons.push('echo');
  if (input.roomOnly.some((u) => u.qualifies)) reasons.push('room_only');
  return { coaching: reasons.length > 0, reasons };
}
