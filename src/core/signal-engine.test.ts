import { describe, expect, it } from 'vitest';
import { classifyRoomWords, coachingEvidence, detectEcho, findRoomOnlySpeech, type EngineInput } from './signal-engine';
import type { ConversationTurn, RoomTurn, RoomWord } from './types';

/** Wall-clock ms at which room-stream audio time 0 began. */
const T0 = 1_000_000;

const word = (text: string, start: number, speaker = 'A', dbfs: number | null = -27): RoomWord => ({
  text,
  start,
  end: start + 300,
  speaker,
  dbfs,
});
/** One word per 400 ms starting at `from` (ms of room audio time). */
const words = (text: string, from: number, speaker = 'A', dbfs: number | null = -27): RoomWord[] =>
  text.split(' ').map((t, i) => word(t, from + i * 400, speaker, dbfs));
const turn = (at: number, speaker: string, ws: RoomWord[]): RoomTurn => ({ at, speaker, words: ws });
const customer = (at: number, text: string): ConversationTurn => ({ at, role: 'customer', text });
const agent = (at: number, text: string): ConversationTurn => ({ at, role: 'agent', text });
const input = (over: Partial<EngineInput>): EngineInput => ({
  roomTurns: [],
  conversation: [],
  customerSpeechWindows: [],
  roomStartMs: T0,
  ...over,
});
const classes = (i: EngineInput) => classifyRoomWords(i)[0].words.map((w) => w.cls);

describe('classifyRoomWords', () => {
  it('explains words that match a nearby customer transcript', () => {
    const i = input({
      roomTurns: [turn(T0 + 5000, 'A', words('I want to make a payment', 3000))],
      conversation: [customer(T0 + 5500, 'Hi I want to make a payment')],
    });
    expect(new Set(classes(i))).toEqual(new Set(['customer_match']));
  });

  it('attributes words inside a customer-speech window even when the transcripts disagree (run 2: "Continue." heard as "Some fruits")', () => {
    const i = input({
      roomTurns: [turn(T0 + 7000, 'A', words('Some fruits fruits and fruits', 5000))],
      conversation: [customer(T0 + 7000, 'Continue.')],
      customerSpeechWindows: [{ start: T0 + 4800, end: T0 + 6500 }],
    });
    expect(new Set(classes(i))).toEqual(new Set(['customer_window']));
  });

  it('is digit-aware across streams (run 2: "100202022" vs "10020202222")', () => {
    const i = input({
      roomTurns: [turn(T0 + 4000, 'A', words('is 10020202222', 2000))],
      conversation: [customer(T0 + 3000, 'account number is 100202022')],
    });
    expect(classes(i)).toEqual(['customer_match', 'customer_match']);
  });

  it('classes words matching the agent’s own reply as agent_echo', () => {
    const i = input({
      roomTurns: [turn(T0 + 3000, 'A', words('payment safety assistant', 1000))],
      conversation: [agent(T0 + 4000, "I'm Larkmoor's payment safety assistant")],
    });
    expect(new Set(classes(i))).toEqual(new Set(['agent_echo']));
  });

  it('attributes the rest of a mostly-agent turn to the agent (run 1: "Larkmoor’s" mis-heard as "Lark, the Morning King’s")', () => {
    const heard = "Hi I'm Lark the Morning King's AI assistant What's this payment for";
    const i = input({
      roomTurns: [turn(T0 + 8000, 'A', words(heard, 1000))],
      conversation: [agent(T0 + 9000, "Hi, I'm Larkmoor's payment safety assistant. What's this payment for?")],
    });
    expect(classes(i)).not.toContain('unexplained');
    expect(findRoomOnlySpeech(i)).toEqual([]);
  });

  it('customer match wins over agent match for the same word', () => {
    const i = input({
      roomTurns: [turn(T0 + 3000, 'A', words('payment', 1000))],
      conversation: [customer(T0 + 3000, 'payment'), agent(T0 + 3000, 'payment')],
    });
    expect(classes(i)).toEqual(['customer_match']);
  });

  it('places words without timings at the turn’s arrival time', () => {
    const untimed: RoomWord[] = [{ text: 'hello' }];
    const i = input({
      roomTurns: [turn(T0 + 2000, 'A', untimed)],
      conversation: [customer(T0 + 2500, 'hello there')],
    });
    expect(classes(i)).toEqual(['customer_match']);
  });
});

describe('findRoomOnlySpeech', () => {
  const coachText = "Don't tell the bank why just say it's for your client";
  /** The customer speaks first (establishing label + loudness baseline), then a coach run follows. */
  const scenario = (coachSpeaker: string, coachDbfs: number | null, extra: Partial<EngineInput> = {}) =>
    input({
      roomTurns: [
        turn(T0 + 3000, 'A', words('hi I want to make a payment', 1000, 'A', -27)),
        turn(T0 + 13_000, coachSpeaker, words(coachText, 9000, coachSpeaker, coachDbfs)),
      ],
      conversation: [customer(T0 + 3500, 'hi I want to make a payment')],
      ...extra,
    });

  it('returns a run of unexplained words and qualifies it by a different speaker label', () => {
    const out = findRoomOnlySpeech(scenario('B', -28));
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(coachText);
    expect(out[0]).toMatchObject({ differentSpeaker: true, farLoudness: false, qualifies: true });
  });

  it('qualifies by far loudness alone when the diarization label matches the customer’s', () => {
    const out = findRoomOnlySpeech(scenario('A', -36));
    expect(out[0]).toMatchObject({ differentSpeaker: false, farLoudness: true, qualifies: true });
  });

  it('returns the run but does NOT qualify it with no tie-breaker (same label, same loudness)', () => {
    const out = findRoomOnlySpeech(scenario('A', -28));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ differentSpeaker: false, farLoudness: false, qualifies: false });
  });

  it('never treats an unassigned label (PENDING, ?) as a different speaker', () => {
    for (const label of ['PENDING', '?', '']) {
      expect(findRoomOnlySpeech(scenario(label, -28))[0].differentSpeaker).toBe(false);
    }
  });

  it('cannot qualify anything without a customer baseline', () => {
    const out = findRoomOnlySpeech(
      input({ roomTurns: [turn(T0 + 13_000, 'B', words(coachText, 9000, 'B', -40))] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].qualifies).toBe(false);
  });

  it('ignores runs shorter than four words', () => {
    const short = input({ roomTurns: [turn(T0 + 5000, 'B', words('say it is fine', 1000, 'B').slice(0, 3))] });
    expect(findRoomOnlySpeech(short)).toEqual([]);
  });

  it('requires the words to be consecutive — one explained word breaks a run', () => {
    const i = input({
      roomTurns: [turn(T0 + 5000, 'B', words('secret secret secret payment secret secret secret', 1000, 'B'))],
      conversation: [customer(T0 + 5000, 'payment')],
    });
    expect(findRoomOnlySpeech(i)).toEqual([]);
  });

  it('does not flag words inside a customer-speech window', () => {
    const i = scenario('B', -28, { customerSpeechWindows: [{ start: T0 + 8800, end: T0 + 14_500 }] });
    expect(findRoomOnlySpeech(i)).toEqual([]);
  });
});

describe('detectEcho', () => {
  const coach = { text: "Tell her it's for a car deposit. Don't mention me.", at: 10_000 };

  it('detects the customer repeating part of the coach’s instruction', () => {
    const r = detectEcho(coach, [customer(14_000, "It's for a car deposit.")]);
    expect(r).toMatchObject({ isEcho: true, ratio: 1, matched: 2, customerText: "It's for a car deposit." });
  });

  it('ignores the same audio transcribed by the other stream a moment later (min gap)', () => {
    expect(detectEcho(coach, [customer(10_600, "Tell her it's for a car deposit.")]).isEcho).toBe(false);
  });

  it('ignores a repeat that comes too late', () => {
    expect(detectEcho(coach, [customer(25_000, "It's for a car deposit.")]).isEcho).toBe(false);
  });

  it('ignores unrelated answers and a single shared content word', () => {
    expect(detectEcho(coach, [customer(14_000, 'My name is Nitin')]).isEcho).toBe(false);
    expect(detectEcho(coach, [customer(14_000, 'deposit')]).isEcho).toBe(false);
  });

  it('only considers the customer’s turns', () => {
    expect(detectEcho(coach, [agent(14_000, "It's for a car deposit.")]).isEcho).toBe(false);
  });

  it('reports the best-matching customer turn', () => {
    const r = detectEcho(coach, [customer(13_000, 'a car'), customer(15_000, "it's for a car deposit")]);
    expect(r.customerText).toBe("it's for a car deposit");
  });

  it('never fires on empty text', () => {
    expect(detectEcho({ text: '', at: 0 }, [customer(5000, 'hello')]).isEcho).toBe(false);
  });
});

describe('coachingEvidence', () => {
  const qualifying = { turnIndex: 0, words: [], text: '', differentSpeaker: true, farLoudness: false, qualifies: true };
  const weak = { ...qualifying, differentSpeaker: false, qualifies: false };

  it('is false with no signals', () => {
    expect(coachingEvidence({ contentCues: [], echo: false, roomOnly: [] })).toEqual({ coaching: false, reasons: [] });
  });

  it('counts a confident content cue but not a weak one', () => {
    expect(coachingEvidence({ contentCues: [{ confidence: 0.7 }], echo: false, roomOnly: [] }).reasons).toEqual(['content_cue']);
    expect(coachingEvidence({ contentCues: [{ confidence: 0.69 }], echo: false, roomOnly: [] }).coaching).toBe(false);
  });

  it('counts an echo', () => {
    expect(coachingEvidence({ contentCues: [], echo: true, roomOnly: [] }).reasons).toEqual(['echo']);
  });

  it('counts qualifying room-only speech but not one without a tie-breaker', () => {
    expect(coachingEvidence({ contentCues: [], echo: false, roomOnly: [qualifying] }).reasons).toEqual(['room_only']);
    expect(coachingEvidence({ contentCues: [], echo: false, roomOnly: [weak] }).coaching).toBe(false);
  });

  it('reports every reason that applies, and honours a custom confidence floor', () => {
    const r = coachingEvidence({ contentCues: [{ confidence: 0.5 }], echo: true, roomOnly: [qualifying], minCueConfidence: 0.5 });
    expect(r.reasons).toEqual(['content_cue', 'echo', 'room_only']);
  });
});
